import { describe, it, expect } from 'vitest';
import { loadCareer, saveCareer, resetCareer, sanitize, SAVE_KEY } from '../src/progression/save.js';
import { newCareer, addXp, spendPoint } from '../src/progression/progression.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

describe('save', () => {
  it('round-trips a career', () => {
    const storage = fakeStorage();
    const c = newCareer();
    addXp(c, 500);
    spendPoint(c, 'hands');
    c.unlocked = 3;
    c.settings.target = 7;
    c.settings.camera = 'broadcast';
    expect(saveCareer(c, storage)).toBe(true);
    expect(loadCareer(storage)).toEqual(sanitize(c));
    expect(loadCareer(storage).stats.hands).toBe(61);
  });

  it('starts a new career when nothing is saved or the save is corrupt', () => {
    const storage = fakeStorage();
    expect(loadCareer(storage)).toEqual(newCareer());
    storage.setItem(SAVE_KEY, '{not json');
    expect(loadCareer(storage)).toEqual(newCareer());
    expect(loadCareer(null)).toEqual(newCareer());
  });

  it('repairs out-of-range or missing values instead of trusting them', () => {
    const c = sanitize({ level: 9999, xp: -5, points: 'lots', stats: { speed: 500, hands: -3 }, unlocked: 42, settings: { target: 4, camera: 'drone' } });
    expect(c.level).toBe(60);
    expect(c.xp).toBe(0);
    expect(c.points).toBe(0);
    expect(c.stats.speed).toBe(99);
    expect(c.stats.hands).toBe(1);
    expect(c.stats.agility).toBe(60);
    expect(c.unlocked).toBe(8);
    expect(c.settings.target).toBe(5);
    expect(c.settings.camera).toBe('follow');
  });

  it('remembers the cinematic camera', () => {
    const storage = fakeStorage();
    const c = newCareer();
    c.settings.camera = 'lock';
    saveCareer(c, storage);
    expect(loadCareer(storage).settings.camera).toBe('lock');
  });

  it('reset clears the save', () => {
    const storage = fakeStorage();
    const c = newCareer();
    addXp(c, 5000);
    saveCareer(c, storage);
    expect(resetCareer(storage)).toEqual(newCareer());
    expect(storage.getItem(SAVE_KEY)).toBe(null);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('full');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    expect(loadCareer(broken)).toEqual(newCareer());
    expect(saveCareer(newCareer(), broken)).toBe(false);
    expect(resetCareer(broken)).toEqual(newCareer());
  });
});
