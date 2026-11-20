import { describe, expect, it } from 'vitest';
import { pidKey } from '../src/core/protocol';
import { AWAY_MS, MAX_PLAYERS, applyResult, ensureVip, join, kick, leave, newRoom, seatAudience, seated, standings, sweep } from '../src/core/room';

const fresh = () => newRoom('ABCD', 'phish');

describe('room', () => {
  it('first player is VIP; VIP passes on when they are kicked', () => {
    const r = fresh();
    join(r, 'p1', 'Ann', 1, pidKey);
    join(r, 'p2', 'Bob', 2, pidKey);
    expect(r.pub.players.map((p) => p.vip)).toEqual([true, false]);
    kick(r, pidKey('p1'));
    expect(r.pub.players[0].name).toBe('Bob');
    expect(r.pub.players[0].vip).toBe(true);
  });

  it('a refreshed phone gets the same seat back', () => {
    const r = fresh();
    const a = join(r, 'p1', 'Ann', 1, pidKey);
    const b = join(r, 'p1', 'Ann', 2, pidKey);
    expect(b).toEqual({ ok: true, key: (a as any).key, rejoined: true });
    expect(r.pub.players).toHaveLength(1);
  });

  it('the same name takes over a quiet seat but not a live one', () => {
    const r = fresh();
    join(r, 'p1', 'Ann', 0, pidKey);
    r.pub.players[0].score = 700;
    expect(join(r, 'p2', 'ann', 1000, pidKey).ok).toBe(false);
    const res = join(r, 'p2', 'ANN', AWAY_MS + 1, pidKey);
    expect(res.ok && res.rejoined).toBe(true);
    expect(r.pub.players).toHaveLength(1);
    expect(r.pids.p2).toBe(pidKey('p1'));
    expect(r.pids.p1).toBeUndefined();
  });

  it('late joiners and the ninth player are audience; they get seats back at the menu', () => {
    const r = fresh();
    for (let i = 0; i < MAX_PLAYERS + 1; i++) join(r, `p${i}`, `P${i}`, i, pidKey);
    expect(seated(r)).toHaveLength(MAX_PLAYERS);
    expect(r.pub.players[MAX_PLAYERS].role).toBe('audience');
    r.pub.phase = 'game';
    join(r, 'late', 'Late', 100, pidKey);
    expect(r.pub.players.at(-1)!.role).toBe('audience');
    kick(r, pidKey('p0'));
    kick(r, pidKey('p1'));
    r.pub.phase = 'lobby';
    seatAudience(r);
    expect(seated(r)).toHaveLength(MAX_PLAYERS);
    expect(new Set(seated(r).map((p) => p.look)).size).toBe(MAX_PLAYERS);
  });

  it('kicked devices and names stay out', () => {
    const r = fresh();
    join(r, 'p1', 'Ann', 0, pidKey);
    kick(r, pidKey('p1'));
    expect(join(r, 'p1', 'Someone', 1, pidKey).ok).toBe(false);
    expect(join(r, 'p9', 'Ann', AWAY_MS * 2, pidKey).ok).toBe(true); // a new Ann on a new phone is fine
  });

  it('filters names when the filter is on', () => {
    const r = fresh();
    expect(join(r, 'p1', 'shit', 0, pidKey).ok).toBe(false);
    expect(join(r, 'p2', '   ', 0, pidKey).ok).toBe(false);
    join(r, 'p1', 'Big shit', 0, pidKey);
    expect(r.pub.players[0].name).toBe('Big ****');
    r.pub.settings.filter = false;
    join(r, 'p3', 'shit2', 0, pidKey);
    expect(r.pub.players[1].name).toBe('shit2');
  });

  it('leave only works in the lobby; sweep marks quiet phones away', () => {
    const r = fresh();
    join(r, 'p1', 'Ann', 0, pidKey);
    expect(sweep(r, AWAY_MS + 1)).toBe(true);
    expect(r.pub.players[0].connected).toBe(false);
    r.pub.phase = 'game';
    leave(r, 'p1');
    expect(r.pub.players).toHaveLength(1);
    r.pub.phase = 'lobby';
    leave(r, 'p1');
    expect(r.pub.players).toHaveLength(0);
  });

  it('applies results to running scores and ranks ties together', () => {
    const r = fresh();
    join(r, 'p1', 'Ann', 0, pidKey);
    join(r, 'p2', 'Bob', 1, pidKey);
    join(r, 'p3', 'Cat', 2, pidKey);
    applyResult(r, { gameId: 'phish', title: 'Phish', points: { [pidKey('p1')]: 500, [pidKey('p2')]: 500, [pidKey('p3')]: 100 } });
    const s = standings(r.pub.players);
    expect(s.map((x) => x.place)).toEqual([1, 1, 3]);
    expect(r.pub.played).toEqual(['phish']);
    ensureVip(r);
  });
});
