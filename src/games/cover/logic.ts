/**
 * Cover Story: two teams, 25 words on the TV. Each team has a Code-giver who
 * sees on their phone which words belong to which team (plus one Burn word).
 * Code-givers take turns giving a one-word clue and a number; their team votes
 * on their phones to reveal words. A word is revealed when most of the team's
 * connected guessers pick it. Find all your words first. Reveal the Burn word
 * and your team loses on the spot.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { censor } from '../../core/profanity';
import { shuffle } from '../../core/rng';
import { norm } from '../echo/logic';
import content from './content.json';

export const WORDS = content.words as string[];
export const TEAM_NAMES = ['Teal', 'Coral'] as const;
export const WIN_POINTS = 1000;
export const WORD_POINTS = 50;

/** 0 / 1 = that team's word, 'n' = bystander, 'x' = the Burn word. */
export type Card = 0 | 1 | 'n' | 'x';
type Phase = 'teams' | 'clue' | 'guess' | 'over' | 'done';

export interface CoverState {
  seats: Seat[];
  teams: [string[], string[]];
  givers: [string, string];
  words: string[];
  key: Card[];
  revealed: boolean[];
  first: 0 | 1;
  turn: 0 | 1;
  phase: Phase;
  stepEnds: number;
  timer: TimerInfo | null;
  clue: { word: string; n: number } | null;
  guessesLeft: number;
  votes: Record<string, number | 'end'>;
  winner: 0 | 1 | null;
  reason: 'all' | 'burn' | null;
  log: Array<{ team: 0 | 1; clue: string; n: number }>;
  points: Record<string, number>;
}

const teamOf = (s: CoverState, k: string): 0 | 1 | null => (s.teams[0].includes(k) ? 0 : s.teams[1].includes(k) ? 1 : null);
const left = (s: CoverState, t: 0 | 1) => s.key.filter((c, i) => c === t && !s.revealed[i]).length;

/** Guessers on the team whose turn it is, who are connected. */
function voters(s: CoverState, active: string[]): string[] {
  return s.teams[s.turn].filter((k) => k !== s.givers[s.turn] && active.includes(k));
}

function needed(s: CoverState, active: string[]): number {
  const n = voters(s, active).length;
  return Math.max(1, Math.floor(n / 2) + 1);
}

function toClue(s: CoverState, ctx: GameCtx): void {
  s.phase = 'clue';
  s.clue = null;
  s.votes = {};
  s.timer = inputDeadline(120_000, ctx);
}

function endTurn(s: CoverState, ctx: GameCtx): void {
  s.turn = (1 - s.turn) as 0 | 1;
  toClue(s, ctx);
}

function win(s: CoverState, t: 0 | 1, reason: 'all' | 'burn', ctx: GameCtx): void {
  s.winner = t;
  s.reason = reason;
  s.phase = 'over';
  s.timer = null;
  s.votes = {};
  s.stepEnds = ctx.now + displayMs(14_000, ctx);
  for (const team of [0, 1] as const) {
    const found = s.key.filter((c, i) => c === team && s.revealed[i]).length;
    for (const k of s.teams[team]) s.points[k] = (team === t ? WIN_POINTS : 0) + found * WORD_POINTS;
  }
}

export function reveal(s: CoverState, i: number, ctx: GameCtx): void {
  s.revealed[i] = true;
  s.votes = {};
  const c = s.key[i];
  const me = s.turn;
  const them = (1 - me) as 0 | 1;
  if (c === 'x') return win(s, them, 'burn', ctx);
  if (left(s, 0) === 0) return win(s, 0, 'all', ctx);
  if (left(s, 1) === 0) return win(s, 1, 'all', ctx);
  if (c === me) {
    s.guessesLeft--;
    if (s.guessesLeft <= 0) endTurn(s, ctx);
    return;
  }
  endTurn(s, ctx);
}

function tally(s: CoverState, ctx: GameCtx): void {
  const need = needed(s, ctx.active);
  const count = new Map<number | 'end', number>();
  for (const [k, v] of Object.entries(s.votes)) if (voters(s, ctx.active).includes(k)) count.set(v, (count.get(v) ?? 0) + 1);
  for (const [v, n] of count) {
    if (n < need) continue;
    if (v === 'end') return endTurn(s, ctx);
    return reveal(s, v, ctx);
  }
}

export const coverLogic: GameLogic<CoverState> = {
  id: 'cover',
  title: 'Cover Story',
  tagline: 'Two teams, one grid of words, two code-givers.',
  minPlayers: 4,
  maxPlayers: 8,

  setup(players, ctx) {
    const order = shuffle(players, ctx.rand).map((p) => p.key);
    const teams: [string[], string[]] = [[], []];
    order.forEach((k, i) => teams[i % 2].push(k));
    const first = (ctx.rand() < 0.5 ? 0 : 1) as 0 | 1;
    const second = (1 - first) as 0 | 1;
    const key = shuffle<Card>([...Array(9).fill(first), ...Array(8).fill(second), ...Array(7).fill('n'), 'x'], ctx.rand);
    const s: CoverState = {
      seats: players,
      teams,
      givers: [teams[0][0], teams[1][0]],
      words: shuffle(WORDS, ctx.rand).slice(0, 25),
      key,
      revealed: Array(25).fill(false),
      first,
      turn: first,
      phase: 'teams',
      stepEnds: ctx.now + displayMs(12_000, ctx),
      timer: null,
      clue: null,
      guessesLeft: 0,
      votes: {},
      winner: null,
      reason: null,
      log: [],
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
    };
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; word?: string; n?: number; i?: number | 'end' };
    const team = teamOf(s, who.key);
    if (team === null || who.role !== 'player') return false;
    if (d.t === 'clue' && s.phase === 'clue' && who.key === s.givers[s.turn]) {
      let word = String(d.word ?? '').trim().split(/\s+/)[0]?.slice(0, 24) ?? '';
      const n = Math.round(Number(d.n));
      if (!word || !(n >= 1 && n <= 9)) return false;
      if (s.words.some((w, i) => !s.revealed[i] && norm(w) === norm(word))) return false; // can't say a word on the board
      if (ctx.filter) word = censor(word);
      s.clue = { word, n };
      s.log.push({ team: s.turn, clue: word, n });
      s.guessesLeft = n + 1;
      s.votes = {};
      s.phase = 'guess';
      s.timer = inputDeadline(150_000, ctx);
      return true;
    }
    if (d.t === 'vote' && s.phase === 'guess' && team === s.turn && who.key !== s.givers[s.turn]) {
      const v = d.i;
      if (v !== 'end' && !(Number.isInteger(v) && v! >= 0 && v! < 25 && !s.revealed[v!])) return false;
      if (s.votes[who.key] === v) delete s.votes[who.key];
      else s.votes[who.key] = v!;
      tally(s, ctx);
      return true;
    }
    return false;
  },

  tick(s, ctx) {
    const due = s.timer && ctx.now >= s.timer.endsAt;
    if (s.phase === 'teams' && ctx.now >= s.stepEnds) return toClue(s, ctx), true;
    if ((s.phase === 'clue' || s.phase === 'guess') && due) return endTurn(s, ctx), true;
    if (s.phase === 'over' && ctx.now >= s.stepEnds) {
      s.phase = 'done';
      return true;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'teams') toClue(s, ctx);
    else if (s.phase === 'clue' || s.phase === 'guess') endTurn(s, ctx);
    else if (s.phase === 'over') s.phase = 'done';
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s, ctx) {
    const over = s.phase === 'over';
    return {
      phase: s.phase,
      timer: s.timer,
      teams: s.teams,
      givers: s.givers,
      words: s.words,
      shown: s.key.map((c, i) => (s.revealed[i] || over ? c : null)),
      revealed: s.revealed,
      first: s.first,
      turn: s.turn,
      clue: s.clue,
      guessesLeft: s.guessesLeft,
      votes: s.votes,
      need: s.phase === 'guess' ? needed(s, ctx.active) : 0,
      left: [left(s, 0), left(s, 1)],
      winner: s.winner,
      reason: s.reason,
      log: s.log,
    };
  },

  privateState(s, who) {
    const team = teamOf(s, who.key);
    const giver = team !== null && s.givers[team] === who.key;
    return { team, giver, key: giver ? s.key : null, vote: s.votes[who.key] ?? null };
  },
};
