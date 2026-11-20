import { describe, expect, it } from 'vitest';
import type { GameCtx, GameLogic } from '../src/core/game';
import { pidKey } from '../src/core/protocol';
import { mulberry32 } from '../src/core/rng';
import { addBot, bots, join, newRoom, removeBot, seated, sweep } from '../src/core/room';
import { GAMES, gameById, seatsFor } from '../src/games';
import { sauceLogic } from '../src/games/sauce/logic';
import { snackLogic } from '../src/games/snack/logic';
import { tumbleLogic } from '../src/games/tumble/logic';

describe('bots in the room', () => {
  it('fill seats, never take VIP, never go away, and can be removed', () => {
    const r = newRoom('ABCD', 'tumble');
    const b1 = addBot(r, 1)!;
    expect(b1.vip).toBe(false);
    join(r, 'p1', 'Ann', 2, pidKey);
    addBot(r, 3);
    expect(seated(r).find((p) => p.vip)?.name).toBe('Ann');
    expect(bots(r)).toHaveLength(2);
    sweep(r, 1e9);
    expect(bots(r).every((b) => b.connected)).toBe(true);
    expect(join(r, 'p2', b1.name, 4, pidKey).ok).toBe(false);
    for (let i = 0; i < 10; i++) addBot(r, 5 + i);
    expect(seated(r)).toHaveLength(8);
    expect(removeBot(r)).toBe(true);
    expect(seated(r)).toHaveLength(7);
    expect(new Set(seated(r).map((p) => p.look)).size).toBe(7);
  });

  it('only sit at games that support them', () => {
    const ps = [{ key: 'a' }, { key: 'bot1', bot: true }];
    expect(seatsFor(gameById('tumble')!, ps)).toHaveLength(2);
    expect(seatsFor(gameById('mole')!, ps)).toHaveLength(1);
    expect(GAMES.filter((g) => g.logic.bot).map((g) => g.logic.id).sort()).toEqual(['sauce', 'snack', 'tumble']);
  });
});

/** One idle human (who only ever times out) and the rest bots, driven like the host does. */
function playSolo<T>(L: GameLogic<T>, nBots: number, seed: number) {
  const seats = ['you', ...Array.from({ length: nBots }, (_, i) => `bot${i + 1}`)].map((key) => ({ key, name: key }));
  let now = 1_000_000;
  const rand = mulberry32(seed);
  const ctx = (): GameCtx => ({ now, rand, timer: 'normal', filter: true, active: seats.map((p) => p.key) });
  const s = L.setup(seats, ctx());
  let botMoves = 0;
  for (let i = 0; i < 20_000 && !L.isOver(s); i++) {
    now += 500;
    for (const b of seats.slice(1)) {
      if (L.bot!.wants(s, b.key)) {
        expect(L.onInput(s, { key: b.key, role: 'player' }, L.bot!.move(s, b.key, ctx()), ctx())).toBe(true);
        botMoves++;
      }
    }
    L.tick(s, ctx());
  }
  return { over: L.isOver(s), botMoves, points: L.results(s) };
}

describe('bot players', () => {
  for (const [L, n] of [
    [tumbleLogic, 1],
    [tumbleLogic, 5],
    [sauceLogic, 2],
    [sauceLogic, 4],
    [snackLogic, 2],
    [snackLogic, 6],
  ] as const) {
    it(`${L.id} with ${n} bot(s) plays to the end with only legal moves`, () => {
      for (const seed of [1, 2, 3]) {
        const r = playSolo(L as GameLogic, n, seed);
        expect(r.over).toBe(true);
        expect(r.botMoves).toBeGreaterThan(0);
      }
    });
  }

  it('snack bots outscore random picking', () => {
    let bot = 0;
    let lazy = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = playSolo(snackLogic, 2, seed);
      bot += (r.points.bot1 + r.points.bot2) / 2;
      lazy += r.points.you;
    }
    expect(bot).toBeGreaterThan(lazy);
  });

  it('tumble bots outscore a gentle default flick', () => {
    let bot = 0;
    let lazy = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = playSolo(tumbleLogic, 1, seed);
      bot += r.points.bot1;
      lazy += r.points.you;
    }
    expect(bot).toBeGreaterThan(lazy);
  });
});
