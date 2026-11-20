/**
 * Dial In: each round one Reader sees a spectrum (say, "Mild ↔ Spicy") and a
 * secret target on it, and gives a clue they think lands there ("salsa").
 * Everyone else drags a dial on their phone. Closer guesses score more, and
 * the Reader scores the average of what the guessers got.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { censor } from '../../core/profanity';
import { shuffle } from '../../core/rng';
import content from './content.json';

export const SPECTRUMS = content.spectrums as Array<[string, string]>;
/** [half width, points], tightest last. Matches DIAL_BANDS in ui/components.ts. */
export const BANDS: Array<[number, number]> = [
  [12, 200],
  [7, 300],
  [2.5, 400],
];

export function pointsFor(guess: number, target: number): number {
  const d = Math.abs(guess - target);
  let pts = 0;
  for (const [w, p] of BANDS) if (d <= w) pts = p;
  return pts;
}

type Phase = 'clue' | 'guess' | 'reveal' | 'done';

export interface DialState {
  seats: Seat[];
  readers: string[];
  spectrums: Array<[string, string]>;
  targets: number[];
  round: number;
  phase: Phase;
  stepEnds: number;
  timer: TimerInfo | null;
  clue: string | null;
  guesses: Record<string, number>;
  crowd: Record<string, number>;
  points: Record<string, number>;
  last: Record<string, number>;
}

const isSeat = (s: DialState, k: string) => s.seats.some((p) => p.key === k);
const reader = (s: DialState) => s.readers[s.round];
const guessers = (s: DialState, active: string[]) => active.filter((k) => isSeat(s, k) && k !== reader(s));

function startRound(s: DialState, ctx: GameCtx): void {
  s.phase = 'clue';
  s.timer = inputDeadline(s.round === 0 ? 75_000 : 60_000, ctx);
  s.clue = null;
  s.guesses = {};
  s.crowd = {};
  s.last = {};
}

function reveal(s: DialState, ctx: GameCtx): void {
  const t = s.targets[s.round];
  const got: number[] = [];
  for (const [k, v] of Object.entries(s.guesses)) {
    const p = pointsFor(v, t);
    s.last[k] = p;
    got.push(p);
  }
  if (got.length) s.last[reader(s)] = Math.round(got.reduce((a, b) => a + b, 0) / got.length);
  for (const [k, n] of Object.entries(s.last)) s.points[k] = (s.points[k] ?? 0) + n;
  s.phase = 'reveal';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(10_000, ctx);
}

function next(s: DialState, ctx: GameCtx): void {
  if (s.round + 1 >= s.readers.length) s.phase = 'done';
  else {
    s.round++;
    startRound(s, ctx);
  }
}

export const dialLogic: GameLogic<DialState> = {
  id: 'dial',
  title: 'Dial In',
  tagline: 'One clue, one dial. How close can you get?',
  minPlayers: 2,
  maxPlayers: 8,

  setup(players, ctx) {
    const order = shuffle(players, ctx.rand).map((p) => p.key);
    const rounds = Math.min(8, Math.max(4, players.length));
    const s: DialState = {
      seats: players,
      readers: Array.from({ length: rounds }, (_, i) => order[i % order.length]),
      spectrums: shuffle(SPECTRUMS, ctx.rand).slice(0, rounds),
      targets: Array.from({ length: rounds }, () => 4 + Math.round(ctx.rand() * 92)),
      round: 0,
      phase: 'clue',
      stepEnds: 0,
      timer: null,
      clue: null,
      guesses: {},
      crowd: {},
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
      last: {},
    };
    startRound(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; text?: string; v?: number; round?: number };
    if (d.round !== s.round) return false;
    const seated = who.role === 'player' && isSeat(s, who.key);
    if (d.t === 'clue' && s.phase === 'clue' && seated && who.key === reader(s)) {
      let text = String(d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (ctx.filter) text = censor(text);
      if (!text) return false;
      s.clue = text;
      s.phase = 'guess';
      s.timer = inputDeadline(40_000, ctx);
      return true;
    }
    if (d.t === 'guess' && s.phase === 'guess' && typeof d.v === 'number' && Number.isFinite(d.v)) {
      const v = Math.min(100, Math.max(0, d.v));
      if (!seated) {
        if (who.key in s.crowd) return false;
        s.crowd[who.key] = v;
        return true;
      }
      if (who.key === reader(s) || who.key in s.guesses) return false;
      s.guesses[who.key] = v;
      const g = guessers(s, ctx.active);
      if (g.length && g.every((k) => k in s.guesses)) reveal(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    const due = s.timer && ctx.now >= s.timer.endsAt;
    if (s.phase === 'clue' && due) return next(s, ctx), true; // no clue: skip the round
    if (s.phase === 'guess') {
      const g = guessers(s, ctx.active);
      if (due || (g.length && g.every((k) => k in s.guesses))) return reveal(s, ctx), true;
    }
    if (s.phase === 'reveal' && ctx.now >= s.stepEnds) return next(s, ctx), true;
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'clue') next(s, ctx);
    else if (s.phase === 'guess') reveal(s, ctx);
    else if (s.phase === 'reveal') next(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.readers.length,
      timer: s.timer,
      reader: reader(s),
      seats: s.seats.map((p) => p.key),
      spectrum: s.spectrums[s.round],
      clue: s.clue,
      locked: Object.keys(s.guesses),
      target: revealed ? s.targets[s.round] : null,
      guesses: revealed ? s.guesses : null,
      crowd: revealed ? s.crowd : null,
      last: revealed ? s.last : null,
    };
  },

  privateState(s, who) {
    const isReader = who.key === reader(s);
    return {
      reader: isReader,
      target: isReader || who.role === 'audience' ? s.targets[s.round] : null,
      guess: s.guesses[who.key] ?? s.crowd[who.key] ?? null,
      audience: who.role === 'audience' || !isSeat(s, who.key),
    };
  },
};
