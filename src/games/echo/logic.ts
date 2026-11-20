/**
 * Echo Chamber: everyone but the guesser sees a mystery word and writes a
 * one-word clue in secret. Matching clues cancel each other out (and so do
 * clues that give the word away), then the guesser sees what's left and has
 * one try. A right guess scores for the guesser and everyone whose clue
 * survived, so you want a clue that helps *and* that nobody else will write.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { hasProfanity } from '../../core/profanity';
import { shuffle } from '../../core/rng';
import content from './content.json';

export const WORDS = content.words as string[];
export const GUESS_POINTS = 600;
export const CLUE_POINTS = 300;

type Phase = 'ready' | 'clue' | 'guess' | 'reveal' | 'done';
export type Why = 'dup' | 'word' | 'filter';

export interface EchoState {
  seats: Seat[];
  words: string[];
  guessers: string[];
  round: number;
  phase: Phase;
  stepEnds: number;
  timer: TimerInfo | null;
  clues: Record<string, { text: string; why: Why | null }>;
  guess: string | null;
  passed: boolean;
  correct: boolean;
  points: Record<string, number>;
  last: Record<string, number>;
}

/** Lowercase letters only, with a simple plural trimmed: "Cats!" → "cat". */
export function norm(w: string): string {
  let s = w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('es') && /(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

export function sameWord(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/** Cancel duplicates and give-aways. Mutates `clues`. */
export function judge(clues: EchoState['clues'], word: string, filter: boolean): void {
  const w = norm(word);
  const count: Record<string, number> = {};
  for (const c of Object.values(clues)) count[norm(c.text)] = (count[norm(c.text)] ?? 0) + 1;
  for (const c of Object.values(clues)) {
    const n = norm(c.text);
    if (!n || n === w || (n.length >= 3 && w.includes(n)) || (w.length >= 3 && n.includes(w))) c.why = 'word';
    else if (filter && hasProfanity(c.text)) c.why = 'filter';
    else if (count[n] > 1) c.why = 'dup';
    else c.why = null;
  }
}

const isSeat = (s: EchoState, k: string) => s.seats.some((p) => p.key === k);
const guesser = (s: EchoState) => s.guessers[s.round];

function ready(s: EchoState, ctx: GameCtx): void {
  s.phase = 'ready';
  s.stepEnds = ctx.now + displayMs(s.round === 0 ? 9000 : 4000, ctx);
  s.timer = null;
  s.clues = {};
  s.guess = null;
  s.passed = false;
  s.correct = false;
  s.last = {};
}

function toGuess(s: EchoState, ctx: GameCtx): void {
  judge(s.clues, s.words[s.round], ctx.filter);
  s.phase = 'guess';
  s.timer = inputDeadline(45_000, ctx);
}

function reveal(s: EchoState, ctx: GameCtx): void {
  if (s.phase === 'clue') judge(s.clues, s.words[s.round], ctx.filter);
  const g = guesser(s);
  s.correct = !!s.guess && sameWord(s.guess, s.words[s.round]);
  if (s.correct) {
    s.last[g] = GUESS_POINTS;
    for (const [k, c] of Object.entries(s.clues)) if (!c.why) s.last[k] = CLUE_POINTS;
  }
  for (const [k, n] of Object.entries(s.last)) s.points[k] = (s.points[k] ?? 0) + n;
  s.phase = 'reveal';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(9000, ctx);
}

function cluers(s: EchoState, active: string[]): string[] {
  return active.filter((k) => isSeat(s, k) && k !== guesser(s));
}

export const echoLogic: GameLogic<EchoState> = {
  id: 'echo',
  title: 'Echo Chamber',
  tagline: 'One-word clues. Say the same as someone else and you both vanish.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const order = shuffle(players, ctx.rand).map((p) => p.key);
    const rounds = Math.min(8, players.length < 4 ? players.length * 2 : players.length);
    const s: EchoState = {
      seats: players,
      words: shuffle(WORDS, ctx.rand).slice(0, rounds),
      guessers: Array.from({ length: rounds }, (_, i) => order[i % order.length]),
      round: 0,
      phase: 'ready',
      stepEnds: 0,
      timer: null,
      clues: {},
      guess: null,
      passed: false,
      correct: false,
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
      last: {},
    };
    ready(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; text?: string; round?: number };
    if (d.round !== s.round || who.role !== 'player' || !isSeat(s, who.key)) return false;
    const text = String(d.text ?? '').trim().split(/\s+/)[0]?.slice(0, 24) ?? '';
    if (d.t === 'clue' && s.phase === 'clue' && who.key !== guesser(s) && !s.clues[who.key] && text) {
      s.clues[who.key] = { text, why: null };
      if (cluers(s, ctx.active).every((k) => s.clues[k])) toGuess(s, ctx);
      return true;
    }
    if (d.t === 'guess' && s.phase === 'guess' && who.key === guesser(s)) {
      if (text) s.guess = text;
      else s.passed = true;
      reveal(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    const due = s.timer && ctx.now >= s.timer.endsAt;
    if (s.phase === 'ready' && ctx.now >= s.stepEnds) {
      s.phase = 'clue';
      s.timer = inputDeadline(50_000, ctx);
      return true;
    }
    if (s.phase === 'clue' && (due || (cluers(s, ctx.active).length > 0 && cluers(s, ctx.active).every((k) => s.clues[k])))) return toGuess(s, ctx), true;
    if (s.phase === 'guess' && due) return reveal(s, ctx), true;
    if (s.phase === 'reveal' && ctx.now >= s.stepEnds) {
      if (s.round + 1 >= s.words.length) s.phase = 'done';
      else {
        s.round++;
        ready(s, ctx);
      }
      return true;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'ready') s.stepEnds = 0;
    else if (s.phase === 'clue') toGuess(s, ctx);
    else if (s.phase === 'guess') reveal(s, ctx);
    else if (s.phase === 'reveal') s.stepEnds = 0;
    this.tick(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const showClues = s.phase === 'guess' || s.phase === 'reveal';
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.words.length,
      timer: s.timer,
      guesser: guesser(s),
      seats: s.seats.map((p) => p.key),
      sent: Object.keys(s.clues),
      // The guesser reads the TV, so cancelled clues stay face down until the reveal.
      clues: showClues
        ? Object.entries(s.clues).map(([k, c]) => ({ key: k, text: !c.why || revealed ? c.text : null, why: c.why }))
        : null,
      word: revealed ? s.words[s.round] : null,
      guess: revealed ? s.guess : null,
      passed: revealed ? s.passed : false,
      correct: revealed ? s.correct : null,
      last: revealed ? s.last : null,
    };
  },

  privateState(s, who) {
    const isGuesser = who.key === guesser(s);
    return {
      guesser: isGuesser,
      word: isGuesser && s.phase !== 'reveal' ? null : s.words[s.round],
      clue: s.clues[who.key]?.text ?? null,
      audience: who.role === 'audience' || !isSeat(s, who.key),
    };
  },
};
