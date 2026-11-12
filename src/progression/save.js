import { STAT_KEYS, STAT_MAX, STAT_MIN } from '../sim/ratings.js';
import { clamp } from '../core/vec.js';
import { RIVALS } from './opponents.js';
import { newCareer, SAVE_VERSION, MAX_LEVEL } from './progression.js';
import { GAME_LENGTHS, CAMERA_MODES } from '../config.js';

export const SAVE_KEY = 'footballsuperstar.save.v1';

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Fill in anything missing or out of range so old or damaged saves still load. */
export function sanitize(raw) {
  const fresh = newCareer();
  if (!raw || typeof raw !== 'object') return fresh;
  const int = (v, lo, hi, fallback) => (Number.isFinite(v) ? clamp(Math.floor(v), lo, hi) : fallback);
  const career = {
    version: SAVE_VERSION,
    level: int(raw.level, 1, MAX_LEVEL, 1),
    xp: int(raw.xp, 0, 1e9, 0),
    points: int(raw.points, 0, 9999, 0),
    stats: {},
    unlocked: int(raw.unlocked, 1, RIVALS.length, 1),
    wins: int(raw.wins, 0, 1e9, 0),
    losses: int(raw.losses, 0, 1e9, 0),
    beaten: {},
    seenHowTo: Boolean(raw.seenHowTo),
    settings: { ...fresh.settings },
  };
  for (const key of STAT_KEYS) {
    career.stats[key] = int(raw.stats?.[key], STAT_MIN, STAT_MAX, fresh.stats[key]);
  }
  for (const rival of RIVALS) {
    const n = raw.beaten?.[rival.id];
    if (Number.isFinite(n) && n > 0) career.beaten[rival.id] = Math.floor(n);
  }
  const s = raw.settings || {};
  if (GAME_LENGTHS.includes(s.target)) career.settings.target = s.target;
  if (CAMERA_MODES.includes(s.camera)) career.settings.camera = s.camera;
  career.settings.muted = Boolean(s.muted);
  career.settings.tier = int(s.tier, 1, career.unlocked, 1);
  return career;
}

export function loadCareer(storage = defaultStorage()) {
  if (!storage) return newCareer();
  try {
    const text = storage.getItem(SAVE_KEY);
    return text ? sanitize(JSON.parse(text)) : newCareer();
  } catch {
    return newCareer();
  }
}

export function saveCareer(career, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(career));
    return true;
  } catch {
    return false;
  }
}

export function resetCareer(storage = defaultStorage()) {
  try {
    storage?.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
  return newCareer();
}
