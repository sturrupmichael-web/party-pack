/**
 * Tumble Steps: dice-flicking. Everyone has 4 dice. Turns go around the
 * table one die at a time (drag back on your phone, aim, let go) until
 * everyone is out of dice. Every time a die tumbles down a step it re-rolls.
 * Then each die still on the board scores its face × the step's multiplier.
 * Too hard and it falls off the end; too soft and it never leaves the launch
 * pad. Dice knock each other around.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { mulberry32, shuffle } from '../../core/rng';
import { type Die, type Frame, type Throw, dieScore, simulate } from './physics';

export const ROUNDS = 1;
export const DICE_EACH = 4;
/** Board points become pack points at this rate. */
export const POINT_RATE = 25;
const FRAME_MS = 1000 / 30;

export interface TumbleState {
  seats: Seat[];
  round: number;
  /** Index into seats. */
  turn: number;
  /** Throws made by everyone this round; turns go around one die at a time. */
  thrown: number;
  dice: Die[];
  nextId: number;
  phase: 'aim' | 'roll' | 'score' | 'done';
  timer: TimerInfo | null;
  stepEnds: number;
  anim: { id: number; frames: Frame[]; ids: number[]; owner: string; tumbles: number } | null;
  roundScores: Array<Record<string, number>>;
}

const keyOf = (s: TumbleState) => s.seats[s.turn].key;

function aim(s: TumbleState, ctx: GameCtx): void {
  s.phase = 'aim';
  s.timer = inputDeadline(20_000, ctx);
}

export function boardScores(s: TumbleState): Record<string, number> {
  const out = Object.fromEntries(s.seats.map((p) => [p.key, 0]));
  for (const d of s.dice) out[d.owner] = (out[d.owner] ?? 0) + dieScore(d);
  return out;
}

/** Dice each player still has to flick this round. */
export function diceLeft(s: TumbleState): Record<string, number> {
  const n = s.seats.length;
  return Object.fromEntries(s.seats.map((p, i) => [p.key, DICE_EACH - Math.floor(s.thrown / n) - (i < s.thrown % n ? 1 : 0)]));
}

export function totals(s: TumbleState): Record<string, number> {
  return Object.fromEntries(s.seats.map((p) => [p.key, s.roundScores.reduce((a, r) => a + (r[p.key] ?? 0), 0)]));
}

function doThrow(s: TumbleState, t: Throw, ctx: GameCtx): void {
  const die: Die = { id: s.nextId++, owner: keyOf(s), face: 1 + Math.floor(ctx.rand() * 6), x: 0, y: 0, gone: false };
  const live = s.dice.filter((d) => !d.gone);
  const sim = simulate(live, die, t, ctx.rand);
  s.dice = [...live, die];
  s.anim = { id: die.id, frames: sim.frames, ids: s.dice.map((d) => d.id), owner: die.owner, tumbles: sim.tumbles };
  s.dice = s.dice.filter((d) => !d.gone);
  s.thrown++;
  s.phase = 'roll';
  s.timer = null;
  s.stepEnds = ctx.now + sim.frames.length * FRAME_MS + 900;
}

function afterRoll(s: TumbleState, ctx: GameCtx): void {
  s.anim = null;
  if (s.thrown < s.seats.length * DICE_EACH) {
    s.turn = s.thrown % s.seats.length;
    return aim(s, ctx);
  }
  s.roundScores.push(boardScores(s));
  s.phase = 'score';
  s.stepEnds = ctx.now + displayMs(8000, ctx);
}

export const tumbleLogic: GameLogic<TumbleState> = {
  id: 'tumble',
  title: 'Tumble Steps',
  tagline: 'Flick dice down the stairs. Aim and power from your phone.',
  minPlayers: 2,
  maxPlayers: 8,

  setup(players, ctx) {
    const s: TumbleState = {
      seats: shuffle(players, ctx.rand),
      round: 1,
      turn: 0,
      thrown: 0,
      dice: [],
      nextId: 1,
      phase: 'aim',
      timer: null,
      stepEnds: 0,
      anim: null,
      roundScores: [],
    };
    aim(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; aim?: number; power?: number; lane?: number; n?: number };
    if (s.phase !== 'aim' || who.key !== keyOf(s) || d.t !== 'flick' || d.n !== s.nextId) return false;
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
    const a = num(d.aim, -1, 1);
    const p = num(d.power, 0, 1);
    const l = num(d.lane, 0, 1);
    if (a == null || p == null || l == null) return false;
    doThrow(s, { aim: a, power: p, lane: l }, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === 'aim') {
      const late = s.timer && ctx.now >= s.timer.endsAt;
      if (late || !ctx.active.includes(keyOf(s))) {
        // A gentle, slightly random flick for someone who's away or out of time.
        doThrow(s, { aim: (ctx.rand() - 0.5) * 0.4, power: 0.35 + ctx.rand() * 0.25, lane: 0.3 + ctx.rand() * 0.4 }, ctx);
        return true;
      }
      return false;
    }
    if (ctx.now < s.stepEnds) return false;
    if (s.phase === 'roll') afterRoll(s, ctx);
    else if (s.phase === 'score') {
      if (s.round >= ROUNDS) s.phase = 'done';
      else {
        s.round++;
        s.turn = 0;
        s.thrown = 0;
        s.dice = [];
        // Rotate who goes first; going last is an advantage.
        s.seats.push(s.seats.shift()!);
        aim(s, ctx);
      }
    }
    return true;
  },

  skip(s, ctx) {
    if (s.phase === 'aim') {
      s.timer = { endsAt: ctx.now, total: 1 };
    } else s.stepEnds = 0;
    this.tick(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => Object.fromEntries(Object.entries(totals(s)).map(([k, v]) => [k, v * POINT_RATE])),

  publicState(s) {
    return {
      phase: s.phase,
      round: s.round,
      turn: keyOf(s),
      // While a die rolls, thrown already counts it.
      throwNo: Math.floor((s.thrown - (s.phase === 'roll' ? 1 : 0)) / s.seats.length) + 1,
      left: diceLeft(s),
      next: s.nextId,
      order: s.seats.map((p) => p.key),
      dice: s.dice,
      anim: s.phase === 'roll' ? s.anim : null,
      board: boardScores(s),
      roundScores: s.phase === 'score' || s.phase === 'done' ? s.roundScores : null,
      totals: totals(s),
      timer: s.timer,
    };
  },

  privateState(s, who) {
    if (!s.seats.some((p) => p.key === who.key)) return { audience: true };
    return null;
  },

  bot: {
    wants: (s, key) => s.phase === 'aim' && keyOf(s) === key,
    move: (s, key, ctx) => ({ t: 'flick', n: s.nextId, ...botThrow(s, key, ctx.rand) }),
  },
};

/**
 * A bot tries a dozen flicks on a copy of the board and keeps the one that
 * does best for it (its dice minus a share of everyone else's), then wobbles
 * its hand a little so it isn't perfect.
 */
export function botThrow(s: TumbleState, key: string, rand: () => number): Throw {
  const others = Math.max(1, s.seats.length - 1);
  let best: Throw = { aim: 0, power: 0.55, lane: 0.5 };
  let bestScore = -Infinity;
  for (let i = 0; i < 14; i++) {
    const t: Throw = { aim: (rand() - 0.5) * 0.8, power: 0.35 + rand() * 0.5, lane: rand() };
    let total = 0;
    for (let trial = 0; trial < 2; trial++) {
      const board = s.dice.filter((d) => !d.gone).map((d) => ({ ...d }));
      const die: Die = { id: -1, owner: key, face: 3, x: 0, y: 0, gone: false };
      simulate(board, die, t, mulberry32(i * 31 + trial * 7 + s.nextId));
      for (const d of [...board, die]) total += d.owner === key ? dieScore(d) : -dieScore(d) / others;
    }
    if (total > bestScore) {
      bestScore = total;
      best = t;
    }
  }
  const wobble = (v: number, by: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v + (rand() - 0.5) * by));
  return { aim: wobble(best.aim, 0.12, -1, 1), power: wobble(best.power, 0.08, 0, 1), lane: wobble(best.lane, 0.1, 0, 1) };
}
