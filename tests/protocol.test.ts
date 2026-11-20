import { describe, expect, it } from 'vitest';
import { ROOM_LETTERS, isRoomCode, makeRoomCode, normalizeRoomCode, wire } from '../src/core/protocol';
import { mulberry32 } from '../src/core/rng';
import { censor } from '../src/core/profanity';

describe('room codes', () => {
  it('never use ambiguous letters', () => {
    for (const c of 'ILOU') expect(ROOM_LETTERS).not.toContain(c);
    const rand = mulberry32(1);
    for (let i = 0; i < 2000; i++) expect(isRoomCode(makeRoomCode(rand))).toBe(true);
  });
  it('normalises typed codes', () => {
    expect(normalizeRoomCode(' ab-cd9e')).toBe('ABCD');
  });
  it('wraps messages in the typed envelope', () => {
    const m = wire('join', 'pid', { name: 'x' });
    expect(m).toMatchObject({ v: 1, type: 'join', from: 'pid', payload: { name: 'x' } });
    expect(typeof m.ts).toBe('number');
  });
});

describe('profanity filter', () => {
  it('stars whole bad words, including leetspeak and stretched letters', () => {
    expect(censor('what the fuck')).toBe('what the ****');
    expect(censor('sh1t happens')).toBe('**** happens');
    expect(censor('fuuuuck')).toBe('*******');
  });
  it('leaves innocent words alone', () => {
    for (const w of ['class', 'Scunthorpe', 'assess', 'cocktail', 'grapes', 'passport']) expect(censor(w)).toBe(w);
  });
});
