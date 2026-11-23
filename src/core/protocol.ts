/**
 * Wire protocol between the HOST (authoritative) and PHONES (thin controllers).
 * Every message is a Wire: { v, type, from, payload, ts }.
 *
 *  phone → host
 *    hello  { sync }          heartbeat every few seconds; sync=true asks for a fresh state
 *    join   { name }          join or rejoin (same device or same name gets the same seat)
 *    leave  {}                leave the lobby
 *    input  { inst, data }    a game input; inst is the game instance it was meant for
 *    vip    VipAction         VIP controls: pick / start / skip / menu / addBot / removeBot
 *
 *  host → phones
 *    state  StatePayload      public room + game state, plus each phone's private slice
 *    err    { to, text }      a message for one phone (to = player key)
 *    kicked { to }            the host removed this player
 *    closed {}                the host ended the room
 *
 * `from` is the phone's secret device id (pid) for phone messages, and "host"
 * for host messages. Players are identified in broadcasts by `key`, a hash of
 * the pid, so the pid itself is never echoed back by the host.
 */
import type { RoomPublic } from './room';

export const PROTOCOL_V = 1 as const;

export interface Wire<T extends string = string, P = unknown> {
  v: typeof PROTOCOL_V;
  type: T;
  from: string;
  payload: P;
  ts: number;
}

export type VipAction = { act: 'pick'; gameId: string } | { act: 'start' } | { act: 'skip' } | { act: 'menu' } | { act: 'addBot' } | { act: 'removeBot' };

export type PhoneMsg =
  | Wire<'hello', { sync: boolean }>
  | Wire<'join', { name: string }>
  | Wire<'leave', Record<string, never>>
  | Wire<'input', { inst: string; data: unknown }>
  | Wire<'vip', VipAction>;

export interface StatePayload {
  room: RoomPublic;
  /** The running game's public state (null outside a game). */
  game: unknown;
  /** Private slices for each player key (only that phone should use its own). */
  priv: Record<string, unknown>;
  /** Host clock when sent, so phones can correct for clock skew on timers. */
  hostNow: number;
  /** The TV's build time. A phone on a different build reloads or asks for a TV refresh. */
  build?: number;
}

export type HostMsg =
  | Wire<'state', StatePayload>
  | Wire<'err', { to: string; text: string }>
  | Wire<'kicked', { to: string }>
  | Wire<'closed', Record<string, never>>;

export function wire<T extends string, P>(type: T, from: string, payload: P): Wire<T, P> {
  return { v: PROTOCOL_V, type, from, payload, ts: Date.now() };
}

// ---- Room codes -------------------------------------------------------------
/** No I, L, O or U: they're easy to misread (1, 0, V) on a TV across the room. */
export const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ';

/** Codes we never hand out. Only letters from ROOM_LETTERS matter here. */
const BLOCKED = new Set(
  'FVCK FAGS FAGG CVNT DAMN DYKE GAYS HEMP JEWS KKKK NAZI NAZZ PAKI PHAG PRCK PRNS RAPE SEXX SEXY SHAG SHAT SHTS SPAZ SPZZ TWAT TWTS WANK WHRE XXXX ZZZZ ASSS ANAL ARSE BAWS BTCH CRAP DAGO DICK DMBS FART HEBE HKKA JAPS KAFR NIGA NGGA NGGR NGRS PEDO PERV PHUK PISS PRVT SKNK SMEG SPAS SPEC TARD THOT TWNK WHPS WTFS'.split(' '),
);

export function makeRoomCode(rand: () => number = Math.random): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ROOM_LETTERS[Math.floor(rand() * ROOM_LETTERS.length)];
    if (!BLOCKED.has(s)) return s;
  }
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

export function isRoomCode(s: string): boolean {
  return s.length === 4 && [...s].every((c) => ROOM_LETTERS.includes(c));
}

/** Short stable non-reversible key for a pid (FNV-1a). */
export function pidKey(pid: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pid.length; i++) {
    h ^= pid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
