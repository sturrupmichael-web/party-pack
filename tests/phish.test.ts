import { describe, expect, it } from 'vitest';
import type { GameCtx } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { BASE_POINTS, ITEMS, ROUNDS, type PhishState, phishLogic as L, speedPoints } from '../src/games/phish/logic';

const seats = [
  { key: 'a', name: 'Ann' },
  { key: 'b', name: 'Bob' },
  { key: 'c', name: 'Cat' },
];
function mk(timer: GameCtx['timer'] = 'normal') {
  let now = 1_000_000;
  const ctx = (): GameCtx => ({ now, rand: mulberry32(7), timer, filter: true, active: ['a', 'b', 'c'] });
  const s: PhishState = L.setup(seats, ctx());
  return { s, ctx, adv: (ms: number) => (now += ms), at: () => now };
}
const toAnswer = (t: ReturnType<typeof mk>) => {
  while (t.s.phase !== 'answer') {
    t.adv(10_000);
    L.tick(t.s, t.ctx());
  }
};

describe('Phish or Legit content', () => {
  it('has 30+ messages, both answers, and every clue appears in its message', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(ITEMS.some((i) => i.answer === 'phish') && ITEMS.some((i) => i.answer === 'legit')).toBe(true);
    for (const it of ITEMS) {
      const text = [it.from, it.subject, it.body, it.url].join(' ');
      expect(it.clues.length).toBeGreaterThan(0);
      for (const c of it.clues) expect(text, `${it.id}: ${c.text}`).toContain(c.text);
    }
  });
});

describe('Phish or Legit', () => {
  it('runs intro → ready → answer → reveal for each round, then ends', () => {
    const t = mk();
    expect(t.s.items).toHaveLength(ROUNDS);
    for (let r = 0; r < ROUNDS; r++) {
      toAnswer(t);
      expect(t.s.round).toBe(r);
      t.adv(16_000); // let the timer run out
      L.tick(t.s, t.ctx());
      expect(t.s.phase).toBe('reveal');
      t.adv(30_000);
      L.tick(t.s, t.ctx());
    }
    expect(L.isOver(t.s)).toBe(true);
  });

  it('scores right answers with a speed bonus and ends the round when everyone has answered', () => {
    const t = mk();
    toAnswer(t);
    const right = t.s.items[0].answer;
    const wrong = right === 'phish' ? 'legit' : 'phish';
    t.adv(3000);
    expect(L.onInput(t.s, { key: 'a', role: 'player' }, { round: 0, pick: right }, t.ctx())).toBe(true);
    expect(L.onInput(t.s, { key: 'a', role: 'player' }, { round: 0, pick: wrong }, t.ctx())).toBe(false); // locked
    L.onInput(t.s, { key: 'b', role: 'player' }, { round: 0, pick: wrong }, t.ctx());
    L.onInput(t.s, { key: 'zz', role: 'audience' }, { round: 0, pick: right }, t.ctx());
    expect(t.s.phase).toBe('answer');
    L.onInput(t.s, { key: 'c', role: 'player' }, { round: 0, pick: right }, t.ctx());
    expect(t.s.phase).toBe('reveal');
    expect(t.s.points.a).toBe(BASE_POINTS + speedPoints(3000, 15_000));
    expect(t.s.points.b).toBe(0);
    expect(t.s.points.c).toBe(BASE_POINTS + speedPoints(3000, 15_000));
    expect(L.results(t.s).zz).toBeUndefined();
    const pub = L.publicState(t.s, t.ctx()) as any;
    expect(pub.crowd).toEqual(right === 'phish' ? { phish: 1, legit: 0 } : { phish: 0, legit: 1 });
  });

  it('hides the answer until the reveal and ignores stale rounds', () => {
    const t = mk();
    toAnswer(t);
    const pub = L.publicState(t.s, t.ctx()) as any;
    expect(pub.answer).toBeNull();
    expect(pub.clues).toBeNull();
    expect(JSON.stringify(pub)).not.toContain('"answer":"');
    expect(L.onInput(t.s, { key: 'a', role: 'player' }, { round: 5, pick: 'phish' }, t.ctx())).toBe(false);
  });

  it('with no timer, waits for everyone; skip moves on', () => {
    const t = mk('off');
    toAnswer(t);
    expect(t.s.timer).toBeNull();
    t.adv(120_000);
    L.tick(t.s, t.ctx());
    expect(t.s.phase).toBe('answer');
    L.skip(t.s, t.ctx());
    expect(t.s.phase).toBe('reveal');
  });

  it('state survives a JSON round trip (host refresh)', () => {
    const t = mk();
    toAnswer(t);
    L.onInput(t.s, { key: 'a', role: 'player' }, { round: 0, pick: 'phish' }, t.ctx());
    const copy = JSON.parse(JSON.stringify(t.s));
    expect(copy).toEqual(t.s);
  });
});
