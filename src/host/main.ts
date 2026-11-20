/**
 * The TV (host screen). Authoritative: it owns the room, the running game's
 * state, every timer and all scoring, and broadcasts what phones may see.
 * Phones only send names, inputs and VIP actions.
 */
import '../styles/base.css';
import '../styles/tv.css';
import QRCode from 'qrcode';
import type { GameCtx, GameModule, View, HostViewCtx } from '../core/game';
import { type HostMsg, type PhoneMsg, type StatePayload, type VipAction, isRoomCode, makeRoomCode, normalizeRoomCode, pidKey, wire } from '../core/protocol';
import {
  type HostRoom,
  type Player,
  type TimerMode,
  addBot,
  applyResult,
  bots,
  isVip,
  join,
  kick,
  leave,
  newRoom,
  playerByKey,
  removeBot,
  resetScores,
  seatAudience,
  seated,
  standings,
  sweep,
  touch,
} from '../core/room';
import { mulberry32 } from '../core/rng';
import { GAMES, gameById, seatsFor } from '../games';
import { trackPresence } from '../net/presence';
import { type Transport, createTransport, hasSupabase } from '../net/transport';
import { avatar, color } from '../ui/avatars';
import { el, esc, fitStage, store } from '../ui/dom';
import { Sfx } from '../ui/sfx';
import { clock } from '../ui/components';

const SAVE_KEY = 'partypack.host.v1';
const SAVE_MAX_AGE = 4 * 3600 * 1000;

interface Saved {
  room: HostRoom;
  game: unknown;
  at: number;
}

function loadSaved(): Saved | null {
  try {
    const s = JSON.parse(store.get(SAVE_KEY) ?? 'null') as Saved | null;
    if (s && Date.now() - s.at < SAVE_MAX_AGE && isRoomCode(s.room?.pub?.room)) return s;
  } catch {
    /* ignore */
  }
  return null;
}

const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;
const sfx = new Sfx();
const rand = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

let room!: HostRoom;
let game: { mod: GameModule; state: any } | null = null;
let transport!: Transport;

// ---- DOM skeleton -------------------------------------------------------------
const app = document.getElementById('app')!;
const stage = el('div', 'stage');
app.append(stage);
fitStage(stage);

const header = el('header', 'tv-head');
const brand = el('div', 'brand', `<span class="logo">◆</span> Game Night <b>Pack</b>`);
const timerBox = el('div', 'tv-timer hidden', `<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"/><circle class="arc" cx="60" cy="60" r="52"/></svg><span class="secs"></span>`);
const corner = el('div', 'corner');
const tools = el('div', 'tools');
header.append(brand, timerBox, tools);
const main = el('main', 'tv-main');
const footer = el('footer', 'tv-foot');
const toast = el('div', 'toast hidden');
const modal = el('div', 'modal hidden');
stage.append(header, main, corner, footer, toast, modal);

const soundBtn = el('button', 'iconbtn', '');
const setSoundIcon = () => (soundBtn.textContent = sfx.enabled ? '🔊' : '🔇');
setSoundIcon();
soundBtn.title = 'Sound on/off';
soundBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.setEnabled(!sfx.enabled);
  setSoundIcon();
});
const settingsBtn = el('button', 'iconbtn', '⚙');
settingsBtn.title = 'Settings';
settingsBtn.addEventListener('click', () => openSettings());
const fsBtn = el('button', 'iconbtn', '⛶');
fsBtn.title = 'Full screen';
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
});
tools.append(soundBtn, fsBtn, settingsBtn);

document.addEventListener('pointerdown', () => sfx.unlock());

function showToast(text: string, ms = 3000): void {
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout((showToast as any).t);
  (showToast as any).t = setTimeout(() => toast.classList.add('hidden'), ms);
}

// ---- Game context ------------------------------------------------------------
function ctx(): GameCtx {
  return {
    now: Date.now(),
    rand,
    timer: room.pub.settings.timer,
    filter: room.pub.settings.filter,
    active: seated(room)
      .filter((p) => p.connected)
      .map((p) => p.key),
  };
}

function whoOf(p: Player) {
  return { key: p.key, role: p.role };
}

// ---- Broadcasting ------------------------------------------------------------
let lastSend = 0;
let pending: number | undefined;

function payload(): StatePayload {
  const c = ctx();
  const priv: Record<string, unknown> = {};
  let gamePub: unknown = null;
  if (game && room.pub.phase === 'game') {
    gamePub = game.mod.logic.publicState(game.state, c);
    for (const p of room.pub.players) {
      const v = game.mod.logic.privateState(game.state, whoOf(p), c);
      if (v != null) priv[p.key] = v;
    }
  }
  return { room: room.pub, game: gamePub, priv, hostNow: c.now };
}

/** Send state now, or soon if we just sent (Realtime has a message budget). */
function broadcast(): void {
  const send = () => {
    pending = undefined;
    lastSend = performance.now();
    const p = payload();
    transport.send(wire('state', 'host', p));
    save();
    render(p);
  };
  if (performance.now() - lastSend > 150) send();
  else pending ??= window.setTimeout(send, 150);
}

function save(): void {
  try {
    const s: Saved = { room, game: game ? { id: game.mod.logic.id, state: game.state } : null, at: Date.now() };
    store.set(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function sendTo(type: 'err' | 'kicked', to: string, text = ''): void {
  transport.send(type === 'err' ? (wire('err', 'host', { to, text }) as HostMsg) : (wire('kicked', 'host', { to }) as HostMsg));
}

// ---- Incoming ------------------------------------------------------------------
function onMessage(raw: unknown): void {
  const msg = raw as PhoneMsg;
  if (!msg || typeof msg.from !== 'string' || msg.from === 'host' || typeof msg.type !== 'string') return;
  const pid = msg.from;
  const now = Date.now();
  if (room.banned.includes(pid)) {
    if (msg.type === 'join' || (msg.type === 'hello' && msg.payload?.sync)) sendTo('kicked', pidKey(pid));
    return;
  }
  const woke = touch(room, pid, now);
  switch (msg.type) {
    case 'hello':
      if (woke || msg.payload?.sync) broadcast();
      return;
    case 'join': {
      const res = join(room, pid, String(msg.payload?.name ?? ''), now, pidKey);
      if (!res.ok) return sendTo('err', pidKey(pid), res.error);
      if (!res.rejoined) sfx.join();
      return broadcast();
    }
    case 'leave':
      leave(room, pid);
      return broadcast();
    case 'input': {
      const key = room.pids[pid];
      const p = key ? playerByKey(room, key) : undefined;
      if (!p || !game || room.pub.phase !== 'game' || msg.payload?.inst !== room.pub.inst) return;
      if (game.mod.logic.onInput(game.state, whoOf(p), msg.payload.data, ctx())) afterChange();
      return;
    }
    case 'vip':
      if (!isVip(room, pid)) return;
      return doAction(msg.payload, room.pids[pid]);
  }
}

// ---- Bots ---------------------------------------------------------------------------
/** When each bot will act on the decision in front of it (host clock). */
let botDue: Record<string, number> = {};

/** Let any bot whose turn it is "think" for a moment, then send its move. */
function driveBots(now: number): boolean {
  const g = game;
  const brain = g?.mod.logic.bot;
  if (!g || !brain) return false;
  let changed = false;
  for (const b of bots(room)) {
    if (!brain.wants(g.state, b.key)) {
      delete botDue[b.key];
      continue;
    }
    if (botDue[b.key] == null) {
      botDue[b.key] = now + 900 + Math.random() * 1600;
      continue;
    }
    if (now < botDue[b.key]) continue;
    delete botDue[b.key];
    if (g.mod.logic.onInput(g.state, whoOf(b), brain.move(g.state, b.key, ctx()), ctx())) changed = true;
  }
  return changed;
}

// ---- Flow ------------------------------------------------------------------------
function afterChange(): void {
  if (game && game.mod.logic.isOver(game.state)) return finishGame();
  broadcast();
}

function doAction(a: VipAction, fromKey?: string): void {
  const say = (t: string) => (fromKey ? sendTo('err', fromKey, t) : showToast(t));
  switch (a?.act) {
    case 'pick':
      if (room.pub.phase === 'lobby' && gameById(a.gameId)) {
        room.pub.picked = a.gameId;
        broadcast();
      }
      return;
    case 'start':
      if (room.pub.phase === 'lobby') return startGame(say);
      if (room.pub.phase === 'results') return toLobby();
      if (room.pub.phase === 'game') return doAction({ act: 'skip' }, fromKey);
      return;
    case 'skip':
      if (room.pub.phase === 'game' && game) {
        game.mod.logic.skip(game.state, ctx());
        return afterChange();
      }
      if (room.pub.phase === 'results') return toLobby();
      return;
    case 'menu':
      if (room.pub.phase !== 'lobby') toLobby();
      return;
    case 'addBot':
      if (room.pub.phase !== 'lobby') return;
      if (!addBot(room, Date.now())) return say('All 8 seats are taken.');
      sfx.join();
      return broadcast();
    case 'removeBot':
      if (removeBot(room)) broadcast();
      return;
  }
}

function startGame(say: (t: string) => void): void {
  const mod = gameById(room.pub.picked);
  if (!mod || !mod.available) return say('That game is coming in a later update.');
  const players = seatsFor(mod, seated(room));
  const { minPlayers, maxPlayers, title } = mod.logic;
  if (!players.some((p) => !p.bot)) return say('Someone needs to join on a phone first.');
  if (players.length < minPlayers) return say(`${title} needs at least ${minPlayers} players${bots(room).length && !mod.logic.bot ? " (bots can't play this one)" : ''}.`);
  const seats = players.slice(0, maxPlayers).map((p) => ({ key: p.key, name: p.name }));
  game = { mod, state: mod.logic.setup(seats, ctx()) };
  botDue = {};
  room.pub.phase = 'game';
  room.pub.gameId = mod.logic.id;
  room.pub.inst = Math.random().toString(36).slice(2, 10);
  room.pub.result = null;
  broadcast();
}

function finishGame(): void {
  if (!game) return;
  const points = game.mod.logic.results(game.state);
  applyResult(room, { gameId: game.mod.logic.id, title: game.mod.logic.title, points });
  room.pub.phase = 'results';
  room.pub.gameId = null;
  room.pub.inst = null;
  game = null;
  sfx.fanfare();
  broadcast();
}

function toLobby(): void {
  game = null;
  room.pub.phase = 'lobby';
  room.pub.gameId = null;
  room.pub.inst = null;
  seatAudience(room);
  broadcast();
}

// ---- Keyboard: the host can do everything the VIP can ----------------------------
let escArmed = 0;
document.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (!modal.classList.contains('hidden')) {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  const ph = room.pub.phase;
  if (ph === 'lobby' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const i = GAMES.findIndex((g) => g.logic.id === room.pub.picked);
    const n = GAMES.length;
    const j = (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    doAction({ act: 'pick', gameId: GAMES[j].logic.id });
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    doAction({ act: 'start' });
  } else if (e.key === 'Escape' && ph !== 'lobby') {
    if (ph === 'game' && Date.now() - escArmed > 2500) {
      escArmed = Date.now();
      showToast('Press Esc again to quit this game and go back to the menu.', 2500);
      return;
    }
    doAction({ act: 'menu' });
  }
});

// ---- Rendering -------------------------------------------------------------------
let joinShort = '';
let qrBig = '';
let qrSmall = '';
let current: { key: string; view: View<HostViewCtx> } | null = null;
let lastShell = '';
let lastPlayers = '';
/** Realtime channel is subscribed. */
let live = false;

function render(p: StatePayload): void {
  renderCorner();
  const ph = room.pub.phase;
  if (ph === 'game' && game) {
    const view = game.mod.views.host;
    const c: HostViewCtx = { pub: p.game, players: room.pub.players, sfx };
    const key = `${room.pub.inst}:${view.key(c)}`;
    if (!current || current.key !== key || lastShell !== 'game') {
      main.innerHTML = '';
      const box = el('div', 'game-screen fade-in');
      main.append(box);
      view.mount(box, c);
      current = { key, view };
    } else view.update?.(main.firstElementChild as HTMLElement, c);
    lastShell = 'game';
    setTimer((p.game as any)?.timer ?? null, p.hostNow);
    footer.innerHTML = `<span class="hint">${vipHint()} <kbd>Enter</kbd> skip · <kbd>Esc</kbd> menu</span>${scoreStrip()}`;
    return;
  }
  setTimer(null, 0);
  current = null;
  const sig = JSON.stringify([ph, room.pub.players, room.pub.picked, room.pub.result, qrBig, room.pub.settings, live]);
  if (sig === lastPlayers && lastShell === ph) return;
  lastPlayers = sig;
  lastShell = ph;
  if (ph === 'lobby') renderLobby();
  else renderResults();
}

function vipHint(): string {
  const vip = room.pub.players.find((p) => p.vip);
  return vip ? `<b style="color:${color(vip.look)}">👑 ${esc(vip.name)}</b> is VIP ·` : '';
}

function scoreStrip(): string {
  return `<span class="strip">${standings(room.pub.players)
    .map(({ p }) => `<span class="${p.connected ? '' : 'away'}">${avatar(p.look, 34)}<b>${p.score}</b></span>`)
    .join('')}</span>`;
}

function renderCorner(): void {
  corner.innerHTML = `${qrSmall ? `<img src="${qrSmall}" alt="" />` : ''}<div><small>${esc(joinShort)}</small><b>${room.pub.room}</b></div>`;
}

function playerSlot(p: Player | undefined): string {
  if (!p) return `<div class="slot empty"><div class="ph"></div><span>Waiting…</span></div>`;
  return `<div class="slot pop ${p.connected ? '' : 'away'} ${p.bot ? 'bot' : ''}" style="--pc:${color(p.look)}">${avatar(p.look, 84)}<span class="nm">${esc(p.name)}</span>${p.vip ? '<span class="crown">👑 VIP</span>' : ''}${p.bot ? '<span class="crown">🤖 Bot</span>' : ''}${p.connected ? '' : '<small>reconnecting…</small>'}<small class="sc">${p.score} pts</small></div>`;
}

function renderLobby(): void {
  const players = seated(room);
  const aud = room.pub.players.filter((p) => p.role === 'audience');
  const slots = Array.from({ length: 8 }, (_, i) => playerSlot(players[i])).join('');
  const picked = gameById(room.pub.picked) ?? GAMES[0];
  const cards = GAMES.map((g) => {
    const on = g.logic.id === picked.logic.id;
    return `<button class="gcard ${on ? 'on' : ''} ${g.available ? '' : 'soon'}" data-game="${g.logic.id}" style="--ac:${g.accent}">
      <span class="gi">${g.icon}</span><b>${esc(g.logic.title)}</b><small>${esc(g.logic.tagline)}</small>
      <em>${g.available ? `${g.logic.minPlayers}–${g.logic.maxPlayers} players${g.logic.id === 'phish' ? ' · bonus' : ''}${g.logic.bot ? ' · 🤖 bots' : ''}` : 'Coming soon'}</em>
      ${room.pub.played.includes(g.logic.id) ? '<i class="played">played</i>' : ''}
    </button>`;
  }).join('');
  const offline = !hasSupabase()
    ? `<p class="warn">Offline test mode: phones must be tabs in this browser.</p>`
    : live
      ? ''
      : `<p class="warn">Connecting to the game server…</p>`;
  const vip = players.find((p) => p.vip);
  const playing = seatsFor(picked, players);
  const nBots = players.filter((p) => p.bot).length;
  const need = !players.some((p) => !p.bot)
    ? 'Waiting for players'
    : picked.available && playing.length < picked.logic.minPlayers
      ? `${picked.logic.title} needs ${picked.logic.minPlayers}+ players${nBots && !picked.logic.bot ? ' (no bots)' : ''}`
      : '';
  main.innerHTML = `<div class="lobby">
    <section class="join-panel">
      <div class="kicker">Join on your phone</div>
      <div class="url">${esc(joinShort)}</div>
      <div class="kicker">Room code</div>
      <div class="code">${room.pub.room}</div>
      ${qrBig ? `<img class="qr" src="${qrBig}" alt="QR code to join room ${room.pub.room}" />` : '<div class="qr"></div>'}
      ${offline}
    </section>
    <section class="lobby-right">
      <h2>Players <span class="muted">${players.length}/8</span>${aud.length ? ` <span class="aud">+ ${aud.length} in the audience</span>` : ''}
        <span class="bot-ctl"><button class="btn small" data-act="addBot" ${players.length >= 8 ? 'disabled' : ''}>🤖 Add bot</button>${nBots ? '<button class="btn small" data-act="removeBot">Remove bot</button>' : ''}</span></h2>
      <div class="slots">${slots}</div>
      <h2>Pick a game</h2>
      <div class="gcards">${cards}</div>
      <div class="lobby-go">
        <span class="muted">${vip ? `<b style="color:${color(vip.look)}">👑 ${esc(vip.name)}</b> picks and starts on their phone, or use <kbd>←</kbd> <kbd>→</kbd> and <kbd>Enter</kbd>` : 'The first player to join is the VIP and runs the show.'}</span>
        <button class="btn primary big" data-act="start" ${picked.available && !need ? '' : 'disabled'}>${need || (picked.available ? `Start ${esc(picked.logic.title)}` : 'Coming soon')}</button>
      </div>
    </section>
  </div>`;
  main.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) => b.addEventListener('click', () => doAction({ act: 'pick', gameId: b.dataset.game! })));
  main.querySelector('[data-act=start]')?.addEventListener('click', () => doAction({ act: 'start' }));
  main.querySelector('[data-act=addBot]')?.addEventListener('click', () => doAction({ act: 'addBot' }));
  main.querySelector('[data-act=removeBot]')?.addEventListener('click', () => doAction({ act: 'removeBot' }));
  footer.innerHTML = '';
}

function renderResults(): void {
  const r = room.pub.result;
  const rows = standings(room.pub.players);
  const top = Math.max(1, ...rows.map((x) => x.p.score));
  main.innerHTML = `<div class="results">
    <div class="kicker">${r ? esc(r.title) : 'Scores'}: results</div>
    <h1 class="title-l">${rows[0] && rows[0].p.score > 0 ? (rows[1] && rows[1].p.score === rows[0].p.score ? "It's a tie at the top!" : `${esc(rows[0].p.name)} leads!`) : 'Scores'}</h1>
    <ol class="board">${rows
      .map(({ p, place }, i) => {
        const got = Math.round(r?.points[p.key] ?? 0);
        return `<li style="--pc:${color(p.look)};animation-delay:${0.15 * i}s"><span class="pl">${place}</span>${avatar(p.look, 72)}<span class="nm">${esc(p.name)}</span>
          <span class="bar"><i style="width:${(100 * p.score) / top}%"></i></span>
          <span class="got">${got ? `+${got}` : ''}</span><b class="tot">${p.score}</b></li>`;
      })
      .join('')}</ol>
    <p class="muted">${vipHint()} Continue on your phone, or press <kbd>Enter</kbd> for the menu.</p>
  </div>`;
  footer.innerHTML = '';
}

// ---- Timer ring --------------------------------------------------------------------
let timerInfo: { endsAt: number; total: number } | null = null;
let skew = 0;
let lastSec = -1;

function setTimer(t: { endsAt: number; total: number } | null, hostNow: number): void {
  timerInfo = t;
  skew = hostNow ? Date.now() - hostNow : 0;
  timerBox.classList.toggle('hidden', !t);
}

function frame(): void {
  if (timerInfo) {
    const left = Math.max(0, timerInfo.endsAt + skew - Date.now());
    const sec = Math.ceil(left / 1000);
    const arc = timerBox.querySelector<SVGCircleElement>('.arc')!;
    const len = 2 * Math.PI * 52;
    arc.style.strokeDasharray = `${len}`;
    arc.style.strokeDashoffset = `${len * (1 - left / timerInfo.total)}`;
    timerBox.querySelector('.secs')!.textContent = clock(left);
    timerBox.classList.toggle('long', left >= 99_500);
    timerBox.classList.toggle('urgent', sec <= 5);
    if (sec !== lastSec) {
      if (sec <= 5 && sec > 0) sfx.tick();
      if (sec === 0 && lastSec > 0) sfx.buzzer();
      lastSec = sec;
    }
  }
  requestAnimationFrame(frame);
}

// ---- Settings ------------------------------------------------------------------------
function closeModal(): void {
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

function openSettings(): void {
  const s = room.pub.settings;
  const seg = (name: string, opts: Array<[string, string]>, val: string) =>
    `<div class="seg">${opts.map(([v, l]) => `<button data-${name}="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const people = room.pub.players
    .map((p) => `<li>${avatar(p.look, 40)}<span>${esc(p.name)}${p.vip ? ' 👑' : ''}${p.role === 'audience' ? ' <small class="muted">audience</small>' : ''}${p.connected ? '' : ' <small class="muted">away</small>'}</span><button class="btn small danger" data-kick="${p.key}">Kick</button></li>`)
    .join('');
  modal.innerHTML = `<div class="sheet">
    <h2>Settings <span class="muted">Room ${room.pub.room}</span></h2>
    <div class="row"><label>Timers</label>${seg('timer', [['normal', 'Normal'], ['relaxed', 'Relaxed'], ['off', 'No timer']], s.timer)}</div>
    <p class="muted small">No timer: each step waits for everyone (or for Skip). Changes apply from the next step.</p>
    <div class="row"><label>Profanity filter</label>${seg('filter', [['on', 'On'], ['off', 'Off']], s.filter ? 'on' : 'off')}</div>
    <div class="row"><label>Sound</label>${seg('sound', [['on', 'On'], ['off', 'Off']], sfx.enabled ? 'on' : 'off')}</div>
    <h3>Players</h3>
    <ul class="people">${people || '<li class="muted">Nobody yet.</li>'}</ul>
    <div class="sheet-actions">
      <button class="btn" data-act="reset">Reset scores</button>
      <button class="btn" data-act="newroom">New room code</button>
      <button class="btn primary" data-act="close">Done</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  modal.querySelectorAll<HTMLButtonElement>('[data-timer]').forEach((b) =>
    b.addEventListener('click', () => {
      room.pub.settings.timer = b.dataset.timer as TimerMode;
      broadcast();
      openSettings();
    }),
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      room.pub.settings.filter = b.dataset.filter === 'on';
      broadcast();
      openSettings();
    }),
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) =>
    b.addEventListener('click', () => {
      sfx.unlock();
      sfx.setEnabled(b.dataset.sound === 'on');
      setSoundIcon();
      openSettings();
    }),
  );
  modal.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = playerByKey(room, b.dataset.kick!);
      if (!p) return;
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.textContent = `Kick ${p.name}?`;
        return;
      }
      kick(room, p.key);
      sendTo('kicked', p.key);
      showToast(`${p.name} was removed.`);
      broadcast();
      openSettings();
    }),
  );
  modal.querySelector('[data-act=reset]')?.addEventListener('click', () => {
    resetScores(room);
    broadcast();
    closeModal();
    showToast('Scores reset.');
  });
  modal.querySelector('[data-act=newroom]')?.addEventListener('click', () => {
    transport.send(wire('closed', 'host', {}));
    store.del(SAVE_KEY);
    location.href = `${base}?new`;
  });
  modal.querySelector('[data-act=close]')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => e.target === modal && closeModal(), { once: true });
}

// ---- Phone-sized screen guard ------------------------------------------------------------
function phoneGuard(): Promise<void> {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600 && matchMedia('(pointer: coarse)').matches;
  if (!small || params.has('host')) return Promise.resolve();
  return new Promise((resolve) => {
    const g = el('div', 'phone-guard', `<div><h1>This is the TV screen</h1><p>Put this page on a laptop or TV. Joining a game?</p>
      <a class="btn primary big" href="${base}join/${location.search}">Join on this phone</a>
      <button class="btn">Host here anyway</button></div>`);
    document.body.append(g);
    g.querySelector('button')!.addEventListener('click', () => {
      g.remove();
      resolve();
    });
  });
}

// ---- Boot ----------------------------------------------------------------------------------
async function boot(): Promise<void> {
  await phoneGuard();
  const saved = params.has('new') ? null : loadSaved();
  const want = normalizeRoomCode(params.get('room') ?? '');
  if (saved && (!want || want === saved.room.pub.room)) {
    room = saved.room;
    for (const p of room.pub.players) p.connected = false;
    room.lastSeen = {};
    const g = saved.game as { id: string; state: unknown } | null;
    const mod = g ? gameById(g.id) : undefined;
    if (mod && room.pub.phase === 'game') game = { mod, state: g!.state };
    else if (room.pub.phase === 'game') room.pub.phase = 'lobby';
    transport = createTransport(room.pub.room, { host: true });
    void transport.otherHosts();
  } else {
    // Claim a code nobody else is hosting.
    for (let i = 0; ; i++) {
      const code = i === 0 && isRoomCode(want) ? want : makeRoomCode();
      const t = createTransport(code, { host: true });
      if ((await t.otherHosts()) === 0 || i >= 5) {
        transport = t;
        room = newRoom(code, GAMES[0].logic.id);
        break;
      }
      t.close();
    }
  }
  history.replaceState(null, '', `${location.pathname}?room=${room.pub.room}`);
  trackPresence('host');

  joinShort = `${location.host}${base}join`;
  const joinUrl = `${location.origin}${base}join/?room=${room.pub.room}`;
  [qrBig, qrSmall] = await Promise.all([
    QRCode.toDataURL(joinUrl, { margin: 1, width: 440, color: { dark: '#120c2c', light: '#ffffff' } }),
    QRCode.toDataURL(joinUrl, { margin: 1, width: 180, color: { dark: '#120c2c', light: '#ffffff' } }),
  ]);

  transport.on(onMessage);
  // Game clock: advance timers a few times a second.
  setInterval(() => {
    const now = Date.now();
    let changed = sweep(room, now);
    if (game && room.pub.phase === 'game') {
      if (driveBots(now)) changed = true;
      if (game.mod.logic.tick(game.state, ctx())) changed = true;
      if (game.mod.logic.isOver(game.state)) return finishGame();
    }
    if (changed) broadcast();
  }, 250);
  // Keep sleepy phones and late joiners in sync.
  setInterval(() => broadcast(), 5000);
  window.addEventListener('beforeunload', () => save());
  requestAnimationFrame(frame);
  broadcast();
  void transport.ready.then(() => {
    live = true;
    lastPlayers = '';
    broadcast();
  });
  if (import.meta.env.DEV) Object.assign(window, { __host: { get room() { return room; }, get game() { return game; }, doAction } });
}

void boot();
