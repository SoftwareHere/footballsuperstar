// World units are yards. x = across the field, y = up, z = along the field.
// The offense attacks toward -z, so "downfield" is always negative z and
// up-screen for the camera.

export const SIM_DT = 1 / 120;
export const GRAVITY = 10.72; // yd/s^2

export const FIELD = {
  halfWidth: 26.67, // sideline at x = +/- halfWidth
  losZ: 0, // line of scrimmage
  goalZ: -35, // goal line
  endZ: -45, // back of the end zone
  backZ: 18, // turf behind the line of scrimmage
  oobMargin: 2.5, // how far past a boundary an athlete can physically run
};

export const QB = {
  x: 0,
  z: 5, // shotgun depth at the snap
  dropZ: 7.5, // depth at the top of the drop
  dropTime: 1.0,
  releaseHeight: 2.1,
  windup: 0.36, // seconds from deciding to throw to the ball leaving the hand
  minRelease: 1.0, // the QB cannot release before finishing the drop
  deadline: 4.0, // the 4-second pressure: forced throw
};

export const WR_START_X = 11; // receiver lines up this far from the ball
export const CATCH_HEIGHT = 1.65; // where the QB aims the ball to arrive
export const BODY_RADIUS = 0.42; // athlete collision radius

export const REP = {
  resultLinger: 2.2, // seconds the result stays on screen before auto-advance
  minLinger: 0.7, // earliest the user can skip ahead
  autoSnapDefense: 3.4, // rival snaps on its own after this long
};

// Small helps for the human player, who cannot be as precise as the AI.
export const USER_ASSIST = {
  reach: 0.15, // extra catch / swat radius, yards
  closingBurst: 1.1, // defender top-speed multiplier while the ball is in the air
};

export const GAME_LENGTHS = [3, 5, 7];

// 'lock' is the cinematic camera: bolted to the player, always facing the end zone.
export const CAMERA_MODES = ['follow', 'broadcast', 'lock'];

// Laying out for a ball that is coming down out of reach.
export const DIVE = {
  minGap: 1.25, // a jump covers anything closer than this
  range: 3.5, // farthest a dive can cover, yards
  height: 1.35, // a laid-out receiver meets the ball about this far off the turf
  maxTime: 0.62, // only once the ball is this close to coming down
  minAir: 0.34, // shortest and longest time spent laid out
  maxAir: 0.62,
  minSpeed: 5.0,
  maxSpeed: 9.5,
  reach: 1.15, // how far ahead of the body the hands get
  radius: 0.6,
  downTime: 0.4, // seconds on the turf afterwards, before he starts to get up
  groundHold: 0.84, // chance a diving catch survives the ground, before hands
};

// Bodies meeting at the catch point.
export const CONTACT = {
  threat: 3.2, // a defender this close and still closing can hit the catch
  closing: -1.0, // ...unless he is already falling away from the play, yd/s
  window: 0.45, // seconds the receiver has to secure the ball
  minHit: 1.8, // closing speed where a bump becomes a hit
  downTime: 0.55, // seconds a man who was knocked over lies there before getting up
};

// Leaving the ground under his own power: he loads his legs, then goes up.
export const JUMP = {
  load: 0.12, // seconds between deciding to jump and the feet leaving the turf
  attack: 2.2, // most speed he can add toward the ball as he takes off, yd/s
  landing: 0.22, // seconds the legs take to soak up a clean landing
  turnRate: 12, // rad/s he can turn his body to the ball, on the way up too
  squareUp: 0.5, // a receiver on his feet turns to a ball this close to arriving, seconds
  defend: 1.4, // a defender goes up only if he expects to be within this of the ball, yards
};

// Staying on his feet. Balance runs from 1 (set) down to 0 (going over).
export const BALANCE = {
  absorb: 1.0, // hit power a man shrugs off, yd/s
  capacity: 4.4, // hit power beyond that which takes all of a set man's balance
  air: 0.55, // fraction of that with no feet under him
  brace: 0.45, // how much less the man delivering the hit feels it
  jostle: 0.4, // before the catch both men see the contact coming: only this much of it lands
  floor: 0.15, // ...and a man on his feet always keeps at least this much: he stumbles, he does not fall
  recover: 1.15, // seconds to get all of it back (quicker with agility)
  stumbleAt: 0.14, // losing more than this in one hit makes him stumble
  stumble: [0.25, 0.85], // seconds of stumbling after a small loss / a near-total one
};

// Hands: the fight at the line, and hand-checking down the field.
export const HANDS = {
  reach: 1.3, // yards between two men at which hands get on a body
  full: 0.95, // ...and at which they have all their leverage
  show: 2.0, // the arms start coming up this far out
  zone: 5, // yards past the line where the jam is at full strength
  check: 0.3, // fraction of it a defender can get away with farther downfield
  jam: 12, // yd/s^2 the jam takes off an evenly matched receiver
  push: 7, // yd/s^2 the receiver's push-off moves an evenly matched defender
  carry: 0.4, // fraction of his push that carries the receiver past
  hold: 0.55, // how much of a man's footwork is taken away with hands on him
  slip: 0.75, // fraction of his speed an evenly matched receiver keeps sliding past
  power: 1.4, // how sharply a strength edge tells
  maxTime: 0.6, // how long an even jam holds before the hands are shed
  rest: 0.5, // seconds before a shed defender can get his hands back on
};

// Balls that come off hands and stay alive.
export const TIP = {
  max: 2, // after this many tips the next miss is dead
  base: 0.14, // receiver: chance a failed catch pops up instead of dying
  quality: 0.4, // ...plus this much when it hit him square in the hands
  swat: 0.24, // defender: chance a breakup goes up instead of down
  keep: 0.25, // fraction of the ball's speed it keeps
  scatter: 2.0,
  pop: [2.6, 4.4], // upward speed off the hands, yd/s
};

export const FALL = {
  friction: 11, // yd/s^2 sliding on the turf
  getUp: 1.2, // seconds to pick himself up: hands, knees, feet
  settle: 1.2, // he does not start getting up while still sliding faster than this, yd/s
};

