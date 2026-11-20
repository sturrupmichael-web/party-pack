/**
 * Doodle Relay: a draw-and-guess telephone chain. Everyone starts a book
 * with a secret prompt and draws it. Books pass along: the next player
 * guesses what the drawing is, the next draws that guess, and so on. At the
 * end every book is replayed on the TV, step by step.
 *
 * Points: a guess that matches what its drawer was drawing scores 100 for
 * both of them. A book that ends on the original prompt scores 100 for
 * everyone who worked on it.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { censor } from '../../core/profanity';
import { shuffle } from '../../core/rng';
import { norm } from '../echo/logic';
import content from './content.json';
import { sanitize } from './ink';

export const PROMPTS = content.prompts as string[];
export const MATCH_POINTS = 100;
export const RELAY_POINTS = 100;
export const MAX_STEPS = 6;
const DRAW_MS = 75_000;
const GUESS_MS = 30_000;

export type Kind = 'draw' | 'guess';
export interface Entry {
  by: string;
  kind: Kind;
  d?: string[];
  text?: string;
  match?: boolean;
}

export interface DoodleState {
  seats: Seat[];
  prompts: string[];
  books: Entry[][];
  steps: number;
  step: number;
  phase: 'play' | 'reveal' | 'done';
  /** Submitted work for this step, by player. */
  sent: Record<string, Entry>;
  /** Latest unsent work, used if the clock runs out. */
  drafts: Record<string, { d?: string[]; text?: string }>;
  timer: TimerInfo | null;
  revBook: number;
  /** -1 shows the prompt, then each entry. */
  revStep: number;
  stepEnds: number;
  points: Record<string, number>;
  perfect: boolean[];
}

export const kindOf = (step: number): Kind => (step % 2 === 0 ? 'draw' : 'guess');

/** Phrase match, ignoring spaces, case, punctuation and "a/an/the". */
export function samePhrase(a: string, b: string): boolean {
  const f = (s: string) =>
    s
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w && !['a', 'an', 'the'].includes(w))
      .map(norm)
      .join('');
  return !!f(a) && f(a) === f(b);
}

const n = (s: DoodleState) => s.seats.length;
/** Which book seat `p` works on at `step`. */
export const bookFor = (s: DoodleState, p: number, step = s.step) => (p - step + n(s) * 8) % n(s);

function target(s: DoodleState, b: number, step: number): Entry | { text: string } {
  return step === 0 ? { text: s.prompts[b] } : s.books[b][step - 1];
}

function startStep(s: DoodleState, ctx: GameCtx): void {
  s.sent = {};
  s.drafts = {};
  s.timer = inputDeadline(kindOf(s.step) === 'draw' ? DRAW_MS : GUESS_MS, ctx);
}

function finishStep(s: DoodleState, ctx: GameCtx): void {
  const kind = kindOf(s.step);
  s.seats.forEach((p, i) => {
    const b = bookFor(s, i);
    const e: Entry = s.sent[p.key] ?? { by: p.key, kind, ...(kind === 'draw' ? { d: s.drafts[p.key]?.d ?? [] } : { text: s.drafts[p.key]?.text ?? '' }) };
    if (kind === 'guess') {
      const prev = s.books[b][s.step - 1];
      const drawn = (target(s, b, s.step - 1) as { text?: string }).text ?? '';
      e.match = !!e.text && samePhrase(e.text, drawn);
      if (e.match) {
        s.points[p.key] += MATCH_POINTS;
        s.points[prev.by] += MATCH_POINTS;
      }
    }
    s.books[b].push(e);
  });
  s.step++;
  if (s.step < s.steps) return startStep(s, ctx);
  // Relay bonus for books that came back to the prompt.
  s.books.forEach((book, b) => {
    const last = book[book.length - 1];
    s.perfect[b] = last.kind === 'guess' && !!last.text && samePhrase(last.text, s.prompts[b]);
    if (s.perfect[b]) for (const e of book) s.points[e.by] += RELAY_POINTS;
  });
  s.phase = 'reveal';
  s.timer = null;
  s.revBook = 0;
  s.revStep = -1;
  s.stepEnds = ctx.now + displayMs(4000, ctx);
}

function advanceReveal(s: DoodleState, ctx: GameCtx): void {
  if (s.revStep < s.steps - 1) {
    s.revStep++;
    s.stepEnds = ctx.now + displayMs(s.revStep === s.steps - 1 ? 7000 : 4500, ctx);
  } else if (s.revBook < n(s) - 1) {
    s.revBook++;
    s.revStep = -1;
    s.stepEnds = ctx.now + displayMs(3500, ctx);
  } else s.phase = 'done';
}

export const doodleLogic: GameLogic<DoodleState> = {
  id: 'doodle',
  title: 'Doodle Relay',
  tagline: 'Draw it, guess it, draw the guess. Watch it go wrong.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const seats = shuffle(players, ctx.rand);
    const s: DoodleState = {
      seats,
      prompts: shuffle(PROMPTS, ctx.rand).slice(0, seats.length),
      books: seats.map(() => []),
      steps: Math.min(seats.length, MAX_STEPS),
      step: 0,
      phase: 'play',
      sent: {},
      drafts: {},
      timer: null,
      revBook: 0,
      revStep: -1,
      stepEnds: 0,
      points: Object.fromEntries(seats.map((p) => [p.key, 0])),
      perfect: [],
    };
    startStep(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; step?: number; d?: unknown; text?: unknown };
    if (s.phase !== 'play' || who.role !== 'player' || d.step !== s.step || s.sent[who.key]) return false;
    if (!s.seats.some((p) => p.key === who.key)) return false;
    const kind = kindOf(s.step);
    const text = typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    const clean = ctx.filter ? censor(text) : text;
    if (d.t === 'draft') {
      s.drafts[who.key] = kind === 'draw' ? { d: sanitize(d.d) } : { text: clean };
      return false; // nothing visible changes
    }
    if (d.t !== kind) return false;
    if (kind === 'draw') s.sent[who.key] = { by: who.key, kind, d: sanitize(d.d) };
    else {
      if (!clean) return false;
      s.sent[who.key] = { by: who.key, kind, text: clean };
    }
    if (s.seats.every((p) => s.sent[p.key])) finishStep(s, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === 'play') {
      const late = s.timer && ctx.now >= s.timer.endsAt;
      // Players who left can't hold the table up: they hand in whatever they had.
      const waitingOnActive = s.seats.some((p) => !s.sent[p.key] && ctx.active.includes(p.key));
      if (late || !waitingOnActive) {
        finishStep(s, ctx);
        return true;
      }
      return false;
    }
    if (s.phase === 'reveal' && ctx.now >= s.stepEnds) {
      advanceReveal(s, ctx);
      return true;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'play') finishStep(s, ctx);
    else if (s.phase === 'reveal') advanceReveal(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const book = s.phase === 'reveal' ? s.revBook : null;
    return {
      phase: s.phase,
      step: s.step,
      steps: s.steps,
      kind: s.phase === 'play' ? kindOf(s.step) : null,
      order: s.seats.map((p) => p.key),
      sent: Object.keys(s.sent),
      timer: s.timer,
      revBook: s.revBook,
      revStep: s.revStep,
      book:
        book == null
          ? null
          : {
              owner: s.seats[book].key,
              prompt: s.prompts[book],
              entries: s.books[book].slice(0, Math.max(0, s.revStep + 1)),
              perfect: s.revStep === s.steps - 1 ? s.perfect[book] : null,
            },
      bookCount: s.seats.length,
      points: s.points,
    };
  },

  privateState(s, who) {
    const i = s.seats.findIndex((p) => p.key === who.key);
    if (i < 0) return { audience: true };
    if (s.phase !== 'play') return { seat: i };
    const b = bookFor(s, i);
    const t = target(s, b, s.step);
    const kind = kindOf(s.step);
    return {
      seat: i,
      kind,
      step: s.step,
      sent: !!s.sent[who.key],
      // Draw from a prompt or a guess; guess from a drawing.
      text: kind === 'draw' ? ((t as { text?: string }).text || null) : null,
      drawing: kind === 'guess' ? ((t as Entry).d ?? []) : null,
      first: s.step === 0,
    };
  },
};
