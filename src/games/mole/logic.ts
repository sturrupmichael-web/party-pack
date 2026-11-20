/**
 * Mole Hunt: social deduction. Every phone shows the same secret place and a
 * role, except the mole's, which says "You're the mole". Players ask each other
 * questions out loud. Anyone can accuse once per round (everyone else must
 * agree), the mole can try to name the place at any time, and when the clock
 * runs out everyone votes. A caught mole still gets one guess at the place.
 */
import type { GameCtx, GameLogic, Seat, TimerInfo, Who } from '../../core/game';
import { displayMs, inputDeadline } from '../../core/game';
import { shuffle } from '../../core/rng';
import content from './content.json';

export interface Place {
  name: string;
  roles: string[];
}
export const PLACES = content.places as Place[];
export const ROUNDS = 3;
export const BOARD_SIZE = 20;
export const ASK_MS = 6 * 60_000;
const UNIT = 250;
export const POINTS = {
  moleWins: 4 * UNIT,
  moleGuessBonus: 2 * UNIT,
  crewWins: 2 * UNIT,
  accuserBonus: 2 * UNIT,
};

type Phase = 'brief' | 'ask' | 'accuse' | 'final' | 'guess' | 'reveal' | 'done';
export type Outcome = 'caught' | 'wrong-accuse' | 'mole-guessed' | 'mole-missed' | 'caught-guessed' | 'no-majority';

export interface MoleState {
  seats: Seat[];
  /** Place names on the board this game. */
  board: string[];
  /** Order of places used for each round (indexes into board). */
  plan: number[];
  moles: string[];
  round: number;
  phase: Phase;
  stepEnds: number;
  timer: TimerInfo | null;
  /** Ask time left while paused for an accusation (ms, null = untimed). */
  askLeft: number | null;
  askTotal: number;
  firstAsker: string;
  roles: Record<string, string>;
  usedAccuse: string[];
  accuse: { by: string; target: string; votes: Record<string, boolean> } | null;
  finalVotes: Record<string, string>;
  /** Who started the successful accusation (for the bonus). */
  accuser: string | null;
  moleGuess: string | null;
  outcome: Outcome | null;
  points: Record<string, number>;
  last: Record<string, number>;
}

const place = (s: MoleState) => s.board[s.plan[s.round]];
const mole = (s: MoleState) => s.moles[s.round];
const isSeat = (s: MoleState, k: string) => s.seats.some((p) => p.key === k);

function startRound(s: MoleState, ctx: GameCtx): void {
  const p = PLACES.find((x) => x.name === place(s))!;
  const roles = shuffle(p.roles, ctx.rand);
  s.roles = {};
  s.seats.forEach((seat, i) => (s.roles[seat.key] = seat.key === mole(s) ? '' : roles[i % roles.length]));
  s.firstAsker = s.seats[Math.floor(ctx.rand() * s.seats.length)].key;
  s.phase = 'brief';
  s.stepEnds = ctx.now + displayMs(9000, ctx);
  s.timer = null;
  s.usedAccuse = [];
  s.accuse = null;
  s.finalVotes = {};
  s.accuser = null;
  s.moleGuess = null;
  s.outcome = null;
  s.last = {};
}

function beginAsk(s: MoleState, ctx: GameCtx, left?: number | null): void {
  s.phase = 'ask';
  if (left === undefined) s.timer = inputDeadline(ASK_MS, ctx);
  else s.timer = left == null ? null : { endsAt: ctx.now + left, total: s.askTotal || left };
  s.askLeft = null;
}

function pauseAsk(s: MoleState, ctx: GameCtx): void {
  s.askLeft = s.timer ? Math.max(0, s.timer.endsAt - ctx.now) : null;
  s.askTotal = s.timer?.total ?? 0;
}

function finish(s: MoleState, outcome: Outcome, ctx: GameCtx): void {
  s.outcome = outcome;
  s.phase = 'reveal';
  s.timer = null;
  s.stepEnds = ctx.now + displayMs(12_000, ctx);
  const m = mole(s);
  const moleWon = outcome === 'wrong-accuse' || outcome === 'mole-guessed' || outcome === 'caught-guessed' || outcome === 'no-majority';
  const add = (k: string, n: number) => {
    s.last[k] = (s.last[k] ?? 0) + n;
    s.points[k] = (s.points[k] ?? 0) + n;
  };
  if (moleWon) add(m, POINTS.moleWins + (outcome === 'mole-guessed' || outcome === 'caught-guessed' ? POINTS.moleGuessBonus : 0));
  else {
    for (const p of s.seats) if (p.key !== m) add(p.key, POINTS.crewWins);
    if (s.accuser && s.accuser !== m) add(s.accuser, POINTS.accuserBonus);
  }
}

function moleCaught(s: MoleState, ctx: GameCtx): void {
  s.phase = 'guess';
  s.timer = inputDeadline(30_000, ctx);
}

function resolveAccuse(s: MoleState, ctx: GameCtx, active: string[]): void {
  const a = s.accuse!;
  const voters = active.filter((k) => k !== a.target && isSeat(s, k));
  const yes = voters.length > 0 && voters.every((k) => a.votes[k] === true);
  s.accuse = null;
  if (!yes) return beginAsk(s, ctx, s.askLeft);
  s.accuser = a.by;
  if (a.target === mole(s)) moleCaught(s, ctx);
  else finish(s, 'wrong-accuse', ctx);
}

function resolveFinal(s: MoleState, ctx: GameCtx): void {
  const count: Record<string, number> = {};
  for (const t of Object.values(s.finalVotes)) count[t] = (count[t] ?? 0) + 1;
  const top = Math.max(0, ...Object.values(count));
  const leaders = Object.keys(count).filter((k) => count[k] === top);
  if (top === 0 || leaders.length !== 1) return finish(s, 'no-majority', ctx);
  if (leaders[0] === mole(s)) return moleCaught(s, ctx);
  finish(s, 'wrong-accuse', ctx);
}

function allIn(keys: string[], have: Record<string, unknown>): boolean {
  return keys.length > 0 && keys.every((k) => k in have);
}

export const moleLogic: GameLogic<MoleState> = {
  id: 'mole',
  title: 'Mole Hunt',
  tagline: 'Everyone knows the place. Except the mole.',
  minPlayers: 3,
  maxPlayers: 8,

  setup(players, ctx) {
    const board = shuffle(PLACES, ctx.rand)
      .slice(0, BOARD_SIZE)
      .map((p) => p.name)
      .sort();
    const plan = shuffle(
      board.map((_, i) => i),
      ctx.rand,
    ).slice(0, ROUNDS);
    // Spread the mole role around: nobody is mole twice before everyone has been once.
    const order = shuffle(players, ctx.rand).map((p) => p.key);
    const moles = Array.from({ length: ROUNDS }, (_, i) => order[i % order.length]);
    const s: MoleState = {
      seats: players,
      board,
      plan,
      moles,
      round: 0,
      phase: 'brief',
      stepEnds: 0,
      timer: null,
      askLeft: null,
      askTotal: 0,
      firstAsker: players[0].key,
      roles: {},
      usedAccuse: [],
      accuse: null,
      finalVotes: {},
      accuser: null,
      moleGuess: null,
      outcome: null,
      points: Object.fromEntries(players.map((p) => [p.key, 0])),
      last: {},
    };
    startRound(s, ctx);
    return s;
  },

  onInput(s, who: Who, data, ctx) {
    const d = (data ?? {}) as { t?: string; target?: string; yes?: boolean; place?: string; round?: number };
    if (d.round !== s.round || !isSeat(s, who.key) || who.role !== 'player') return false;
    const me = who.key;
    const amMole = me === mole(s);
    switch (d.t) {
      case 'accuse':
        if (s.phase !== 'ask' || s.usedAccuse.includes(me) || !d.target || d.target === me || !isSeat(s, d.target)) return false;
        s.usedAccuse.push(me);
        pauseAsk(s, ctx);
        s.phase = 'accuse';
        s.accuse = { by: me, target: d.target, votes: { [me]: true } };
        s.timer = inputDeadline(40_000, ctx);
        return true;
      case 'vote':
        if (s.phase !== 'accuse' || !s.accuse || me === s.accuse.target || me in s.accuse.votes) return false;
        s.accuse.votes[me] = !!d.yes;
        if (d.yes === false) resolveAccuse(s, ctx, ctx.active); // one "no" is enough to clear them
        else if (allIn(ctx.active.filter((k) => k !== s.accuse!.target && isSeat(s, k)), s.accuse.votes)) resolveAccuse(s, ctx, ctx.active);
        return true;
      case 'final':
        if (s.phase !== 'final' || !d.target || d.target === me || !isSeat(s, d.target) || me in s.finalVotes) return false;
        s.finalVotes[me] = d.target;
        if (allIn(ctx.active.filter((k) => isSeat(s, k)), s.finalVotes)) resolveFinal(s, ctx);
        return true;
      case 'guess': {
        if (!amMole || (s.phase !== 'ask' && s.phase !== 'guess') || !d.place || !s.board.includes(d.place)) return false;
        const caught = s.phase === 'guess';
        s.moleGuess = d.place;
        const right = d.place === place(s);
        finish(s, right ? (caught ? 'caught-guessed' : 'mole-guessed') : caught ? 'caught' : 'mole-missed', ctx);
        return true;
      }
    }
    return false;
  },

  tick(s, ctx) {
    const due = (s.timer && ctx.now >= s.timer.endsAt) || false;
    switch (s.phase) {
      case 'brief':
        if (ctx.now >= s.stepEnds) return beginAsk(s, ctx), true;
        return false;
      case 'ask':
        if (due) {
          s.phase = 'final';
          s.timer = inputDeadline(45_000, ctx);
          return true;
        }
        return false;
      case 'accuse':
        if (due && s.accuse) return resolveAccuse(s, ctx, Object.keys(s.accuse.votes)), true;
        return false;
      case 'final':
        if (due) return resolveFinal(s, ctx), true;
        return false;
      case 'guess':
        if (due) return finish(s, 'caught', ctx), true;
        return false;
      case 'reveal':
        if (ctx.now >= s.stepEnds) {
          if (s.round + 1 >= s.plan.length) s.phase = 'done';
          else {
            s.round++;
            startRound(s, ctx);
          }
          return true;
        }
        return false;
    }
    return false;
  },

  skip(s, ctx) {
    if (s.phase === 'brief') beginAsk(s, ctx);
    else if (s.phase === 'ask') {
      s.phase = 'final';
      s.timer = inputDeadline(45_000, ctx);
    } else if (s.phase === 'accuse' && s.accuse) resolveAccuse(s, ctx, Object.keys(s.accuse.votes));
    else if (s.phase === 'final') resolveFinal(s, ctx);
    else if (s.phase === 'guess') finish(s, 'caught', ctx);
    else if (s.phase === 'reveal') s.stepEnds = 0;
  },

  isOver: (s) => s.phase === 'done',
  results: (s) => ({ ...s.points }),

  publicState(s) {
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      round: s.round,
      rounds: s.plan.length,
      timer: s.timer,
      board: s.board,
      seats: s.seats.map((p) => p.key),
      firstAsker: s.firstAsker,
      usedAccuse: s.usedAccuse,
      accuse: s.accuse ? { by: s.accuse.by, target: s.accuse.target, voted: Object.keys(s.accuse.votes).length } : null,
      finalVoted: Object.keys(s.finalVotes),
      place: revealed ? place(s) : null,
      mole: revealed ? mole(s) : null,
      moleGuess: revealed ? s.moleGuess : null,
      outcome: revealed ? s.outcome : null,
      finalVotes: revealed ? s.finalVotes : null,
      last: revealed ? s.last : null,
      points: s.points,
    };
  },

  privateState(s, who) {
    if (who.role === 'audience' || !isSeat(s, who.key)) {
      // The audience is in on the secret: half the fun is watching the mole squirm.
      return { audience: true, place: place(s), mole: mole(s) };
    }
    const amMole = who.key === mole(s);
    return {
      mole: amMole,
      place: amMole ? null : place(s),
      role: s.roles[who.key] ?? '',
      canAccuse: s.phase === 'ask' && !s.usedAccuse.includes(who.key),
      voted: s.phase === 'accuse' ? (s.accuse ? who.key in s.accuse.votes : false) : s.phase === 'final' ? who.key in s.finalVotes : false,
    };
  },
};
