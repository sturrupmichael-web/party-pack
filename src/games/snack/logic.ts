/**
 * Snack Swap: simultaneous drafting. Everyone gets a hand of snack cards,
 * secretly keeps one, and passes the rest along. Repeat until the hands are
 * empty, then score the spread. Three rounds; passing direction flips in
 * round two. Cookies are saved and scored at the very end.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { shuffle } from '../../core/rng';
import content from './content.json';

export type CardId = 'pizza' | 'taco' | 'fries' | 'dip' | 'pretzel' | 'pepper' | 'cookie';
export const CARDS = content.cards as Array<{ id: CardId; name: string; emoji: string; count: number; rule: string }>;
export const ROUNDS = 3;
/** Snack points become pack points at this rate. */
export const POINT_RATE = 50;

export function handSize(n: number): number {
  return n <= 3 ? 9 : n === 4 ? 8 : n <= 6 ? 7 : 6;
}

export function makeDeck(players: number, rand: () => number): CardId[] {
  const need = players * handSize(players);
  const deck: CardId[] = [];
  while (deck.length < need) for (const c of CARDS) for (let i = 0; i < c.count; i++) deck.push(c.id);
  return shuffle(deck, rand);
}

export interface Breakdown {
  total: number;
  parts: Partial<Record<CardId, number>>;
}

/** Score one player's spread for a round. `tacoCounts` is everyone's taco count. */
export function scoreSpread(spread: CardId[], tacoCounts: number[]): Breakdown {
  const n = (id: CardId) => spread.filter((c) => c === id).length;
  const parts: Breakdown['parts'] = {};
  const pizza = n('pizza');
  if (pizza) parts.pizza = Math.floor(pizza / 4) * 12 + (pizza % 4);
  const taco = n('taco');
  if (taco) {
    const most = Math.max(...tacoCounts);
    parts.taco = taco * 2 + (taco === most ? 4 : 0);
  }
  const fries = n('fries');
  if (fries) {
    const dipped = Math.min(fries, n('dip') * 3);
    parts.fries = dipped * 3 + (fries - dipped);
  }
  const pretzel = n('pretzel');
  if (pretzel) {
    const kinds = new Set(spread.filter((c) => c !== 'cookie')).size;
    parts.pretzel = pretzel * kinds;
  }
  const pepper = n('pepper');
  if (pepper) parts.pepper = pepper >= 3 ? pepper * 4 : -2 * pepper;
  const total = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
  return { total, parts };
}

/** End-of-game cookie bonus: 2 each, +4 to whoever has the most (ties all get it). */
export function cookieScores(jars: Record<string, number>): Record<string, number> {
  const most = Math.max(0, ...Object.values(jars));
  return Object.fromEntries(Object.entries(jars).map(([k, c]) => [k, c * 2 + (c > 0 && c === most ? 4 : 0)]));
}

type Phase = 'pick' | 'show' | 'score' | 'final' | 'done';

export interface SnackState {
  seats: Seat[];
  round: number;
  pick: number;
  phase: Phase;
  /** hands[i] is the hand currently held by seats[i]. */
  hands: CardId[][];
  picks: Record<string, number | null>;
  spreads: Record<string, CardId[]>;
  last: Record<string, CardId>;
  jars: Record<string, number>;
  roundScores: Array<Record<string, Breakdown>>;
  cookies: Record<string, number> | null;
  timer: TimerInfo | null;
  stepEnds: number;
  handLen: number;
}

const keys = (s: SnackState) => s.seats.map((p) => p.key);

function deal(s: SnackState, ctx: GameCtx): void {
  const deck = makeDeck(s.seats.length, ctx.rand);
  s.handLen = handSize(s.seats.length);
  s.hands = s.seats.map((_, i) => deck.slice(i * s.handLen, (i + 1) * s.handLen));
  s.spreads = Object.fromEntries(keys(s).map((k) => [k, []]));
  s.pick = 0;
  startPick(s, ctx);
}

function startPick(s: SnackState, ctx: GameCtx): void {
  s.phase = 'pick';
  s.picks = Object.fromEntries(keys(s).map((k) => [k, null]));
  s.last = {};
  s.pick++;
  s.timer = inputDeadline(s.hands[0].length > 3 ? 30_000 : 20_000, ctx);
}

function reveal(s: SnackState, ctx: GameCtx): void {
  s.seats.forEach((p, i) => {
    const hand = s.hands[i];
    const at = s.picks[p.key] ?? Math.floor(ctx.rand() * hand.length);
    const [card] = hand.splice(at, 1);
    s.last[p.key] = card;
    if (card === 'cookie') s.jars[p.key]++;
    s.spreads[p.key].push(card);
  });
  // Pass: odd rounds to the left (next seat), round 2 to the right.
  const n = s.hands.length;
  const dir = s.round % 2 === 1 ? 1 : -1;
  s.hands = s.hands.map((_, i) => s.hands[(i - dir + n) % n]);
  s.phase = 'show';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(2600, ctx);
}

function scoreRound(s: SnackState, ctx: GameCtx): void {
  const tacos = keys(s).map((k) => s.spreads[k].filter((c) => c === 'taco').length);
  s.roundScores.push(Object.fromEntries(keys(s).map((k) => [k, scoreSpread(s.spreads[k], tacos)])));
  s.phase = 'score';
  s.stepEnds = ctx.now + displayMs(12_000, ctx);
}

export function totals(s: SnackState): Record<string, number> {
  return Object.fromEntries(
    keys(s).map((k) => [k, s.roundScores.reduce((a, r) => a + (r[k]?.total ?? 0), 0) + (s.cookies?.[k] ?? 0)]),
  );
}

function allPicked(s: SnackState): boolean {
  return keys(s).every((k) => s.picks[k] != null);
}

export const snackLogic: GameLogic<SnackState> = {
  id: 'snack',
  title: 'Snack Swap',
  tagline: 'Pick a snack, pass the rest. Build the best spread.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const s: SnackState = {
      seats: shuffle(players, ctx.rand),
      round: 1,
      pick: 0,
      phase: 'pick',
      hands: [],
      picks: {},
      spreads: {},
      last: {},
      jars: Object.fromEntries(players.map((p) => [p.key, 0])),
      roundScores: [],
      cookies: null,
      timer: null,
      stepEnds: 0,
      handLen: 0,
    };
    deal(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; i?: number; pick?: number };
    if (who.role !== 'player' || s.phase !== 'pick' || d.pick !== s.round * 100 + s.pick) return false;
    const seat = keys(s).indexOf(who.key);
    if (seat < 0) return false;
    if (d.t === 'unpick') return (s.picks[who.key] = null), true;
    if (d.t !== 'pick') return false;
    const i = Number(d.i);
    if (!Number.isInteger(i) || i < 0 || i >= s.hands[seat].length) return false;
    s.picks[who.key] = i;
    if (allPicked(s)) reveal(s, ctx);
    return true;
  },

  tick(s, ctx) {
    if (s.phase === 'pick') {
      // Absent players, or the clock running out: pick at random for them.
      const lazy = keys(s).filter((k) => s.picks[k] == null && (!ctx.active.includes(k) || (s.timer && ctx.now >= s.timer.endsAt)));
      if (!lazy.length) return false;
      reveal(s, ctx);
      return true;
    }
    if (ctx.now < s.stepEnds) return false;
    if (s.phase === 'show') {
      if (s.hands[0].length) startPick(s, ctx);
      else scoreRound(s, ctx);
    } else if (s.phase === 'score') {
      if (s.round < ROUNDS) {
        s.round++;
        deal(s, ctx);
      } else {
        s.cookies = cookieScores(s.jars);
        s.phase = 'final';
        s.stepEnds = ctx.now + displayMs(12_000, ctx);
      }
    } else if (s.phase === 'final') s.phase = 'done';
    return true;
  },

  skip(s, ctx) {
    if (s.phase === 'pick') reveal(s, ctx);
    else {
      s.stepEnds = 0;
      this.tick(s, ctx);
    }
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => Object.fromEntries(Object.entries(totals(s)).map(([k, v]) => [k, Math.max(0, v) * POINT_RATE])),

  publicState(s) {
    return {
      phase: s.phase,
      round: s.round,
      pick: s.pick,
      pickId: s.round * 100 + s.pick,
      handLen: s.handLen,
      left: s.hands[0]?.length ?? 0,
      dir: s.round % 2 === 1 ? 'left' : 'right',
      order: keys(s),
      done: keys(s).filter((k) => s.picks[k] != null),
      spreads: s.spreads,
      last: s.phase === 'show' ? s.last : null,
      jars: s.jars,
      roundScores: s.phase === 'score' || s.phase === 'final' || s.phase === 'done' ? s.roundScores : null,
      cookies: s.cookies,
      totals: totals(s),
      timer: s.timer,
    };
  },

  privateState(s, who) {
    const seat = keys(s).indexOf(who.key);
    if (seat < 0) return { audience: true };
    return { hand: s.hands[seat], picked: s.picks[who.key] ?? null };
  },

  bot: {
    wants: (s, key) => s.phase === 'pick' && keys(s).includes(key) && s.picks[key] == null,
    move: (s, key, ctx) => ({ t: 'pick', pick: s.round * 100 + s.pick, i: botPick(s, key, ctx.rand) }),
  },
};

/**
 * A greedy snacker: each card is worth what it adds to its spread right now,
 * plus a little for sets it could still finish with the picks left.
 */
export function botPick(s: SnackState, key: string, rand: () => number): number {
  const seat = keys(s).indexOf(key);
  const hand = s.hands[seat];
  const mine = s.spreads[key];
  const left = hand.length - 1;
  const tacos = (spread: CardId[], k: string) => (k === key ? spread : s.spreads[k]).filter((c) => c === 'taco').length;
  const now = scoreSpread(mine, keys(s).map((k) => tacos(mine, k))).total;
  const count = (id: CardId) => mine.filter((c) => c === id).length;
  let best = 0;
  let bestVal = -Infinity;
  hand.forEach((card, i) => {
    const next = [...mine, card];
    let v = scoreSpread(next, keys(s).map((k) => tacos(next, k))).total - now;
    if (card === 'cookie') v = 2.6;
    if (card === 'pizza' && (count('pizza') % 4) + 1 < 4 && left >= 3 - (count('pizza') % 4)) v += 1.5;
    if (card === 'pepper' && count('pepper') + 1 < 3) v = left >= 4 - count('pepper') ? 1.2 + count('pepper') * 2 : -2;
    if (card === 'dip') v = Math.min(3, count('fries')) * 2 + (left > 2 ? 1.5 : 0);
    v += rand() * 0.8;
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  });
  return best;
}
