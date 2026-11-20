/**
 * Swatch Watch: colour clues. Each round one Cue-giver picks one of four
 * secret colours from the grid and gives a one-word clue. Everyone else marks
 * a cell. Then a second clue (up to two words) and a second mark. Marks on the
 * colour score 300, next to it 200, two away 100. The Cue-giver scores 100 for
 * every mark that lands within one cell of the colour.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { censor } from '../../core/profanity';
import { shuffle } from '../../core/rng';
import { COLS, ROWS, ring } from './grid';

export const MARK_POINTS = [300, 200, 100];
export const CUE_POINTS = 100;

type Phase = 'pick' | 'clue1' | 'guess1' | 'clue2' | 'guess2' | 'reveal' | 'done';

export interface SwatchState {
  seats: Seat[];
  cuers: string[];
  round: number;
  phase: Phase;
  stepEnds: number;
  timer: TimerInfo | null;
  options: number[];
  target: number | null;
  clues: string[];
  marks: Record<string, number[]>;
  points: Record<string, number>;
  last: Record<string, number>;
}

const isSeat = (s: SwatchState, k: string) => s.seats.some((p) => p.key === k);
const cuer = (s: SwatchState) => s.cuers[s.round];
const guessers = (s: SwatchState, active: string[]) => active.filter((k) => isSeat(s, k) && k !== cuer(s));

export function markPoints(mark: number, target: number): number {
  return MARK_POINTS[ring(mark, target)] ?? 0;
}

function pickOptions(rand: () => number): number[] {
  // Four colours from different parts of the grid, so the choice is interesting.
  const out: number[] = [];
  while (out.length < 4) {
    const i = Math.floor(rand() * ROWS * COLS);
    if (out.every((o) => ring(o, i) >= 4)) out.push(i);
  }
  return out;
}

function startRound(s: SwatchState, ctx: GameCtx): void {
  s.phase = 'pick';
  s.timer = inputDeadline(75_000, ctx);
  s.options = pickOptions(ctx.rand);
  s.target = null;
  s.clues = [];
  s.marks = {};
  s.last = {};
}

function toGuess(s: SwatchState, n: 1 | 2, ctx: GameCtx): void {
  s.phase = n === 1 ? 'guess1' : 'guess2';
  s.timer = inputDeadline(45_000, ctx);
}

function reveal(s: SwatchState, ctx: GameCtx): void {
  const t = s.target!;
  let near = 0;
  for (const [k, ms] of Object.entries(s.marks)) {
    const pts = ms.reduce((a, m) => a + markPoints(m, t), 0);
    near += ms.filter((m) => ring(m, t) <= 1).length;
    if (pts) s.last[k] = pts;
  }
  if (near) s.last[cuer(s)] = near * CUE_POINTS;
  for (const [k, n] of Object.entries(s.last)) s.points[k] = (s.points[k] ?? 0) + n;
  s.phase = 'reveal';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(11_000, ctx);
}

function next(s: SwatchState, ctx: GameCtx): void {
  if (s.round + 1 >= s.cuers.length) s.phase = 'done';
  else {
    s.round++;
    startRound(s, ctx);
  }
}

function allMarked(s: SwatchState, ctx: GameCtx, n: number): boolean {
  const g = guessers(s, ctx.active);
  return g.length > 0 && g.every((k) => (s.marks[k]?.length ?? 0) >= n);
}

export const swatchLogic: GameLogic<SwatchState> = {
  id: 'swatch',
  title: 'Swatch Watch',
  tagline: 'Clue a colour. Everyone hunts for it on the grid.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const order = shuffle(players, ctx.rand).map((p) => p.key);
    const rounds = Math.min(8, Math.max(players.length, 4));
    const s: SwatchState = {
      seats: players,
      cuers: Array.from({ length: rounds }, (_, i) => order[i % order.length]),
      round: 0,
      phase: 'pick',
      stepEnds: 0,
      timer: null,
      options: [],
      target: null,
      clues: [],
      marks: {},
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
      last: {},
    };
    startRound(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; i?: number; text?: string; round?: number };
    if (d.round !== s.round || who.role !== 'player' || !isSeat(s, who.key)) return false;
    const me = who.key;
    if (me === cuer(s)) {
      if (d.t === 'clue' && (s.phase === 'pick' || s.phase === 'clue2')) {
        const words = String(d.text ?? '').trim().split(/\s+/).filter(Boolean);
        const max = s.phase === 'pick' ? 1 : 2;
        let text = words.slice(0, max).join(' ').slice(0, 30);
        if (ctx.filter) text = censor(text);
        if (!text) return false;
        if (s.phase === 'pick') {
          if (typeof d.i !== 'number' || !s.options.includes(d.i)) return false;
          s.target = d.i;
          s.clues = [text];
          toGuess(s, 1, ctx);
        } else {
          s.clues.push(text);
          toGuess(s, 2, ctx);
        }
        return true;
      }
      return false;
    }
    if (d.t === 'mark' && (s.phase === 'guess1' || s.phase === 'guess2') && Number.isInteger(d.i) && d.i! >= 0 && d.i! < ROWS * COLS) {
      const n = s.phase === 'guess1' ? 1 : 2;
      const ms = (s.marks[me] ??= []);
      if (ms.length >= n) return false;
      if (n === 2 && ms.length === 0) ms.push(-1); // missed the first mark: keep slots aligned
      if (ms.includes(d.i!)) return false;
      ms.push(d.i!);
      if (allMarked(s, ctx, n)) {
        if (n === 1) {
          s.phase = 'clue2';
          s.timer = inputDeadline(60_000, ctx);
        } else reveal(s, ctx);
      }
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    const due = s.timer && ctx.now >= s.timer.endsAt;
    switch (s.phase) {
      case 'pick':
        if (due) return next(s, ctx), true;
        return false;
      case 'guess1':
        if (due || allMarked(s, ctx, 1)) {
          s.phase = 'clue2';
          s.timer = inputDeadline(60_000, ctx);
          return true;
        }
        return false;
      case 'clue2':
        if (due) return toGuess(s, 2, ctx), true; // no second clue: guess again anyway
        return false;
      case 'guess2':
        if (due || allMarked(s, ctx, 2)) return reveal(s, ctx), true;
        return false;
      case 'reveal':
        if (ctx.now >= s.stepEnds) return next(s, ctx), true;
        return false;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'pick') next(s, ctx);
    else if (s.phase === 'guess1') {
      s.phase = 'clue2';
      s.timer = inputDeadline(60_000, ctx);
    } else if (s.phase === 'clue2') toGuess(s, 2, ctx);
    else if (s.phase === 'guess2') reveal(s, ctx);
    else if (s.phase === 'reveal') next(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const revealed = s.phase === 'reveal';
    const marks: Record<string, number[]> = {};
    for (const [k, ms] of Object.entries(s.marks)) marks[k] = ms.filter((m) => m >= 0);
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.cuers.length,
      timer: s.timer,
      cuer: cuer(s),
      seats: s.seats.map((p) => p.key),
      clues: s.clues,
      marks,
      target: revealed ? s.target : null,
      last: revealed ? s.last : null,
    };
  },

  privateState(s, who) {
    const isCuer = who.key === cuer(s);
    return {
      cuer: isCuer,
      options: isCuer && s.phase === 'pick' ? s.options : null,
      target: isCuer ? s.target : null,
      marks: (s.marks[who.key] ?? []).filter((m) => m >= 0),
      audience: who.role === 'audience' || !isSeat(s, who.key),
    };
  },
};
