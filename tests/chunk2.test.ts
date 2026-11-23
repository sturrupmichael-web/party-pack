import { describe, expect, it } from 'vitest';
import type { GameCtx, GameLogic } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { CUE_POINTS, markPoints, swatchLogic as S } from '../src/games/swatch/logic';
import { COLS, ROWS, cellName, idx } from '../src/games/swatch/grid';
import { WIN_POINTS, WORDS, coverLogic as C } from '../src/games/cover/logic';

function harness<T>(L: GameLogic<T>, n = 4) {
  const seats = 'abcdefgh'.slice(0, n).split('').map((k) => ({ key: k, name: k }));
  let now = 1_000_000;
  const ctx = (): GameCtx => ({ now, rand: mulberry32(11), timer: 'normal', filter: true, active: seats.map((p) => p.key) });
  const s = L.setup(seats, ctx());
  return {
    s: s as any,
    seats,
    ctx,
    input: (key: string, data: unknown) => L.onInput(s, { key, role: 'player' }, data, ctx()),
    wait: (ms: number) => ((now += ms), L.tick(s, ctx())),
  };
}

describe('Swatch Watch rounds', () => {
  it('everyone gives the cues twice, in the same rotation', () => {
    for (const n of [3, 5, 8]) {
      const ps = 'abcdefgh'.slice(0, n).split('').map((k) => ({ key: k, name: k }));
      const s = S.setup(ps, { now: 0, rand: mulberry32(n), timer: 'normal', filter: true, active: ps.map((p) => p.key) }) as any;
      expect(s.cuers).toHaveLength(2 * n);
      expect(s.cuers.slice(n)).toEqual(s.cuers.slice(0, n));
      expect(new Set(s.cuers.slice(0, n)).size).toBe(n);
    }
  });
});

describe('Swatch Watch', () => {
  it('names cells and scores by rings', () => {
    expect(cellName(0)).toBe('A1');
    expect(cellName(idx(1, 23))).toBe('B24');
    const t = idx(5, 10);
    expect(markPoints(t, t)).toBe(300);
    expect(markPoints(idx(6, 11), t)).toBe(200);
    expect(markPoints(idx(7, 8), t)).toBe(100);
    expect(markPoints(idx(8, 10), t)).toBe(0);
  });

  it('plays a full round: pick + clue, two marks each, a second clue, reveal', () => {
    const h = harness(S);
    const cuer = h.s.cuers[0];
    const g = h.seats.map((p) => p.key).filter((k) => k !== cuer);
    const opts = (S.privateState(h.s, { key: cuer, role: 'player' }, h.ctx()) as any).options;
    expect(opts).toHaveLength(4);
    expect((S.privateState(h.s, { key: g[0], role: 'player' }, h.ctx()) as any).options).toBeNull();
    expect(h.input(cuer, { t: 'clue', i: 9999, text: 'sky', round: 0 })).toBe(false);
    h.input(cuer, { t: 'clue', i: opts[0], text: 'sky blue', round: 0 });
    expect(h.s.clues).toEqual(['sky']); // first clue is one word
    expect(h.s.phase).toBe('guess1');
    const t = opts[0];
    h.input(g[0], { t: 'mark', i: t, round: 0 });
    h.input(g[1], { t: 'mark', i: t + 1 < COLS * ROWS ? t + 1 : t - 1, round: 0 });
    h.input(g[2], { t: 'mark', i: (t + 6) % (COLS * ROWS), round: 0 });
    expect(h.s.phase).toBe('clue2');
    h.input(cuer, { t: 'clue', text: 'clear summer', round: 0 });
    expect(h.s.phase).toBe('guess2');
    expect(h.input(g[0], { t: 'mark', i: t, round: 0 })).toBe(false); // can't stack on your own mark
    for (const k of g) h.input(k, { t: 'mark', i: t, round: 0 }) || h.input(k, { t: 'mark', i: (t + 3 * COLS) % (COLS * ROWS), round: 0 });
    expect(h.s.phase).toBe('reveal');
    expect((S.publicState(h.s, h.ctx()) as any).target).toBe(t);
    expect(h.s.last[cuer]).toBeGreaterThanOrEqual(3 * CUE_POINTS);
    expect(h.s.last[g[0]]).toBeGreaterThanOrEqual(300);
  });

  it('a cue-giver who never picks skips the round; the game ends', () => {
    const h = harness(S);
    for (let i = 0; i < 100 && !S.isOver(h.s); i++) h.wait(80_000);
    expect(S.isOver(h.s)).toBe(true);
  });
});

describe('Cover Story', () => {
  it('deals 9/8/7/1 with balanced teams and keeps the key secret', () => {
    const h = harness(C, 5);
    const count = (v: unknown) => h.s.key.filter((c: unknown) => c === v).length;
    expect(count(h.s.first)).toBe(9);
    expect(count(1 - h.s.first)).toBe(8);
    expect(count('n')).toBe(7);
    expect(count('x')).toBe(1);
    expect(h.s.teams[0].length - h.s.teams[1].length).toBe(1);
    const pub = C.publicState(h.s, h.ctx()) as any;
    expect(pub.shown.every((x: unknown) => x === null)).toBe(true);
    const giver = h.s.givers[0];
    const op = h.s.teams[0][1];
    expect((C.privateState(h.s, { key: giver, role: 'player' }, h.ctx()) as any).key).toHaveLength(25);
    expect((C.privateState(h.s, { key: op, role: 'player' }, h.ctx()) as any).key).toBeNull();
    expect(WORDS.length).toBeGreaterThan(200);
  });

  it('majority vote reveals; own words keep the turn; a wrong word passes it', () => {
    const h = harness(C, 6); // 3 per team: giver + 2 guessers, so 2 votes needed
    h.wait(15_000);
    const t = h.s.turn;
    const [giver, g1, g2] = h.s.teams[t];
    expect(h.input(giver, { t: 'clue', word: h.s.words[0], n: 2 })).toBe(false); // board word
    h.input(giver, { t: 'clue', word: 'zzz', n: 2 });
    expect(h.s.phase).toBe('guess');
    const mine = h.s.key.findIndex((c: unknown) => c === t);
    h.input(g1, { t: 'vote', i: mine });
    expect(h.s.revealed[mine]).toBe(false);
    h.input(g2, { t: 'vote', i: mine });
    expect(h.s.revealed[mine]).toBe(true);
    expect(h.s.turn).toBe(t);
    expect(h.s.guessesLeft).toBe(2);
    const bystander = h.s.key.findIndex((c: unknown) => c === 'n');
    h.input(g1, { t: 'vote', i: bystander });
    h.input(g2, { t: 'vote', i: bystander });
    expect(h.s.turn).toBe(1 - t);
    expect(h.s.phase).toBe('clue');
  });

  it('revealing the Burn word loses at once', () => {
    const h = harness(C, 4); // 2 per team: one guesser, so 1 vote reveals
    h.wait(15_000);
    const t = h.s.turn;
    const [giver, g1] = h.s.teams[t];
    h.input(giver, { t: 'clue', word: 'zzz', n: 1 });
    h.input(g1, { t: 'vote', i: h.s.key.indexOf('x') });
    expect(h.s.winner).toBe(1 - t);
    expect(h.s.reason).toBe('burn');
    for (const k of h.s.teams[1 - t]) expect(h.s.points[k]).toBeGreaterThanOrEqual(WIN_POINTS);
    h.wait(20_000);
    expect(C.isOver(h.s)).toBe(true);
  });

  it('finding all your words wins', () => {
    const h = harness(C, 4);
    h.wait(15_000);
    const t = h.s.turn;
    const [giver, g1] = h.s.teams[t];
    h.input(giver, { t: 'clue', word: 'zzz', n: 9 });
    h.s.key.forEach((c: unknown, i: number) => c === t && h.s.phase === 'guess' && h.input(g1, { t: 'vote', i }));
    expect(h.s.winner).toBe(t);
    expect(h.s.reason).toBe('all');
  });
});
