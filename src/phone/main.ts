/**
 * The phone controller. Joins a room with a code and a name, then shows
 * whatever the host's state says this player should see. Nothing here decides
 * anything: the host owns all game state.
 *
 * Reconnection: the device id (pid) for each room lives in localStorage, and
 * the current room + name too, so a refresh or a woken-up phone rejoins the
 * same seat automatically.
 */
import '../styles/base.css';
import '../styles/phone.css';
import type { PhoneViewCtx, View } from '../core/game';
import { type HostMsg, type PhoneMsg, type StatePayload, type VipAction, isRoomCode, normalizeRoomCode, pidKey, wire } from '../core/protocol';
import { NAME_MAX, type Player, cleanName, standings } from '../core/room';
import { GAMES, gameById, seatsFor } from '../games';
import { trackPresence } from '../net/presence';
import { type Transport, createTransport, hasSupabase } from '../net/transport';
import { avatar, color } from '../ui/avatars';
import { lookAtTv } from '../ui/common';
import { clock } from '../ui/components';
import { el, esc, store } from '../ui/dom';
import { BUILD } from '../core/build';

/**
 * The TV and this phone must run the same version, or they read game data
 * differently (e.g. a resized grid). Newer TV: reload this phone once. Older
 * TV: ask for a TV refresh and hold the game screen until it happens.
 */
let staleTv: HTMLElement | null = null;
function versionCheck(hostBuild: number | undefined): boolean {
  if (!BUILD || hostBuild === BUILD) {
    staleTv?.remove();
    staleTv = null;
    return false;
  }
  if (hostBuild && hostBuild > BUILD) {
    const k = `pp-reloaded-${hostBuild}`;
    try {
      if (!sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, '1');
        location.reload();
        return true;
      }
    } catch {
      /* no storage: ask instead */
    }
  }
  const tvOld = !hostBuild || hostBuild < BUILD;
  if (!staleTv) {
    staleTv = el('div', 'stale-tv');
    document.body.append(staleTv);
  }
  staleTv.innerHTML = tvOld
    ? `<div><b>📺 Refresh the TV</b><p>The game was updated, and the TV is still on the old version. Reload the page on the TV and you'll all carry on, scores kept.</p></div>`
    : `<div><b>📱 Refresh this page</b><p>The game was updated. Reload this page to catch up; you'll keep your seat and score.</p></div>`;
  return true;
}

const SESSION_KEY = 'partypack.session';
const SESSION_MAX_AGE = 6 * 3600 * 1000;
const HOST_LOST_MS = 12_000;
const HOST_GONE_MS = 60_000;

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
// Offline test mode runs several "phones" as tabs of one browser, so keep ids per tab there.
const idStore = {
  get: (k: string) => (hasSupabase() ? store.get(k) : sessionStorage.getItem(k)),
  set: (k: string, v: string) => (hasSupabase() ? store.set(k, v) : sessionStorage.setItem(k, v)),
};

function pidFor(room: string): string {
  const k = `partypack.pid.${room}`;
  let pid = idStore.get(k);
  if (!pid) {
    pid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    idStore.set(k, pid);
  }
  return pid;
}

interface Session {
  room: string;
  name: string;
  at: number;
}
function loadSession(): Session | null {
  try {
    const s = JSON.parse(idStore.get(SESSION_KEY) ?? 'null') as Session | null;
    if (s && isRoomCode(s.room) && s.name && Date.now() - s.at < SESSION_MAX_AGE) return s;
  } catch {
    /* ignore */
  }
  return null;
}
function saveSession(room: string, name: string): void {
  idStore.set(SESSION_KEY, JSON.stringify({ room, name, at: Date.now() }));
}
function clearSession(): void {
  idStore.set(SESSION_KEY, 'null');
}

// ---- Join screen ---------------------------------------------------------------
function showJoin(err = '', room = ''): void {
  app.innerHTML = '';
  const form = el('form', 'screen join');
  form.innerHTML = `<div class="logo-big">◆</div><h1>Game Night <b>Pack</b></h1><p class="muted">Join the game on the TV</p>`;
  const code = el('input') as HTMLInputElement;
  code.placeholder = 'ROOM CODE';
  code.className = 'code-in';
  code.maxLength = 4;
  code.autocapitalize = 'characters';
  code.autocomplete = 'off';
  code.spellcheck = false;
  code.value = normalizeRoomCode(room || params.get('room') || '');
  code.addEventListener('input', () => (code.value = normalizeRoomCode(code.value)));
  const name = el('input') as HTMLInputElement;
  name.placeholder = 'Your name';
  name.maxLength = NAME_MAX;
  name.setAttribute('autocomplete', 'nickname');
  name.value = store.get('partypack.name') ?? '';
  const go = el('button', 'btn primary big', 'Join');
  go.type = 'submit';
  form.append(code, name, go);
  if (err) form.append(el('p', 'warn', esc(err)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normalizeRoomCode(code.value);
    const n = cleanName(name.value);
    if (!isRoomCode(c)) return code.focus();
    if (!n) return name.focus();
    store.set('partypack.name', n);
    saveSession(c, n);
    history.replaceState(null, '', `?room=${c}`);
    play(c, n);
  });
  app.append(form);
  if (!code.value) code.focus();
  else if (!name.value) name.focus();
}

// ---- In a room -----------------------------------------------------------------
let active: { close(): void } | null = null;

function play(room: string, myName: string): void {
  active?.close();
  const pid = pidFor(room);
  const myPidKey = pidKey(pid);
  const transport: Transport = createTransport(room);
  const send = (m: PhoneMsg) => transport.send(m);
  const say = <T extends PhoneMsg['type']>(type: T, payload: Extract<PhoneMsg, { type: T }>['payload']) => send(wire(type, pid, payload) as PhoneMsg);

  app.innerHTML = '';
  const root = el('div', 'phone-root');
  const top = el('div', 'topbar');
  const bar = el('div', 'tbar hidden', '<i></i><span></span>');
  const body = el('div', 'body');
  const vipBar = el('div', 'vipbar hidden');
  const toast = el('div', 'ptoast hidden');
  const cover = el('div', 'cover hidden');
  root.append(top, bar, body, vipBar, toast, cover);
  app.append(root);

  let st: StatePayload | null = null;
  let me: Player | undefined;
  let skew = 0;
  let lastStateAt = 0;
  let joinedOnce = false;
  let current: { key: string; view: View<PhoneViewCtx> | null } | null = null;
  let closed = false;

  const showToast = (t: string) => {
    toast.textContent = t;
    toast.classList.remove('hidden');
    clearTimeout((showToast as any).t);
    (showToast as any).t = setTimeout(() => toast.classList.add('hidden'), 3500);
  };

  const vip = (a: VipAction) => {
    say('vip', a);
    try {
      navigator.vibrate?.(20);
    } catch {
      /* ignore */
    }
  };

  const draft = {
    get: (k: string) => store.get(`partypack.draft.${room}.${st?.room.inst}.${k}`) ?? '',
    set: (k: string, v: string) => store.set(`partypack.draft.${room}.${st?.room.inst}.${k}`, v),
  };

  function mountScreen(key: string, html: string, wire?: (el: HTMLElement) => void): void {
    if (current?.key === key && !current.view) return;
    body.innerHTML = html;
    body.firstElementChild?.classList.add('fade-in');
    wire?.(body);
    current = { key, view: null };
  }

  function render(): void {
    if (!st) {
      top.innerHTML = `<span class="muted">Room ${room}</span><span class="muted">Connecting…</span>`;
      mountScreen('connecting', lookAtTv('Connecting…', `Looking for room ${room}`));
      return;
    }
    const r = st.room;
    me = r.players.find((p) => p.key === myKeyGuess());
    if (!me) {
      top.innerHTML = `<span class="muted">Room ${room}</span>`;
      vipBar.classList.add('hidden');
      bar.classList.add('hidden');
      mountScreen('joining', lookAtTv('Joining…', `Room ${room}`));
      return;
    }
    joinedOnce = true;
    const rank = standings(r.players).find((x) => x.p.key === me!.key);
    top.innerHTML = `${avatar(me.look, 36)}<b class="nm" style="color:${color(me.look)}">${esc(me.name)}</b>${me.vip ? '<span class="vip">👑 VIP</span>' : ''}${me.role === 'audience' ? '<span class="aud">Audience</span>' : ''}<span class="score">${me.role === 'player' ? `${me.score} pts${rank ? ` · #${rank.place}` : ''}` : ''}</span>`;
    root.style.setProperty('--me', color(me.look));

    // VIP controls during a game.
    if (me.vip && r.phase === 'game') {
      vipBar.classList.remove('hidden');
      if (!vipBar.dataset.ready) {
        vipBar.dataset.ready = '1';
        vipBar.innerHTML = `<button class="btn small" data-v="skip">Skip ⏭</button><button class="btn small" data-v="menu">Menu</button>`;
        vipBar.querySelector('[data-v=skip]')!.addEventListener('click', () => vip({ act: 'skip' }));
        const menu = vipBar.querySelector<HTMLButtonElement>('[data-v=menu]')!;
        menu.addEventListener('click', () => {
          if (menu.dataset.armed === '1') {
            menu.dataset.armed = '';
            menu.textContent = 'Menu';
            return vip({ act: 'menu' });
          }
          menu.dataset.armed = '1';
          menu.textContent = 'Quit game?';
          setTimeout(() => {
            menu.dataset.armed = '';
            menu.textContent = 'Menu';
          }, 3000);
        });
      }
    } else {
      vipBar.classList.add('hidden');
      delete vipBar.dataset.ready;
    }

    if (r.phase === 'game') {
      const mod = gameById(r.gameId);
      const g = st.game as any;
      if (!mod?.views || !g) return mountScreen('wait', lookAtTv());
      timer(g.timer ?? null);
      const c: PhoneViewCtx = { pub: g, priv: st.priv[me.key] ?? null, me, players: r.players, send: (data) => say('input', { inst: r.inst!, data }), draft };
      const key = `game:${r.inst}:${mod.views.phone.key(c)}`;
      if (current?.key !== key) {
        body.innerHTML = '';
        const box = el('div', 'game-box fade-in');
        body.append(box);
        mod.views.phone.mount(box, c);
        current = { key, view: mod.views.phone };
      } else current.view?.update?.(body.firstElementChild as HTMLElement, c);
      return;
    }
    timer(null);
    if (r.phase === 'results') {
      const got = Math.round(r.result?.points[me.key] ?? 0);
      const key = `results:${r.played.length}:${me.vip}:${me.role}`;
      const sub = me.role === 'player' ? `${got ? `+${got} this game · ` : ''}${me.score} total${rank ? ` · #${rank.place}` : ''}` : '';
      return mountScreen(
        key,
        me.vip
          ? `<div class="screen center"><h1 class="big">Scores are up!</h1><p class="muted">${esc(sub)}</p><button class="btn primary huge" data-go>Continue</button></div>`
          : lookAtTv('Scores are up!', sub),
        (b) => b.querySelector('[data-go]')?.addEventListener('click', () => vip({ act: 'start' })),
      );
    }
    // Lobby / menu.
    if (me.role === 'audience') {
      return mountScreen('lobby-aud', lookAtTv("You're in the audience", "You'll get a seat at the next game if there's room."));
    }
    if (!me.vip) {
      const vipP = r.players.find((p) => p.vip);
      const picked = gameById(r.picked);
      return mountScreen(
        `lobby:${r.picked}:${vipP?.key}:${me.look}`,
        `<div class="screen center">${avatar(me.look, 140)}<h1 class="big">You're in!</h1><p class="muted">${vipP ? `Waiting for ${esc(vipP.name)} (VIP) to start${picked ? ` <b>${esc(picked.logic.title)}</b>` : ''}.` : 'Waiting for the game to start.'}</p><button class="link" data-leave>Leave room</button></div>`,
        (b) =>
          b.querySelector('[data-leave]')?.addEventListener('click', () => {
            say('leave', {});
            clearSession();
            active?.close();
            showJoin('', room);
          }),
      );
    }
    const seatedP = r.players.filter((p) => p.role === 'player');
    const seatedN = seatedP.length;
    const nBots = seatedP.filter((p) => p.bot).length;
    const picked = gameById(r.picked) ?? GAMES[0];
    const playing = seatsFor(picked, seatedP).length;
    const need = picked.available && playing < picked.logic.minPlayers ? `Needs ${picked.logic.minPlayers}+ players${nBots && !picked.logic.bot ? ' (no bots)' : ''}` : '';
    mountScreen(
      `vip:${r.picked}:${seatedN}:${nBots}`,
      `<div class="screen vip-menu">
        <div class="vip-head"><p class="kicker">👑 Pick a game</p>
        <span class="bot-ctl"><button class="btn small" data-bot="-" ${nBots ? '' : 'disabled'}>−</button><b>🤖 ${nBots}</b><button class="btn small" data-bot="+" ${seatedN >= 8 ? 'disabled' : ''}>+</button></span></div>
        <div class="glist">${GAMES.filter((g) => g.available).map(
          (g) => `<button class="gbtn ${g.logic.id === r.picked ? 'on' : ''}" data-g="${g.logic.id}" ${g.available ? '' : 'disabled'} style="--ac:${g.accent}"><span>${g.icon}</span><b>${esc(g.logic.title)}${g.logic.bot ? ' <i class="botok">🤖</i>' : ''}</b><small>${g.available ? esc(g.logic.tagline) : 'Coming soon'}</small></button>`,
        ).join('')}</div>
        <button class="btn primary huge" data-start ${need || !picked.available ? 'disabled' : ''}>${need || `Start ${esc(picked.logic.title)}`}</button>
      </div>`,
      (b) => {
        b.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((x) => x.addEventListener('click', () => vip({ act: 'pick', gameId: x.dataset.g! })));
        b.querySelector('[data-start]')?.addEventListener('click', () => vip({ act: 'start' }));
        b.querySelectorAll<HTMLButtonElement>('[data-bot]').forEach((x) => x.addEventListener('click', () => vip({ act: x.dataset.bot === '+' ? 'addBot' : 'removeBot' })));
      },
    );
  }

  // Our key is pidKey(pid) unless we took over a seat by name; then find it by name.
  let myKey = myPidKey;
  function myKeyGuess(): string {
    if (!st) return myKey;
    if (st.room.players.some((p) => p.key === myKey)) return myKey;
    const byName = st.room.players.find((p) => p.name.toLowerCase() === myName.toLowerCase());
    if (byName && joinedOnce) myKey = byName.key;
    else if (byName && st.room.players.every((p) => p.key !== myPidKey)) myKey = byName.key;
    return myKey;
  }

  // Shell countdown bar.
  let tInfo: { endsAt: number; total: number } | null = null;
  function timer(t: { endsAt: number; total: number } | null): void {
    tInfo = t;
    bar.classList.toggle('hidden', !t);
  }
  let raf = 0;
  const frame = () => {
    if (tInfo) {
      const left = Math.max(0, tInfo.endsAt + skew - Date.now());
      (bar.firstElementChild as HTMLElement).style.width = `${(100 * left) / tInfo.total}%`;
      bar.lastElementChild!.textContent = clock(left);
      bar.classList.toggle('urgent', left < 5000);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  transport.on((raw) => {
    const m = raw as HostMsg;
    if (m.from !== 'host') return;
    if (m.type === 'state') {
      st = m.payload;
      if (versionCheck(st.build)) return;
      skew = Date.now() - st.hostNow;
      lastStateAt = Date.now();
      cover.classList.add('hidden');
      // Not in the room (e.g. the host restarted without us): join again.
      const inRoom = st.room.players.some((p) => p.key === myKeyGuess());
      if (!inRoom && Date.now() - lastJoin > 3000) doJoin();
      render();
    } else if (m.type === 'err' && (m.payload.to === myPidKey || m.payload.to === myKey)) {
      if (!me) {
        clearSession();
        active?.close();
        showJoin(m.payload.text, room);
      } else showToast(m.payload.text);
    } else if (m.type === 'kicked' && (m.payload.to === myPidKey || m.payload.to === myKey)) {
      clearSession();
      active?.close();
      showJoin('The host removed you from this room.');
    } else if (m.type === 'closed') {
      clearSession();
      closed = true;
      cover.innerHTML = `<div><h1>The room has closed</h1><p class="muted">Ask for the new room code.</p><button class="btn primary big">Join another room</button></div>`;
      cover.classList.remove('hidden');
      cover.querySelector('button')!.addEventListener('click', () => {
        active?.close();
        showJoin();
      });
    }
  });

  let lastJoin = 0;
  function doJoin(): void {
    lastJoin = Date.now();
    say('join', { name: myName });
  }

  const hello = (sync: boolean) => say('hello', { sync });
  void transport.ready.then(() => {
    doJoin();
    hello(true);
  });
  const hb = setInterval(() => hello(!st), 4000);
  const watchdog = setInterval(() => {
    if (closed || !lastStateAt) return;
    const quiet = Date.now() - lastStateAt;
    if (quiet > HOST_GONE_MS) {
      cover.innerHTML = `<div><h1>The TV has left</h1><p class="muted">This room ends when the host closes it. If they're coming back, wait here.</p><button class="btn primary big">Join another room</button></div>`;
      cover.classList.remove('hidden');
      cover.querySelector('button')!.addEventListener('click', () => {
        clearSession();
        active?.close();
        showJoin();
      });
    } else if (quiet > HOST_LOST_MS && cover.classList.contains('hidden')) {
      cover.innerHTML = `<div><div class="spinner"></div><h1>Lost the TV…</h1><p class="muted">Reconnecting to room ${room}.</p></div>`;
      cover.classList.remove('hidden');
    }
  }, 2000);
  const onVisible = () => {
    if (document.visibilityState === 'visible') hello(true);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);

  active = {
    close() {
      clearInterval(hb);
      clearInterval(watchdog);
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      transport.close();
      active = null;
    },
  };
  render();
}

// ---- Boot ------------------------------------------------------------------------------
trackPresence('phone');
const want = normalizeRoomCode(params.get('room') ?? '');
const session = loadSession();
if (session && (!want || want === session.room)) {
  history.replaceState(null, '', `?room=${session.room}`);
  play(session.room, session.name);
} else showJoin();
