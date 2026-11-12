import { STAT_KEYS, STAT_MAX, uniformRatings } from '../sim/ratings.js';
import { RIVALS } from './opponents.js';

export const SAVE_VERSION = 1;
export const POINTS_PER_LEVEL = 4;
export const MAX_LEVEL = 60;
export const START_RATING = 60;
export const START_POINTS = 5;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level) {
  return 100 + 40 * (level - 1);
}

export function newCareer() {
  return {
    version: SAVE_VERSION,
    level: 1,
    xp: 0,
    points: START_POINTS,
    stats: uniformRatings(START_RATING),
    unlocked: 1, // highest rival tier available
    wins: 0,
    losses: 0,
    beaten: {}, // rival id -> number of wins
    seenHowTo: false,
    settings: { target: 5, camera: 'follow', muted: false, tier: 1 },
  };
}

export const tierMultiplier = (tier) => 1 + 0.5 * (tier - 1);

/** XP earned for a finished game. Longer games and tougher rivals pay more. */
export function matchXp({ won, userPoints, target, tier }) {
  const mult = tierMultiplier(tier);
  const lines = [];
  const points = Math.round(userPoints * 30 * mult);
  lines.push({ label: `${userPoints} point${userPoints === 1 ? '' : 's'} scored`, xp: points });
  if (won) {
    lines.push({ label: `Win (first to ${target})`, xp: Math.round(100 * mult * (target / 5)) });
  } else {
    lines.push({ label: 'Finished the game', xp: Math.round(25 * mult) });
  }
  const total = lines.reduce((s, l) => s + l.xp, 0);
  return { lines, total, mult };
}

/** Add XP, rolling over into level-ups. Returns how many levels were gained. */
export function addXp(career, amount) {
  let levels = 0;
  career.xp += amount;
  while (career.level < MAX_LEVEL && career.xp >= xpToNext(career.level)) {
    career.xp -= xpToNext(career.level);
    career.level += 1;
    career.points += POINTS_PER_LEVEL;
    levels += 1;
  }
  if (career.level >= MAX_LEVEL) career.xp = Math.min(career.xp, xpToNext(career.level));
  return levels;
}

export function canUpgrade(career, stat) {
  return STAT_KEYS.includes(stat) && career.points > 0 && career.stats[stat] < STAT_MAX;
}

/** Spend one skill point on a stat. Returns true if it was spent. */
export function spendPoint(career, stat) {
  if (!canUpgrade(career, stat)) return false;
  career.stats[stat] += 1;
  career.points -= 1;
  return true;
}

/** Apply a finished game to the career: record, XP, level-ups, unlocks. */
export function recordMatch(career, { won, userPoints, target, tier }) {
  const rival = RIVALS[tier - 1];
  const xp = matchXp({ won, userPoints, target, tier });
  const before = { level: career.level, xp: career.xp };
  let unlockedTier = null;
  if (won) {
    career.wins += 1;
    career.beaten[rival.id] = (career.beaten[rival.id] || 0) + 1;
    if (tier === career.unlocked && tier < RIVALS.length) {
      career.unlocked = tier + 1;
      unlockedTier = tier + 1;
    }
  } else {
    career.losses += 1;
  }
  const levels = addXp(career, xp.total);
  return { xp, before, levels, pointsGained: levels * POINTS_PER_LEVEL, unlockedTier };
}
