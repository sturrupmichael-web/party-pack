/**
 * Phish or Legit: a speed round. The TV shows a message (email, link or text);
 * everyone taps PHISH or LEGIT. Right answers score 500 plus up to 500 for
 * speed. The reveal highlights the clues. Audience picks are shown as a crowd
 * split but never score.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { shuffle } from '../../core/rng';
import content from './content.json';

export type Pick = 'phish' | 'legit';

export interface Clue {
  text: string;
  why: string;
}

export interface PhishItem {
  id: string;
  kind: 'email' | 'url' | 'sms';
  answer: Pick;
  from?: string;
  subject?: string;
  body: string;
  url?: string;
  context?: string;
  clues: Clue[];
}

export const ITEMS = content.items as PhishItem[];
export const ROUNDS = 8;
export const BASE_POINTS = 500;
export const SPEED_POINTS = 500;
/** Speed bonus window when the timer is off. */
const NO_TIMER_WINDOW = 15_000;

type Phase = 'intro' | 'ready' | 'answer' | 'reveal' | 'done';

export interface PhishState {
  seats: Seat[];
  items: PhishItem[];
  round: number;
  phase: Phase;
  /** When the current intro/ready/reveal step ends (host ms). */
  stepEnds: number;
  timer: TimerInfo | null;
  answerStart: number;
  answers: Record<string, { pick: Pick; ms: number; pts: number }>;
  crowd: Record<string, Pick>;
  points: Record<string, number>;
}

export function speedPoints(ms: number, window: number): number {
  return Math.round(SPEED_POINTS * Math.max(0, 1 - ms / window));
}

function beginRound(s: PhishState, ctx: GameCtx): void {
  s.phase = 'ready';
  s.stepEnds = ctx.now + displayMs(2500, ctx);
  s.answers = {};
  s.crowd = {};
  s.timer = null;
}

function beginAnswer(s: PhishState, ctx: GameCtx): void {
  s.phase = 'answer';
  s.answerStart = ctx.now;
  s.timer = inputDeadline(15_000, ctx);
}

function reveal(s: PhishState, ctx: GameCtx): void {
  const item = s.items[s.round];
  const window = s.timer?.total ?? NO_TIMER_WINDOW;
  for (const [key, a] of Object.entries(s.answers)) {
    a.pts = a.pick === item.answer ? BASE_POINTS + speedPoints(a.ms, window) : 0;
    s.points[key] = (s.points[key] ?? 0) + a.pts;
  }
  s.phase = 'reveal';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(4000 + 1800 * item.clues.length, ctx);
}

function next(s: PhishState, ctx: GameCtx): void {
  if (s.round + 1 >= s.items.length) {
    s.phase = 'done';
    return;
  }
  s.round++;
  beginRound(s, ctx);
}

function everyoneAnswered(s: PhishState, ctx: GameCtx): boolean {
  const live = ctx.active.filter((k) => s.seats.some((p) => p.key === k));
  return live.length > 0 && live.every((k) => s.answers[k]);
}

export const phishLogic: GameLogic<PhishState> = {
  id: 'phish',
  title: 'Phish or Legit',
  tagline: 'Spot the scam before the clock runs out.',
  minPlayers: 1,
  maxPlayers: 8,

  setup(players, ctx) {
    // Mix kinds and keep both answers in play.
    const items = shuffle(ITEMS, ctx.rand).slice(0, ROUNDS);
    return {
      seats: players,
      items,
      round: 0,
      phase: 'intro',
      stepEnds: ctx.now + displayMs(7000, ctx),
      timer: null,
      answerStart: 0,
      answers: {},
      crowd: {},
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
    };
  },

  onInput(s, who: Who, data, ctx) {
    const d = data as { round?: unknown; pick?: unknown };
    if (s.phase !== 'answer' || d?.round !== s.round) return false;
    if (d.pick !== 'phish' && d.pick !== 'legit') return false;
    if (who.role === 'audience' || !s.seats.some((p) => p.key === who.key)) {
      if (s.crowd[who.key]) return false;
      s.crowd[who.key] = d.pick;
      return true;
    }
    if (s.answers[who.key]) return false; // locked in
    s.answers[who.key] = { pick: d.pick, ms: Math.max(0, ctx.now - s.answerStart), pts: 0 };
    if (everyoneAnswered(s, ctx)) reveal(s, ctx);
    return true;
  },

  tick(s, ctx) {
    switch (s.phase) {
      case 'intro':
        if (ctx.now >= s.stepEnds) return beginRound(s, ctx), true;
        return false;
      case 'ready':
        if (ctx.now >= s.stepEnds) return beginAnswer(s, ctx), true;
        return false;
      case 'answer':
        if ((s.timer && ctx.now >= s.timer.endsAt) || everyoneAnswered(s, ctx)) return reveal(s, ctx), true;
        return false;
      case 'reveal':
        if (ctx.now >= s.stepEnds) return next(s, ctx), true;
        return false;
      default:
        return false;
    }
  },

  skip(s, ctx) {
    if (s.phase === 'intro') beginRound(s, ctx);
    else if (s.phase === 'ready') beginAnswer(s, ctx);
    else if (s.phase === 'answer') reveal(s, ctx);
    else if (s.phase === 'reveal') next(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const item = s.items[s.round];
    const shown = s.phase === 'answer' || s.phase === 'reveal';
    const revealed = s.phase === 'reveal';
    const crowd = Object.values(s.crowd);
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.items.length,
      timer: s.phase === 'answer' ? s.timer : null,
      kind: item?.kind ?? 'email',
      item: shown && item ? { kind: item.kind, from: item.from, subject: item.subject, body: item.body, url: item.url, context: item.context } : null,
      answered: Object.keys(s.answers),
      answer: revealed ? item.answer : null,
      clues: revealed ? item.clues : null,
      picks: revealed ? Object.fromEntries(Object.entries(s.answers).map(([k, a]) => [k, { pick: a.pick, pts: a.pts }])) : null,
      crowd: revealed && crowd.length ? { phish: crowd.filter((c) => c === 'phish').length, legit: crowd.filter((c) => c === 'legit').length } : null,
      points: s.points,
      seats: s.seats.map((p) => p.key),
    };
  },

  privateState(s, who) {
    const a = s.answers[who.key];
    const pick = a?.pick ?? s.crowd[who.key] ?? null;
    return {
      pick,
      correct: s.phase === 'reveal' && pick ? pick === s.items[s.round].answer : null,
      answer: s.phase === 'reveal' ? s.items[s.round].answer : null,
      pts: s.phase === 'reveal' ? (a?.pts ?? 0) : null,
      total: s.points[who.key] ?? 0,
    };
  },
};
