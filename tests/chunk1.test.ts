import { describe, expect, it } from 'vitest';
import type { GameCtx, GameLogic } from '../src/core/game';
import { mulberry32 } from '../src/core/rng';
import { POINTS, PLACES, moleLogic as M } from '../src/games/mole/logic';
import { CLUE_POINTS, GUESS_POINTS, WORDS, echoLogic as E, judge, norm } from '../src/games/echo/logic';
import { SPECTRUMS, dialLogic as D, pointsFor } from '../src/games/dial/logic';

const seats = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, name: k.toUpperCase() }));
function harness<S>(L: GameLogic<S>, timer: GameCtx['timer'] = 'normal') {
  let now = 1_000_000;
  const ctx = (): GameCtx => ({ now, rand: mulberry32(3), timer, filter: true, active: seats.map((p) => p.key) });
  const s = L.setup(seats, ctx());
  const input = (key: string, data: unknown) => L.onInput(s, { key, role: 'player' }, data, ctx());
  const wait = (ms: number) => {
    now += ms;
    return L.tick(s, ctx());
  };
  return { s: s as any, ctx, input, wait };
}

describe('content', () => {
  it('has plenty of it, and every place has 6 roles', () => {
    expect(PLACES.length).toBeGreaterThanOrEqual(30);
    for (const p of PLACES) expect(p.roles).toHaveLength(6);
    expect(WORDS.length).toBeGreaterThanOrEqual(100);
    expect(SPECTRUMS.length).toBeGreaterThanOrEqual(30);
  });
});

describe('Mole Hunt', () => {
  it('only the mole lacks the place, and the audience is in on it', () => {
    const h = harness(M);
    const mole = h.s.moles[0];
    for (const p of seats) {
      const pr = M.privateState(h.s, { key: p.key, role: 'player' }, h.ctx()) as any;
      if (p.key === mole) expect(pr).toMatchObject({ mole: true, place: null });
      else expect(pr.place).toBe(h.s.board[h.s.plan[0]]);
    }
    expect((M.privateState(h.s, { key: 'zz', role: 'audience' }, h.ctx()) as any).mole).toBe(mole);
    const pub = M.publicState(h.s, h.ctx()) as any;
    expect(pub.place).toBeNull();
    expect(pub.mole).toBeNull();
  });

  it('a unanimous accusation of the mole gives them one last guess; a miss means the crew wins', () => {
    const h = harness(M);
    h.wait(10_000);
    expect(h.s.phase).toBe('ask');
    const mole = h.s.moles[0];
    const accuser = seats.find((p) => p.key !== mole)!.key;
    expect(h.input(accuser, { t: 'accuse', target: mole, round: 0 })).toBe(true);
    expect(h.s.phase).toBe('accuse');
    for (const p of seats) if (p.key !== mole && p.key !== accuser) h.input(p.key, { t: 'vote', yes: true, round: 0 });
    expect(h.s.phase).toBe('guess');
    const wrong = h.s.board.find((b: string) => b !== h.s.board[h.s.plan[0]]);
    h.input(mole, { t: 'guess', place: wrong, round: 0 });
    expect(h.s.outcome).toBe('caught');
    expect(h.s.points[accuser]).toBe(POINTS.crewWins + POINTS.accuserBonus);
    expect(h.s.points[mole]).toBe(0);
  });

  it('one NO clears the accused and the clock picks up where it was', () => {
    const h = harness(M);
    h.wait(10_000);
    h.wait(60_000);
    const left = h.s.timer.endsAt - h.ctx().now;
    const [x, y, z] = seats.map((p) => p.key);
    h.input(x, { t: 'accuse', target: y, round: 0 });
    h.wait(5000);
    h.input(z, { t: 'vote', yes: false, round: 0 });
    expect(h.s.phase).toBe('ask');
    expect(h.s.timer.endsAt - h.ctx().now).toBe(left);
    expect(h.input(x, { t: 'accuse', target: y, round: 0 })).toBe(false); // used up
  });

  it('the mole naming the place wins with a bonus; three rounds then over', () => {
    const h = harness(M);
    for (let r = 0; r < 3; r++) {
      h.wait(10_000);
      const mole = h.s.moles[r];
      h.input(mole, { t: 'guess', place: h.s.board[h.s.plan[r]], round: r });
      expect(h.s.outcome).toBe('mole-guessed');
      h.wait(20_000);
    }
    expect(M.isOver(h.s)).toBe(true);
    const total = Object.values(M.results(h.s)).reduce((a, b) => a + b, 0);
    expect(total).toBe(3 * (POINTS.moleWins + POINTS.moleGuessBonus));
  });

  it('time up goes to a final vote; a tie lets the mole slip away', () => {
    const h = harness(M);
    h.wait(10_000);
    h.wait(7 * 60_000);
    expect(h.s.phase).toBe('final');
    const [a, b, c, d] = seats.map((p) => p.key);
    h.input(a, { t: 'final', target: b, round: 0 });
    h.input(b, { t: 'final', target: a, round: 0 });
    h.input(c, { t: 'final', target: d, round: 0 });
    h.input(d, { t: 'final', target: c, round: 0 });
    expect(h.s.outcome).toBe('no-majority');
  });
});

describe('Echo Chamber', () => {
  it('normalises plurals and case', () => {
    expect(norm('Cats!')).toBe('cat');
    expect(norm('berries')).toBe('berry');
    expect(norm('boxes')).toBe('box');
    expect(norm('glass')).toBe('glass');
  });

  it('cancels duplicates and give-aways', () => {
    const clues = { a: { text: 'Ocean', why: null }, b: { text: 'oceans', why: null }, c: { text: 'fish', why: null }, d: { text: 'starfish', why: null } } as any;
    judge(clues, 'Starfish', true);
    expect([clues.a.why, clues.b.why, clues.c.why, clues.d.why]).toEqual(['dup', 'dup', 'word', 'word']);
  });

  it('a right guess scores the guesser and every surviving clue', () => {
    const h = harness(E);
    h.wait(10_000);
    expect(h.s.phase).toBe('clue');
    const g = h.s.guessers[0];
    const word = h.s.words[0];
    const others = seats.map((p) => p.key).filter((k) => k !== g);
    expect((E.privateState(h.s, { key: g, role: 'player' }, h.ctx()) as any).word).toBeNull();
    h.input(others[0], { t: 'clue', text: 'alpha', round: 0 });
    h.input(others[1], { t: 'clue', text: 'Alpha', round: 0 });
    h.input(others[2], { t: 'clue', text: 'bravo extra words', round: 0 });
    expect(h.s.phase).toBe('guess');
    const pub = E.publicState(h.s, h.ctx()) as any;
    expect(pub.clues.filter((c: any) => c.text === null)).toHaveLength(2); // dupes stay face down
    h.input(g, { t: 'guess', text: word.toUpperCase(), round: 0 });
    expect(h.s.correct).toBe(true);
    expect(h.s.points[g]).toBe(GUESS_POINTS);
    expect(h.s.points[others[2]]).toBe(CLUE_POINTS);
    expect(h.s.points[others[0]]).toBe(0);
    expect(h.s.clues[others[2]].text).toBe('bravo');
  });

  it('runs one round per player and ends', () => {
    const h = harness(E);
    for (let i = 0; i < 40 && !E.isOver(h.s); i++) h.wait(60_000);
    expect(E.isOver(h.s)).toBe(true);
    expect(h.s.words).toHaveLength(4);
  });
});

describe('Dial In', () => {
  it('scores by distance', () => {
    expect(pointsFor(50, 50)).toBe(400);
    expect(pointsFor(55, 50)).toBe(300);
    expect(pointsFor(39, 50)).toBe(200);
    expect(pointsFor(30, 50)).toBe(0);
  });

  it('reader clues, others guess, reader gets the average', () => {
    const h = harness(D);
    const reader = h.s.readers[0];
    const t = h.s.targets[0];
    const others = seats.map((p) => p.key).filter((k) => k !== reader);
    expect((D.privateState(h.s, { key: others[0], role: 'player' }, h.ctx()) as any).target).toBeNull();
    expect((D.publicState(h.s, h.ctx()) as any).target).toBeNull();
    h.input(reader, { t: 'clue', text: 'hmm', round: 0 });
    expect(h.s.phase).toBe('guess');
    h.input(others[0], { t: 'guess', v: t, round: 0 });
    h.input(others[1], { t: 'guess', v: t > 50 ? t - 5 : t + 5, round: 0 });
    h.input(others[2], { t: 'guess', v: t > 50 ? 0 : 100, round: 0 });
    expect(h.s.phase).toBe('reveal');
    expect(h.s.last[reader]).toBe(Math.round((400 + 300 + 0) / 3));
  });

  it('a reader who never clues skips the round', () => {
    const h = harness(D);
    h.wait(80_000);
    expect(h.s.round).toBe(1);
    expect(h.s.phase).toBe('clue');
  });
});
