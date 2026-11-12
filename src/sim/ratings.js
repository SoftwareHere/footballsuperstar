import { clamp } from '../core/vec.js';

export const STAT_KEYS = [
  'speed',
  'acceleration',
  'agility',
  'hands',
  'jumping',
  'strength',
  'stamina',
];

export const STAT_INFO = {
  speed: { label: 'Speed', blurb: 'Top speed. Run past him, or keep up with him.' },
  acceleration: { label: 'Acceleration', blurb: 'How fast you reach top speed off the line and out of breaks.' },
  agility: { label: 'Agility', blurb: 'Sharper cuts and jukes on offense, tighter mirroring on defense.' },
  hands: { label: 'Hands', blurb: 'Secure catches in traffic. On defense: more breakups and picks.' },
  jumping: { label: 'Jumping', blurb: 'Higher reach on jump balls, both ways.' },
  strength: { label: 'Strength', blurb: 'Win the contact: beat the jam, deliver the jam, win 50/50 balls.' },
  stamina: { label: 'Stamina', blurb: 'A bigger sprint tank that refills faster between reps.' },
};

export const STAT_MIN = 1;
export const STAT_MAX = 99;

/** 0 at a rating of 40, 1 at 99. Lower ratings dip slightly below zero. */
export function norm(rating) {
  return clamp((rating - 40) / 59, -0.25, 1);
}

/** Turn 1-99 ratings into the physical numbers the simulation uses. */
export function deriveParams(ratings) {
  const s = norm(ratings.speed);
  const a = norm(ratings.acceleration);
  const g = norm(ratings.agility);
  const h = norm(ratings.hands);
  const j = norm(ratings.jumping);
  const st = norm(ratings.strength);
  const sm = norm(ratings.stamina);
  return {
    topSpeed: 7.0 + 3.2 * s, // yd/s at a full sprint
    jogFactor: 0.75, // fraction of top speed without sprinting
    accel: 7.5 + 7.0 * a, // yd/s^2 when building speed
    cutRate: 13 + 15 * g, // yd/s^2 when braking or changing direction
    jukeSpeed: 5.0 + 3.5 * g, // sideways burst of a juke
    jukeCooldown: 1.1 - 0.4 * g,
    reaction: 0.33 - 0.2 * g, // AI only: delay before reacting to a move
    hipTurn: 0.3 - 0.18 * g, // AI only: time lost flipping the hips
    catchBase: 0.9 + 0.09 * h, // chance to secure a clean, open catch
    pressureResist: 0.35 * h, // how much of the coverage pressure is shrugged off
    reachBonus: 0.25 * h, // extra catch radius, yards
    intChance: 0.08 + 0.3 * h, // defender: chance a breakup becomes a pick
    jumpHeight: 0.45 + 0.65 * j, // yards
    strength: 0.6 + 0.9 * st, // contact weight
    sprintSeconds: 4.0 + 5.0 * sm, // length of a full sprint tank
    staminaRegen: 0.1 + 0.1 * sm, // tank fraction per second while not sprinting
    betweenReps: 0.5 + 0.35 * sm, // tank fraction recovered between reps
    hands: ratings.hands,
    jumping: ratings.jumping,
    strengthRating: ratings.strength,
  };
}

const OVR_WEIGHTS = {
  speed: 1.3,
  acceleration: 1.0,
  agility: 1.2,
  hands: 1.2,
  jumping: 0.8,
  strength: 0.8,
  stamina: 0.7,
};

export function overall(ratings) {
  let sum = 0;
  let w = 0;
  for (const key of STAT_KEYS) {
    sum += ratings[key] * OVR_WEIGHTS[key];
    w += OVR_WEIGHTS[key];
  }
  return Math.round(sum / w);
}

/**
 * A combine-style 40-yard-dash time for the upgrade screen. Display only:
 * it maps speed and acceleration onto the range fans expect (about 4.3-5.1s).
 */
export function fortyTime(ratings) {
  return 5.05 - 0.55 * norm(ratings.speed) - 0.22 * norm(ratings.acceleration);
}

export function uniformRatings(value) {
  const out = {};
  for (const key of STAT_KEYS) out[key] = value;
  return out;
}
