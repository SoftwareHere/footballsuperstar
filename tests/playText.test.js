import { describe, it, expect } from 'vitest';
import { describePlay, spot } from '../src/ui/playText.js';

const entry = (over) => ({ userRole: 'wr', scorer: 'user', points: 1, complete: true, reason: 'catch', catchType: 'body', ...over });

describe('the result banner tells the play', () => {
  it('names yard lines the way the field is painted', () => {
    expect(spot(17.4)).toBe('the 17');
    expect(spot(0.3)).toBe('the 1');
    expect(spot(-2)).toBe('the end zone');
  });

  it('a touchdown: where it was caught, how it got in, and 3 points', () => {
    const run = describePlay(entry({ points: 3, reason: 'touchdown', touchdown: true, endedBy: 'endzone', catchYard: 18, endYard: 0, yac: 18, brokenTackles: 1 }), { rival: 'Tuttle' });
    expect(run.title).toBe('TOUCHDOWN!');
    expect(run.detail).toBe('Caught at the 18, took it 18 yards to the end zone, broke a tackle · +3 YOU');
    expect(run.good).toBe(true);
    const inZone = describePlay(entry({ points: 3, touchdown: true, endedBy: 'endzone', catchYard: -4, toeTap: true }));
    expect(inZone.detail).toBe('Toe-tap in the end zone · +3 YOU');
    const dove = describePlay(entry({ points: 3, touchdown: true, endedBy: 'endzone', catchYard: 4, yac: 4, stretched: true }));
    expect(dove.detail).toMatch(/^Caught at the 4, dove across the goal line/);
  });

  it('a catch stopped short: how the run ended, and 1 point', () => {
    const wrap = describePlay(entry({ catchType: 'oneHand', endedBy: 'wrap', catchYard: 22, endYard: 17, yac: 5 }));
    expect(wrap.title).toBe('ONE-HANDED!');
    expect(wrap.detail).toBe('One-handed catch at the 22, brought down at the 17 (5 yards after the catch) · +1 YOU');
    expect(describePlay(entry({ endedBy: 'dive', catchYard: 19, endYard: 16, yac: 3 })).detail).toMatch(/tripped up by a diving tackle at the 16/);
    expect(describePlay(entry({ endedBy: 'pushed', catchYard: 19, endYard: 12, yac: 7 })).detail).toMatch(/pushed out at the 12/);
    expect(describePlay(entry({ toeTap: true, endedBy: 'oob', catchYard: 21, endYard: 21, yac: 0 })).detail).toBe('Toe-tap at the 21, and went out of bounds · +1 YOU');
    expect(describePlay(entry({ catchType: 'dive', endedBy: 'down', catchYard: 14, endYard: 14, yac: 0 })).detail).toBe('Diving catch at the 14, down where he landed · +1 YOU');
  });

  it('on defense the headline is how you stopped him, and the points are his', () => {
    const d = (over) => describePlay(entry({ userRole: 'db', scorer: 'rival', ...over }), { rival: 'Tuttle' });
    expect(d({ endedBy: 'wrap', catchYard: 20, endYard: 18, yac: 2 }).title).toBe('TACKLED!');
    expect(d({ endedBy: 'dive', catchYard: 20, endYard: 18, yac: 2 }).title).toBe('DIVING TACKLE!');
    expect(d({ endedBy: 'hit', catchYard: 20, endYard: 17, yac: 3 }).title).toBe('BIG HIT!');
    const td = d({ points: 3, touchdown: true, endedBy: 'endzone', catchYard: 10, yac: 10 });
    expect(td.detail).toMatch(/\+3 TUTTLE$/);
    expect(td.good).toBe(false);
  });

  it('incompletions and picks say why, and what they were worth', () => {
    const d = (over) => describePlay({ userRole: 'db', scorer: 'user', complete: false, points: 1, ...over }, { rival: 'Tuttle' });
    expect(d({ reason: 'int', points: 3, pickYard: 12 })).toEqual({ title: 'INTERCEPTED!', detail: 'Picked off at the 12 · +3 YOU', good: true });
    expect(d({ reason: 'oob', feetOut: 1 }).detail).toBe('One foot came down out. No catch · +1 YOU');
    expect(d({ reason: 'oob', feetOut: 2 }).detail).toBe('Came down out of bounds. No catch · +1 YOU');
    expect(d({ reason: 'oob', bodyOut: true }).detail).toBe('Landed out of bounds. No catch · +1 YOU');
    expect(d({ reason: 'oob', pickOob: true }).title).toBe('OUT OF BOUNDS');
    expect(d({ reason: 'oob', pickOob: true }).detail).toBe('Picked off, but he came down out of bounds · +1 YOU');
    expect(d({ reason: 'swat' }).title).toBe('PASS BROKEN UP!');
    expect(d({ reason: 'hit' }).title).toBe('JARRED LOOSE!');
  });
});
