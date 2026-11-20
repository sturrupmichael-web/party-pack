/**
 * The room: who's here, who's VIP, seats, audience, kicks and the running
 * scoreboard. Pure functions over plain JSON so the host can save the whole
 * thing to localStorage and the rules can be unit tested without a browser.
 */
import { censor } from './profanity';

export const MAX_PLAYERS = 8;
export const NAME_MAX = 12;
/** A phone that hasn't said hello for this long shows as reconnecting. */
export const AWAY_MS = 10_000;

export type TimerMode = 'normal' | 'relaxed' | 'off';
export type Role = 'player' | 'audience';
export type RoomPhase = 'lobby' | 'game' | 'results';

export interface Player {
  /** Public id: a hash of the device's secret pid. */
  key: string;
  name: string;
  /** Index into the colour and avatar lists. */
  look: number;
  role: Role;
  vip: boolean;
  connected: boolean;
  /** Cumulative score across games (players only). */
  score: number;
  joinedAt: number;
  /** A computer player run by the host (no phone). */
  bot?: boolean;
}

export interface Settings {
  timer: TimerMode;
  filter: boolean;
}

export interface GameResult {
  gameId: string;
  title: string;
  /** Points each player earned in that game. */
  points: Record<string, number>;
}

export interface RoomPublic {
  room: string;
  phase: RoomPhase;
  players: Player[];
  settings: Settings;
  /** Game highlighted in the picker. */
  picked: string;
  /** The running game (phase 'game'). */
  gameId: string | null;
  /** Id of this run of the game; phone inputs must carry it. */
  inst: string | null;
  /** Last finished game (phase 'results'). */
  result: GameResult | null;
  /** Games played so far this room, oldest first. */
  played: string[];
}

/** Everything the host keeps, including secrets that are never broadcast. */
export interface HostRoom {
  pub: RoomPublic;
  /** Device pid → player key. */
  pids: Record<string, string>;
  /** Kicked devices (pids) and seats (keys). */
  banned: string[];
  lastSeen: Record<string, number>;
}

export function newRoom(code: string, picked: string): HostRoom {
  return {
    pub: {
      room: code,
      phase: 'lobby',
      players: [],
      settings: { timer: 'normal', filter: true },
      picked,
      gameId: null,
      inst: null,
      result: null,
      played: [],
    },
    pids: {},
    banned: [],
    lastSeen: {},
  };
}

export function cleanName(s: string): string {
  return s
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export const seated = (r: HostRoom): Player[] => r.pub.players.filter((p) => p.role === 'player');
export const audience = (r: HostRoom): Player[] => r.pub.players.filter((p) => p.role === 'audience');
export const playerByKey = (r: HostRoom, key: string): Player | undefined => r.pub.players.find((p) => p.key === key);
export const keyOfPid = (r: HostRoom, pid: string): string | undefined => r.pids[pid];

function freeLook(r: HostRoom): number {
  const used = new Set(seated(r).map((p) => p.look));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return r.pub.players.length % MAX_PLAYERS;
}

export type JoinResult = { ok: true; key: string; rejoined: boolean } | { ok: false; error: string };

/**
 * A phone asks to join with a name. In order:
 *  1. A kicked device is refused.
 *  2. A device we already know gets its own seat back (and may rename in the lobby).
 *  3. A name that matches a seat whose phone has gone quiet takes that seat over
 *     (a new phone, or a browser that lost its storage).
 *  4. Otherwise a new seat: a player in the lobby while there's room, else audience.
 */
export function join(r: HostRoom, pid: string, rawName: string, now: number, keyFor: (pid: string) => string): JoinResult {
  if (r.banned.includes(pid)) return { ok: false, error: 'The host removed you from this room.' };
  let name = cleanName(rawName);
  if (!name) return { ok: false, error: 'Enter a name.' };
  if (r.pub.settings.filter) name = censor(name);
  if (!name.replace(/[*\s]/g, '')) return { ok: false, error: 'Pick a different name.' };

  const mine = r.pids[pid] ? playerByKey(r, r.pids[pid]) : undefined;
  const same = r.pub.players.find((p) => p.name.toLowerCase() === name.toLowerCase());

  if (mine) {
    if (mine.name !== name && r.pub.phase === 'lobby' && (!same || same === mine)) mine.name = name;
    touch(r, pid, now);
    return { ok: true, key: mine.key, rejoined: true };
  }
  if (same) {
    if (same.bot) return { ok: false, error: `"${name}" is one of the bots. Pick another name.` };
    if (r.banned.includes(same.key)) return { ok: false, error: 'That name was removed by the host.' };
    if (now - (r.lastSeen[same.key] ?? 0) < AWAY_MS) {
      return { ok: false, error: `"${name}" is already here. Pick another name, or wait a few seconds if that's you.` };
    }
    for (const [p, k] of Object.entries(r.pids)) if (k === same.key) delete r.pids[p];
    r.pids[pid] = same.key;
    touch(r, pid, now);
    return { ok: true, key: same.key, rejoined: true };
  }

  const key = keyFor(pid);
  const role: Role = r.pub.phase === 'lobby' && seated(r).length < MAX_PLAYERS ? 'player' : 'audience';
  r.pub.players.push({ key, name, look: role === 'player' ? freeLook(r) : r.pub.players.length % MAX_PLAYERS, role, vip: false, connected: true, score: 0, joinedAt: now });
  r.pids[pid] = key;
  r.lastSeen[key] = now;
  ensureVip(r);
  return { ok: true, key, rejoined: false };
}

/** A sign of life from a device. Returns true if that changed what everyone sees. */
export function touch(r: HostRoom, pid: string, now: number): boolean {
  const key = r.pids[pid];
  if (!key) return false;
  r.lastSeen[key] = now;
  const p = playerByKey(r, key);
  if (p && !p.connected) {
    p.connected = true;
    return true;
  }
  return false;
}

/** Mark quiet phones as away. Returns true if anything changed. */
export function sweep(r: HostRoom, now: number): boolean {
  let changed = false;
  for (const p of r.pub.players) {
    if (p.bot) continue;
    const on = now - (r.lastSeen[p.key] ?? 0) < AWAY_MS;
    if (on !== p.connected) {
      p.connected = on;
      changed = true;
    }
  }
  return changed;
}

/** The first seated player (by join time) is VIP; the next one inherits it. */
export function ensureVip(r: HostRoom): void {
  const players = seated(r).filter((p) => !p.bot);
  for (const p of r.pub.players) if (p.role !== 'player' || p.bot) p.vip = false;
  if (players.some((p) => p.vip)) return;
  const first = players.slice().sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (first) first.vip = true;
}

export function isVip(r: HostRoom, pid: string): boolean {
  const key = r.pids[pid];
  return !!key && !!playerByKey(r, key)?.vip;
}

/** Remove a player for good: their device and name can't rejoin this room. */
export function kick(r: HostRoom, key: string): void {
  r.pub.players = r.pub.players.filter((p) => p.key !== key);
  for (const [pid, k] of Object.entries(r.pids)) {
    if (k === key) {
      delete r.pids[pid];
      r.banned.push(pid);
    }
  }
  r.banned.push(key);
  delete r.lastSeen[key];
  ensureVip(r);
}

/** A phone leaves the lobby on purpose (not banned; it can join again). */
export function leave(r: HostRoom, pid: string): void {
  const key = r.pids[pid];
  if (!key || r.pub.phase !== 'lobby') return;
  r.pub.players = r.pub.players.filter((p) => p.key !== key);
  delete r.pids[pid];
  delete r.lastSeen[key];
  ensureVip(r);
}

export const BOT_NAMES = ['Robo Rita', 'Bolt', 'Chip', 'Sprocket', 'Widget', 'Pixel', 'Gizmo', 'Dot Matrix'];
export const bots = (r: HostRoom): Player[] => seated(r).filter((p) => p.bot);

/** Seat a computer player. Only in the lobby, and only while there's a free seat. */
export function addBot(r: HostRoom, now: number): Player | null {
  if (r.pub.phase !== 'lobby' || seated(r).length >= MAX_PLAYERS) return null;
  const taken = new Set(r.pub.players.map((p) => p.name.toLowerCase()));
  const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Bot ${bots(r).length + 1}`;
  let n = 1;
  while (r.pub.players.some((p) => p.key === `bot${n}`)) n++;
  const p: Player = { key: `bot${n}`, name, look: freeLook(r), role: 'player', vip: false, connected: true, score: 0, joinedAt: now, bot: true };
  r.pub.players.push(p);
  return p;
}

/** Remove the most recently added bot. */
export function removeBot(r: HostRoom): boolean {
  const b = bots(r).sort((x, y) => y.joinedAt - x.joinedAt)[0];
  if (!b || r.pub.phase !== 'lobby') return false;
  r.pub.players = r.pub.players.filter((p) => p !== b);
  return true;
}

/** Back at the menu, audience members take any free seats (oldest first). */
export function seatAudience(r: HostRoom): void {
  for (const a of audience(r).sort((x, y) => x.joinedAt - y.joinedAt)) {
    if (seated(r).length >= MAX_PLAYERS) break;
    a.look = freeLook(r);
    a.role = 'player';
  }
  ensureVip(r);
}

/** Add a finished game's points to everyone's running score. */
export function applyResult(r: HostRoom, result: GameResult): void {
  for (const p of r.pub.players) if (p.role === 'player') p.score += Math.round(result.points[p.key] ?? 0);
  r.pub.result = result;
  r.pub.played.push(result.gameId);
}

export function resetScores(r: HostRoom): void {
  for (const p of r.pub.players) p.score = 0;
  r.pub.played = [];
  r.pub.result = null;
}

/** Players ranked by running score, with shared places for ties. */
export function standings(players: Player[]): Array<{ p: Player; place: number }> {
  const sorted = players.filter((p) => p.role === 'player').sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  return sorted.map((p) => ({ p, place: sorted.findIndex((q) => q.score === p.score) + 1 }));
}
