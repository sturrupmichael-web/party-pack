import { describe, expect, it } from 'vitest';
import type { GameCtx, GameLogic } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { MATCH_POINTS, RELAY_POINTS, bookFor, doodleLogic as D, samePhrase } from '../src/games/doodle/logic';
import { decodeStroke, encodeStroke, sanitize, toSvg } from '../src/games/doodle/ink';
import { DICE_EACH, ROUNDS, diceLeft, tumbleLogic as T } from '../src/games/tumble/logic';
import { EDGES, simulate, stepAt, type Die } from '../src/games/tumble/physics';

function harness<T>(L: GameLogic<T>, n = 4, active?: string[]) {
  const seats = 'abcdefgh'.slice(0, n).split('').map((k) => ({ key: k, name: k }));
  let now = 1_000_000;
  const rand = mulberry32(5);
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

describe('Doodle Relay ink', () => {
  it('round-trips strokes and limits junk', () => {
    const s = { c: 2, w: 1, p: [[0, 0], [999, 749], [500, 10]] as Array<[number, number]> };
    expect(decodeStroke(encodeStroke(s))).toEqual(s);
    expect(sanitize(['zz', 5, '01', encodeStroke(s), '<script>'])).toEqual([encodeStroke(s)]);
    expect(sanitize([encodeStroke({ c: 0, w: 0, p: Array(2000).fill([1, 1]) })])).toEqual([]);
    expect(toSvg([encodeStroke(s)])).toContain('polyline');
  });

  it('matches phrases loosely', () => {
    expect(samePhrase('A Cat in the bathtub', 'cat in bathtub')).toBe(true);
    expect(samePhrase('cats', 'cat')).toBe(true);
    expect(samePhrase('dog', 'cat')).toBe(false);
    expect(samePhrase('', '')).toBe(false);
  });
});

describe('Doodle Relay', () => {
  it('passes books along: draw, guess, draw…, scores matches, then reveals', () => {
    const h = harness(D, 4);
    const o: string[] = h.s.seats.map((p: any) => p.key);
    expect(h.s.steps).toBe(4);
    const line = encodeStroke({ c: 0, w: 1, p: [[10, 10], [200, 200]] });
    // Step 0: everyone draws their own prompt.
    const pr0 = D.privateState(h.s, { key: o[0], role: 'player' }, h.ctx()) as any;
    expect(pr0.text).toBe(h.s.prompts[0]);
    expect(pr0.drawing).toBeNull();
    expect(h.input(o[0], { t: 'guess', step: 0, text: 'x' })).toBe(false);
    for (const k of o) h.input(k, { t: 'draw', step: 0, d: [line] });
    expect(h.s.step).toBe(1);
    // Step 1: seat 1 guesses book 0 (seat 0's drawing).
    expect(bookFor(h.s, 1)).toBe(0);
    const pr1 = D.privateState(h.s, { key: o[1], role: 'player' }, h.ctx()) as any;
    expect(pr1.kind).toBe('guess');
    expect(pr1.drawing).toEqual([line]);
    h.input(o[1], { t: 'guess', step: 1, text: h.s.prompts[0] }); // right!
    h.input(o[2], { t: 'guess', step: 1, text: 'banana' });
    h.input(o[3], { t: 'draft', step: 1, text: 'half typed' });
    // o[0] and o[3] run out of time: o[3]'s draft is used.
    h.wait(31_000);
    expect(h.s.step).toBe(2);
    expect(h.s.books[2][1].text).toBe('half typed');
    expect(h.s.books[1][1].text).toBe('banana');
    expect(h.s.books[3][1].text).toBe('');
    expect(h.s.points[o[1]]).toBe(MATCH_POINTS);
    expect(h.s.points[o[0]]).toBe(MATCH_POINTS);
    // Step 2: seat 2 draws what seat 1 guessed for book 0.
    expect((D.privateState(h.s, { key: o[2], role: 'player' }, h.ctx()) as any).text).toBe(h.s.prompts[0]);
    for (const k of o) h.input(k, { t: 'draw', step: 2, d: [line] });
    // Step 3: seat 3 guesses book 0 right again → perfect relay.
    h.input(o[3], { t: 'guess', step: 3, text: h.s.prompts[0] });
    for (const k of o.slice(0, 3)) h.input(k, { t: 'guess', step: 3, text: 'nope' });
    expect(h.s.phase).toBe('reveal');
    expect(h.s.perfect[0]).toBe(true);
    expect(h.s.points[o[1]]).toBe(MATCH_POINTS + RELAY_POINTS);
    const pub = D.publicState(h.s, h.ctx()) as any;
    expect(pub.book.entries).toHaveLength(0);
    // Prompts never leak during play.
    let guard = 0;
    while (h.s.phase !== 'done' && guard++ < 100) h.wait(10_000);
    expect(h.s.phase).toBe('done');
  });

  it("doesn't wait for players who left", () => {
    const h = harness(D, 3, ['a']);
    h.input('a', { t: 'draw', step: 0, d: [] });
    h.wait(1);
    expect(h.s.step).toBe(1);
  });
});

describe('Tumble Steps physics', () => {
  const die = (id: number, x = 0, y = 320): Die => ({ id, owner: 'a', face: 3, x, y, gone: false });
  it('soft flicks stay on the pad, hard ones fall off, middle ones land on steps', () => {
    const r = mulberry32(1);
    const soft = die(1);
    simulate([], soft, { aim: 0, power: 0, lane: 0.5 }, r);
    expect(soft.gone).toBe(true);
    const hard = die(2);
    simulate([], hard, { aim: 0, power: 1, lane: 0.5 }, r);
    expect(hard.gone).toBe(true);
    const mid = die(3);
    const sim = simulate([], mid, { aim: 0, power: 0.5, lane: 0.5 }, r);
    expect(mid.gone).toBe(false);
    expect(stepAt(mid.x)).toBeGreaterThanOrEqual(0);
    expect(sim.tumbles).toBeGreaterThan(0);
    expect(sim.frames.length).toBeGreaterThan(5);
  });

  it('dice knock each other', () => {
    const sitting = die(1, EDGES[1] + 40, 320);
    const before = sitting.x;
    const sim = simulate([sitting], die(2), { aim: 0, power: 0.7, lane: 0.5 }, mulberry32(2));
    expect(sim.hits).toBeGreaterThan(0);
    expect(sitting.x).toBeGreaterThan(before);
  });
});

describe('Tumble Steps', () => {
  it('one die per turn around the table, 4 dice each, auto-flicks on timeout', () => {
    const h = harness(T, 3);
    const [a, b, c] = (h.s.seats as Array<{ key: string }>).map((p) => p.key);
    expect(h.input(b, { t: 'flick', n: h.s.nextId, aim: 0, power: 0.5, lane: 0.5 })).toBe(false);
    expect(h.input(a, { t: 'flick', n: h.s.nextId, aim: 0, power: 0.5, lane: 0.5 })).toBe(true);
    expect(h.s.phase).toBe('roll');
    expect(h.input(a, { t: 'flick', n: h.s.nextId, aim: 0, power: 0.5, lane: 0.5 })).toBe(false);
    h.wait(10_000);
    expect(h.s.phase).toBe('aim');
    expect(h.s.seats[h.s.turn].key).toBe(b);
    expect(diceLeft(h.s)).toEqual({ [a]: DICE_EACH - 1, [b]: DICE_EACH, [c]: DICE_EACH });
    const order: string[] = [a];
    let guard = 0;
    while (h.s.phase !== 'done' && guard++ < 600) {
      if (h.s.phase === 'aim' && order.length < h.s.thrown + 1) order.push(h.s.seats[h.s.turn].key);
      h.wait(h.s.phase === 'aim' ? 25_000 : 10_000);
    }
    expect(h.s.phase).toBe('done');
    expect(DICE_EACH).toBe(4);
    expect(h.s.thrown).toBe(3 * DICE_EACH);
    expect(order).toEqual(Array.from({ length: 3 * DICE_EACH }, (_, i) => [a, b, c][i % 3]));
    expect(Object.values(diceLeft(h.s))).toEqual([0, 0, 0]);
    expect(h.s.roundScores).toHaveLength(ROUNDS);
  });
});

describe('Tumble Steps rolling and the ×4 pockets', () => {
  it('only the pockets on the last step pay ×4; the strips between pay ×2', async () => {
    const { multAt, EDGES: E, CY: cy, halfWidth: hw } = await import('../src/games/tumble/physics');
    const x = (E[3] + E[4]) / 2;
    expect(multAt(x, cy)).toBe(4);
    expect(multAt(x, cy + 0.36 * hw(x))).toBe(2);
    expect(multAt(x, cy - 0.7 * hw(x))).toBe(4);
    expect(multAt((E[2] + E[3]) / 2, cy + 0.36 * hw(x))).toBe(3);
    expect(multAt(E[4] + 5, cy)).toBe(0);
  });

  it('a die tips one face per roll length, and its faces stay a real die', async () => {
    const P = await import('../src/games/tumble/physics');
    const d: any = { face: 1, south: 3, east: P.eastOf(1, 3) };
    P.tip(d, '+x');
    P.tip(d, '+x');
    P.tip(d, '+x');
    P.tip(d, '+x');
    expect(d.face).toBe(1);
    for (const dir of ['+y', '-x', '+y', '-y', '+x'] as const) {
      P.tip(d, dir);
      expect(new Set([d.face, d.east, d.south, 7 - d.face, 7 - d.east, 7 - d.south]).size).toBe(6);
    }
    // The final face comes from the roll: the same throw lands the same way.
    const a = { id: 1, owner: 'a', face: 1, x: 0, y: 0, gone: false };
    const b = { id: 1, owner: 'a', face: 1, x: 0, y: 0, gone: false };
    P.simulate([], a, { aim: 0.1, power: 0.6, lane: 0.4 }, mulberry32(9));
    P.simulate([], b, { aim: 0.1, power: 0.6, lane: 0.4 }, mulberry32(9));
    expect(a.face).toBe(b.face);
    expect(a.x).toBe(b.x);
  });
});
