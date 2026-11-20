import { describe, expect, it } from 'vitest';
import type { GameCtx, GameLogic } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { GAME_POINTS, TASTE_POINTS, sauceLogic as H } from '../src/games/sauce/logic';
import { CARDS, POINT_RATE, ROUNDS, cookieScores, handSize, makeDeck, scoreSpread, snackLogic as S } from '../src/games/snack/logic';

function harness<T>(L: GameLogic<T>, n = 4, active?: string[]) {
  const seats = 'abcdefgh'.slice(0, n).split('').map((k) => ({ key: k, name: k }));
  let now = 1_000_000;
  const rand = mulberry32(7);
  const ctx = (): GameCtx => ({ now, rand, timer: 'normal', filter: true, active: active ?? seats.map((p) => p.key) });
  const s = L.setup(seats, ctx());
  return {
    s: s as any,
    seats,
    ctx,
    input: (key: string, data: unknown) => L.onInput(s, { key, role: 'player' }, data, ctx()),
    wait: (ms: number) => ((now += ms), L.tick(s, ctx())),
  };
}

describe('Hot Sauce', () => {
  it('everyone places first, then bids, and a clean tasting wins', () => {
    const h = harness(H);
    const order: string[] = h.s.seats.map((p: any) => p.key);
    const r = h.s.round;
    expect(h.s.phase).toBe('first');
    for (const k of order) expect(h.input(k, { t: 'place', cup: 'mild', round: r })).toBe(true);
    expect(h.input(order[0], { t: 'place', cup: 'mild', round: r })).toBe(true); // turn phase now
    expect(h.s.phase).toBe('turn');
    expect(h.s.turn).toBe(order[1]);
    expect(h.input(order[0], { t: 'bid', n: 1, round: r })).toBe(false); // not your turn
    expect(h.input(order[1], { t: 'bid', n: 99, round: r })).toBe(false); // more than the table
    expect(h.input(order[1], { t: 'bid', n: 2, round: r })).toBe(true);
    expect(h.s.phase).toBe('bid');
    expect(h.input(order[2], { t: 'bid', n: 2, round: r })).toBe(false); // must raise
    h.input(order[2], { t: 'pass', round: r });
    h.input(order[3], { t: 'pass', round: r });
    h.input(order[0], { t: 'pass', round: r });
    expect(h.s.phase).toBe('taste');
    expect(h.s.taster).toBe(order[1]);
    // Own stack (1 mild) auto-flipped; one more needed.
    expect(h.s.flipped).toEqual([{ owner: order[1], cup: 'mild' }]);
    expect(h.input(order[1], { t: 'flip', owner: order[1], round: r })).toBe(false);
    h.input(order[1], { t: 'flip', owner: order[0], round: r });
    expect(h.s.phase).toBe('result');
    expect(h.s.result.ok).toBe(true);
    expect(h.s.wins[order[1]]).toBe(1);
    expect(h.s.points[order[1]]).toBe(TASTE_POINTS);
    h.wait(20_000);
    expect(h.s.phase).toBe('first');
    expect(h.s.turn).toBe(order[1]); // the winner starts
  });

  it('hitting a hot cup loses one of your cups; private stacks stay private', () => {
    const h = harness(H, 3);
    const o: string[] = h.s.seats.map((p: any) => p.key);
    const r = h.s.round;
    h.input(o[0], { t: 'place', cup: 'mild', round: r });
    h.input(o[1], { t: 'place', cup: 'hot', round: r });
    h.input(o[2], { t: 'place', cup: 'mild', round: r });
    const pub = JSON.stringify(H.publicState(h.s, h.ctx()));
    expect(pub).not.toContain('hot"'); // nobody's cup kinds leak while face down
    expect((H.privateState(h.s, { key: o[1], role: 'player' }, h.ctx()) as any).stack).toEqual(['hot']);
    h.input(o[0], { t: 'bid', n: 2, round: r });
    h.input(o[1], { t: 'pass', round: r });
    h.input(o[2], { t: 'pass', round: r });
    h.input(o[0], { t: 'flip', owner: o[1], round: r });
    expect(h.s.result).toMatchObject({ ok: false, taster: o[0], hotOwner: o[1] });
    expect(h.s.owned[o[0]].mild + h.s.owned[o[0]].hot).toBe(3);
    h.wait(20_000);
    expect(h.s.turn).toBe(o[1]); // the hot cup's owner starts next
  });

  it('two wins takes the game, and timeouts keep it moving', () => {
    const h = harness(H, 3);
    let guard = 0;
    while (h.s.phase !== 'done' && guard++ < 500) h.wait(40_000);
    expect(h.s.phase).toBe('done');
    expect(h.s.winner).toBeTruthy();
    expect(H.results(h.s)[h.s.winner]).toBeGreaterThanOrEqual(GAME_POINTS);
  });
});

describe('Snack Swap', () => {
  it('scores spreads', () => {
    expect(scoreSpread(['pizza', 'pizza', 'pizza', 'pizza', 'pizza'], [0]).total).toBe(13);
    expect(scoreSpread(['taco', 'taco'], [2, 1]).total).toBe(8);
    expect(scoreSpread(['taco'], [1, 2]).total).toBe(2);
    expect(scoreSpread(['fries', 'fries', 'fries', 'fries', 'dip'], [0]).total).toBe(10);
    expect(scoreSpread(['pretzel', 'pretzel', 'fries', 'taco'], [1]).parts.pretzel).toBe(6);
    expect(scoreSpread(['pepper', 'pepper'], [0]).total).toBe(-4);
    expect(scoreSpread(['pepper', 'pepper', 'pepper'], [0]).total).toBe(12);
    expect(cookieScores({ a: 3, b: 1, c: 3 })).toEqual({ a: 10, b: 2, c: 10 });
  });

  it('deals enough cards for 8 players', () => {
    expect(makeDeck(8, mulberry32(1)).length).toBeGreaterThanOrEqual(8 * handSize(8));
    expect(new Set(makeDeck(3, mulberry32(1)))).toEqual(new Set(CARDS.map((c) => c.id)));
  });

  it('picks are secret until everyone has picked, then hands pass', () => {
    const h = harness(S, 4);
    const o: string[] = h.s.seats.map((p: any) => p.key);
    const pid = () => h.s.round * 100 + h.s.pick;
    const handB = [...h.s.hands[1]];
    expect(h.input(o[0], { t: 'pick', i: 0, pick: pid() })).toBe(true);
    expect(h.input(o[0], { t: 'pick', i: 99, pick: pid() })).toBe(false);
    expect((S.publicState(h.s, h.ctx()) as any).spreads[o[0]]).toEqual([]);
    expect(h.input(o[0], { t: 'unpick', pick: pid() })).toBe(true);
    for (const k of o) h.input(k, { t: 'pick', i: 0, pick: pid() });
    expect(h.s.phase).toBe('show');
    expect(h.s.spreads[o[1]]).toEqual([handB[0]]);
    // Round 1 passes left: seat 2 now holds what seat 1 had left.
    expect(h.s.hands[2]).toEqual(handB.slice(1));
    h.wait(5000);
    expect(h.s.phase).toBe('pick');
    expect(h.s.pick).toBe(2);
  });

  it('plays three rounds to the end, auto-picking for absent players', () => {
    const h = harness(S, 5, ['a', 'b']);
    let guard = 0;
    while (h.s.phase !== 'done' && guard++ < 500) h.wait(15_000);
    expect(h.s.phase).toBe('done');
    expect(h.s.roundScores).toHaveLength(ROUNDS);
    const res = S.results(h.s);
    for (const v of Object.values(res)) expect(v % POINT_RATE).toBe(0);
  });
});
