/**
 * Hot Sauce: bluffing and bidding. Everyone owns four sauce cups: three mild
 * and one blazing hot. Players stack cups face down in front of them, then
 * someone bids how many cups they can taste without hitting a hot one. Bids
 * go round until all but one pass. The taster must drink their own stack
 * first, then picks other players' top cups. Make it and score a win (two
 * wins takes the game). Hit a hot one and lose a cup for good. Lose all
 * your cups and you're out.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { shuffle } from '../../core/rng';

export type Cup = 'mild' | 'hot';
type Phase = 'first' | 'turn' | 'bid' | 'taste' | 'result' | 'done';

export const WINS_NEEDED = 2;
export const TASTE_POINTS = 500;
export const GAME_POINTS = 1000;

export interface SauceState {
  seats: Seat[];
  owned: Record<string, { mild: number; hot: number }>;
  stacks: Record<string, Cup[]>;
  wins: Record<string, number>;
  out: string[];
  phase: Phase;
  turn: string;
  timer: TimerInfo | null;
  stepEnds: number;
  bid: { high: number; by: string; passed: string[] } | null;
  taster: string | null;
  /** Cups flipped this tasting, in order. */
  flipped: Array<{ owner: string; cup: Cup }>;
  result: { ok: boolean; taster: string; hotOwner: string | null; lost: Cup | null; outNow: boolean } | null;
  winner: string | null;
  round: number;
  points: Record<string, number>;
}

const alive = (s: SauceState) => s.seats.map((p) => p.key).filter((k) => !s.out.includes(k));
const placed = (s: SauceState) => alive(s).reduce((a, k) => a + s.stacks[k].length, 0);
const free = (s: SauceState, k: string) => {
  const o = s.owned[k];
  const st = s.stacks[k];
  return { mild: o.mild - st.filter((c) => c === 'mild').length, hot: o.hot - st.filter((c) => c === 'hot').length };
};
const freeCount = (s: SauceState, k: string) => {
  const f = free(s, k);
  return f.mild + f.hot;
};

function nextAlive(s: SauceState, from: string, skip: string[] = []): string {
  const order = s.seats.map((p) => p.key);
  let i = order.indexOf(from);
  for (let n = 0; n < order.length; n++) {
    i = (i + 1) % order.length;
    const k = order[i];
    if (!s.out.includes(k) && !skip.includes(k)) return k;
  }
  return from;
}

function newRound(s: SauceState, starter: string, ctx: GameCtx): void {
  for (const k of s.seats.map((p) => p.key)) s.stacks[k] = [];
  s.phase = 'first';
  s.turn = s.out.includes(starter) ? nextAlive(s, starter) : starter;
  s.bid = null;
  s.taster = null;
  s.flipped = [];
  s.result = null;
  s.round++;
  s.timer = inputDeadline(30_000, ctx);
}

function turnTimer(s: SauceState, ctx: GameCtx): void {
  s.timer = inputDeadline(30_000, ctx);
}

function place(s: SauceState, k: string, cup: Cup): boolean {
  if (free(s, k)[cup] <= 0) return false;
  s.stacks[k].push(cup);
  return true;
}

function startTaste(s: SauceState, ctx: GameCtx): void {
  s.phase = 'taste';
  s.taster = s.bid!.by;
  s.turn = s.taster;
  s.flipped = [];
  // Your own stack comes first, all of it, top to bottom.
  const own = s.stacks[s.taster].slice().reverse();
  for (const cup of own) {
    s.flipped.push({ owner: s.taster, cup });
    if (cup === 'hot') return finishTaste(s, false, s.taster, ctx);
  }
  checkTaste(s, ctx);
  if (s.phase === 'taste') turnTimer(s, ctx);
}

function flippedOf(s: SauceState, owner: string): number {
  return s.flipped.filter((f) => f.owner === owner).length;
}

function checkTaste(s: SauceState, ctx: GameCtx): void {
  const mild = s.flipped.filter((f) => f.cup === 'mild').length;
  if (mild >= s.bid!.high) finishTaste(s, true, null, ctx);
}

function finishTaste(s: SauceState, ok: boolean, hotOwner: string | null, ctx: GameCtx): void {
  const t = s.taster!;
  let lost: Cup | null = null;
  let outNow = false;
  if (ok) {
    s.wins[t] = (s.wins[t] ?? 0) + 1;
    s.points[t] = (s.points[t] ?? 0) + TASTE_POINTS;
  } else {
    // Lose one of your cups at random, for good.
    const o = s.owned[t];
    const pool: Cup[] = [...Array(o.mild).fill('mild'), ...Array(o.hot).fill('hot')];
    lost = pool[Math.floor(ctx.rand() * pool.length)] ?? null;
    if (lost) o[lost]--;
    if (o.mild + o.hot === 0) {
      s.out.push(t);
      outNow = true;
    }
  }
  s.result = { ok, taster: t, hotOwner, lost, outNow };
  s.phase = 'result';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(9000, ctx);
  const left = alive(s);
  if (s.wins[t] >= WINS_NEEDED) s.winner = t;
  else if (left.length === 1) s.winner = left[0];
  if (s.winner) s.points[s.winner] = (s.points[s.winner] ?? 0) + GAME_POINTS;
}

function afterPlace(s: SauceState, ctx: GameCtx): void {
  // Everyone has placed their first cup: turns begin with the starter.
  if (s.phase === 'first' && alive(s).every((k) => s.stacks[k].length > 0)) {
    s.phase = 'turn';
    turnTimer(s, ctx);
  }
}

/** Current actor must act; used for timeouts. */
function autoAct(s: SauceState, ctx: GameCtx): void {
  if (s.phase === 'first') {
    for (const k of alive(s)) if (!s.stacks[k].length) place(s, k, free(s, k).mild > 0 ? 'mild' : 'hot');
    afterPlace(s, ctx);
  } else if (s.phase === 'turn') {
    if (freeCount(s, s.turn) > 0) {
      place(s, s.turn, free(s, s.turn).mild > 0 ? 'mild' : 'hot');
      s.turn = nextAlive(s, s.turn);
      turnTimer(s, ctx);
    } else doBid(s, s.turn, 1, ctx);
  } else if (s.phase === 'bid') doPass(s, s.turn, ctx);
  else if (s.phase === 'taste') {
    const opts = alive(s).filter((k) => k !== s.taster && flippedOf(s, k) < s.stacks[k].length);
    if (opts.length) flip(s, opts[Math.floor(ctx.rand() * opts.length)], ctx);
  }
}

function doBid(s: SauceState, k: string, n: number, ctx: GameCtx): boolean {
  const total = placed(s);
  if (!(Number.isInteger(n) && n >= 1 && n <= total)) return false;
  if (s.phase === 'turn') s.bid = { high: n, by: k, passed: [] };
  else if (s.bid && n > s.bid.high) {
    s.bid.high = n;
    s.bid.by = k;
  } else return false;
  s.phase = 'bid';
  if (n === total) return startTaste(s, ctx), true;
  s.turn = nextAlive(s, k, s.bid.passed);
  if (s.turn === k) startTaste(s, ctx);
  else turnTimer(s, ctx);
  return true;
}

function doPass(s: SauceState, k: string, ctx: GameCtx): void {
  s.bid!.passed.push(k);
  const still = alive(s).filter((x) => !s.bid!.passed.includes(x));
  if (still.length <= 1) return startTaste(s, ctx);
  s.turn = nextAlive(s, k, s.bid!.passed);
  turnTimer(s, ctx);
}

function flip(s: SauceState, owner: string, ctx: GameCtx): boolean {
  const n = flippedOf(s, owner);
  const st = s.stacks[owner];
  if (owner === s.taster || n >= st.length) return false;
  const cup = st[st.length - 1 - n];
  s.flipped.push({ owner, cup });
  if (cup === 'hot') finishTaste(s, false, owner, ctx);
  else {
    checkTaste(s, ctx);
    if (s.phase === 'taste') turnTimer(s, ctx);
  }
  return true;
}

export const sauceLogic: GameLogic<SauceState> = {
  id: 'sauce',
  title: 'Hot Sauce',
  tagline: 'Bid on cups, and pray none of them is the hot one.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const order = shuffle(players, ctx.rand);
    const s: SauceState = {
      seats: order,
      owned: Object.fromEntries(order.map((p) => [p.key, { mild: 3, hot: 1 }])),
      stacks: Object.fromEntries(order.map((p) => [p.key, []])),
      wins: Object.fromEntries(order.map((p) => [p.key, 0])),
      out: [],
      phase: 'first',
      turn: order[0].key,
      timer: null,
      stepEnds: 0,
      bid: null,
      taster: null,
      flipped: [],
      result: null,
      winner: null,
      round: 0,
      points: Object.fromEntries(order.map((p) => [p.key, 0])),
    };
    newRound(s, order[0].key, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; cup?: Cup; n?: number; owner?: string; round?: number };
    const k = who.key;
    if (who.role !== 'player' || !s.seats.some((p) => p.key === k) || s.out.includes(k) || d.round !== s.round) return false;
    if (d.t === 'place' && (d.cup === 'mild' || d.cup === 'hot')) {
      if (s.phase === 'first') {
        if (s.stacks[k].length || !place(s, k, d.cup)) return false;
        afterPlace(s, ctx);
        return true;
      }
      if (s.phase === 'turn' && s.turn === k && place(s, k, d.cup)) {
        s.turn = nextAlive(s, k);
        turnTimer(s, ctx);
        return true;
      }
      return false;
    }
    if (s.turn !== k) return false;
    if (d.t === 'bid' && (s.phase === 'turn' || s.phase === 'bid')) return doBid(s, k, Number(d.n), ctx);
    if (d.t === 'pass' && s.phase === 'bid') return doPass(s, k, ctx), true;
    if (d.t === 'flip' && s.phase === 'taste' && typeof d.owner === 'string' && !s.out.includes(d.owner)) return flip(s, d.owner, ctx);
    return false;
  },

  tick(s, ctx) {
    if (s.phase === 'result') {
      if (ctx.now < s.stepEnds) return false;
      if (s.winner) s.phase = 'done';
      else {
        const r = s.result!;
        newRound(s, r.ok ? r.taster : (r.hotOwner ?? r.taster), ctx);
      }
      return true;
    }
    if (s.timer && ctx.now >= s.timer.endsAt) {
      autoAct(s, ctx);
      return true;
    }
    // A player who left mid-turn: don't stall the table.
    if ((s.phase === 'turn' || s.phase === 'bid' || s.phase === 'taste') && !ctx.active.includes(s.turn) && !s.timer) {
      autoAct(s, ctx);
      return true;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'result') s.stepEnds = 0;
    else autoAct(s, ctx);
    this.tick(s, ctx);
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const counts: Record<string, number> = {};
    const owned: Record<string, number> = {};
    for (const p of s.seats) {
      counts[p.key] = s.stacks[p.key].length;
      owned[p.key] = s.owned[p.key].mild + s.owned[p.key].hot;
    }
    return {
      phase: s.phase,
      round: s.round,
      timer: s.timer,
      order: s.seats.map((p) => p.key),
      counts,
      owned,
      wins: s.wins,
      out: s.out,
      turn: s.turn,
      total: placed(s),
      bid: s.bid,
      taster: s.taster,
      flipped: s.flipped,
      firstDone: s.phase === 'first' ? alive(s).filter((k) => s.stacks[k].length > 0) : null,
      result: s.result,
      winner: s.winner,
    };
  },

  privateState(s, who) {
    if (!s.owned[who.key]) return { audience: true };
    return { owned: s.owned[who.key], free: free(s, who.key), stack: s.stacks[who.key], out: s.out.includes(who.key) };
  },

  bot: {
    wants: (s, key) =>
      !s.out.includes(key) &&
      ((s.phase === 'first' && !s.stacks[key].length) || ((s.phase === 'turn' || s.phase === 'bid' || s.phase === 'taste') && s.turn === key)),
    move: (s, key, ctx) => ({ round: s.round, ...botMove(s, key, ctx.rand) }),
  },
};

/** How many cups a bot reckons it can taste: its own mild stack, plus a guess at the others. */
function botReach(s: SauceState, key: string, rand: () => number): number {
  const mine = s.stacks[key];
  if (mine.includes('hot')) return 0;
  const others = placed(s) - mine.length;
  return mine.length + Math.floor(others * (0.35 + rand() * 0.25));
}

/** A simple bluffer: hides its hot cup now and then, bids what it thinks it can taste. */
export function botMove(s: SauceState, key: string, rand: () => number): { t: string; cup?: Cup; n?: number; owner?: string } {
  const f = free(s, key);
  const cup = (hotChance: number): Cup => (f.hot > 0 && (f.mild === 0 || rand() < hotChance) ? 'hot' : 'mild');
  if (s.phase === 'first') return { t: 'place', cup: cup(0.3) };
  if (s.phase === 'turn') {
    const reach = botReach(s, key, rand);
    const total = placed(s);
    const canPlace = f.mild + f.hot > 0;
    // Keep stacking while the pile is small, or when our own stack is a trap.
    if (canPlace && (total < s.seats.length + 1 || reach === 0 || rand() < 0.4)) return { t: 'place', cup: cup(0.25) };
    return { t: 'bid', n: Math.max(1, Math.min(total, reach || 1)) };
  }
  if (s.phase === 'bid') {
    const reach = botReach(s, key, rand);
    const high = s.bid?.high ?? 0;
    if (reach > high && high + 1 <= placed(s)) return { t: 'bid', n: high + 1 };
    return { t: 'pass' };
  }
  // Tasting: pick from the tallest stack left (one hot among more cups is less likely on top).
  const opts = alive(s).filter((k) => k !== s.taster && flippedOf(s, k) < s.stacks[k].length);
  opts.sort((a, b) => s.stacks[b].length - flippedOf(s, b) - (s.stacks[a].length - flippedOf(s, a)) || rand() - 0.5);
  return { t: 'flip', owner: opts[0] ?? key };
}
