/**
 * The contract every mini-game implements. A game is split in two halves:
 *
 *  - GameLogic: pure state machine run only by the host. No DOM, no timers of
 *    its own; time comes in as ctx.now (host clock, ms). State is plain JSON so
 *    the host can save it and restore it after a refresh.
 *  - GameViews: how the TV and a phone draw that state. Views get only what
 *    the logic chose to publish (publicState / privateState).
 *
 * Shell flow: setup → (onInput | tick)* until isOver → results → menu.
 * After every onInput/tick that returns true the host broadcasts.
 */
import type { TimerMode } from './room';

export interface Seat {
  key: string;
  name: string;
}

export interface GameCtx {
  /** Host clock, ms. */
  now: number;
  rand: () => number;
  timer: TimerMode;
  /** Profanity filter on. */
  filter: boolean;
  /** Seated players whose phones are connected right now. */
  active: string[];
}

export interface Who {
  key: string;
  role: 'player' | 'audience';
}

/** Put this on a public state to show the shell's countdown. Times are host clock. */
export interface TimerInfo {
  endsAt: number;
  total: number;
}

export interface GameLogic<S = any> {
  id: string;
  title: string;
  /** One line for the picker. */
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  setup(players: Seat[], ctx: GameCtx): S;
  /** A phone's input. Return true if the state changed. */
  onInput(s: S, who: Who, data: unknown, ctx: GameCtx): boolean;
  /** Called a few times a second. Return true if the state changed. */
  tick(s: S, ctx: GameCtx): boolean;
  /** VIP or host pressed Skip: end the current step now. */
  skip(s: S, ctx: GameCtx): void;
  isOver(s: S): boolean;
  /** Points each seated player earned in this game. */
  results(s: S): Record<string, number>;
  /** Everything the TV and all phones may see. Include `timer` to show a countdown. */
  publicState(s: S, ctx: GameCtx): { timer?: TimerInfo | null } & Record<string, unknown>;
  /** What only this player's phone may see (or null). */
  privateState(s: S, who: Who, ctx: GameCtx): unknown;
}

/** What a view gets each time state arrives. */
export interface HostViewCtx {
  pub: any;
  players: import('./room').Player[];
  sfx: import('../ui/sfx').Sfx;
}

export interface PhoneViewCtx {
  pub: any;
  priv: any;
  me: import('./room').Player;
  /** Everyone in the room (for names and avatars). */
  players: import('./room').Player[];
  /** Send a game input to the host. */
  send(data: unknown): void;
  /** Phone-local storage for drafts that should survive a refresh. */
  draft: { get(k: string): string; set(k: string, v: string): void };
}

/**
 * A screen that mounts once per `key` and updates in place otherwise, so
 * re-renders never wipe a text box mid-typing or restart an animation.
 */
export interface View<C> {
  key(c: C): string;
  mount(el: HTMLElement, c: C): void;
  update?(el: HTMLElement, c: C): void;
}

export interface GameViews {
  host: View<HostViewCtx>;
  phone: View<PhoneViewCtx>;
}

export interface GameModule {
  logic: GameLogic;
  views: GameViews;
  /** Shown in the picker. */
  accent: string;
  icon: string;
  available: boolean;
}

// ---- Timer presets --------------------------------------------------------
const SCALE: Record<TimerMode, number> = { normal: 1, relaxed: 1.6, off: 1 };

/** Deadline for a step where players act. null = no timer (wait for everyone or Skip). */
export function inputDeadline(baseMs: number, ctx: GameCtx): TimerInfo | null {
  if (ctx.timer === 'off') return null;
  const total = Math.round(baseMs * SCALE[ctx.timer]);
  return { endsAt: ctx.now + total, total };
}

/** Length of a show-and-tell step on the TV (reveals, intros). Never infinite. */
export function displayMs(baseMs: number, ctx: GameCtx): number {
  return Math.round(baseMs * (ctx.timer === 'normal' ? 1 : 1.3));
}
