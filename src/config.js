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

export const GAME_LENGTHS = [5, 9, 13];

// What a rep is worth, and to whom. A catch the receiver is stopped short
// with is 1; carrying it into the end zone is 3. An incompletion is 1 for the
// defender; an interception is 3.
export const SCORING = { catch: 1, touchdown: 3, stop: 1, interception: 3 };

// 'lock' is the cinematic camera: bolted to the player, always facing the end zone.
export const CAMERA_MODES = ['follow', 'broadcast', 'lock'];
export const LIGHTING_MODES = ['golden', 'night', 'midday'];
export const GRAPHICS_MODES = ['auto', 'low', 'medium', 'high'];

// Laying out for a ball that is coming down out of reach.
export const DIVE = {
  minGap: 1.25, // a jump covers anything closer than this
  range: 4.2, // farthest a dive can cover, yards
  height: 1.35, // a laid-out receiver meets the ball about this far off the turf
  maxTime: 0.74, // only once the ball is this close to coming down
  minAir: 0.34, // shortest and longest time spent laid out
  maxAir: 0.7,
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
  landSpeed: 0.85, // fraction of his top speed he can come down with
  turnRate: 12, // rad/s he can turn his body to the ball, on the way up too
  squareUp: 0.5, // a receiver on his feet turns to a ball this close to arriving, seconds
  defend: 1.2, // a defender goes up only if he expects to be within this of the ball, yards
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

// Hands: the fight at the line, hand-checking down the field, and riding a
// receiver who has got past. Contact costs speed; it never hands any out.
export const HANDS = {
  reach: 1.3, // yards between two men at which hands get on a body
  full: 0.95, // ...and at which they have all their leverage
  show: 2.0, // the arms start coming up this far out
  zone: 5, // yards past the line where the jam is at full strength
  check: 0.3, // fraction of it a defender can get away with farther downfield
  jam: 15, // yd/s^2 the jam takes off an evenly matched receiver
  drive: 2, // yd/s: how fast a receiver can drive into the hands, scaled by who is stronger
  punch: 2.2, // yd/s the first punch takes off him as the hands land
  jolt: 0.4, // ...and how hard it rocks his balance, as hit power
  push: 6, // yd/s^2 the receiver's push-off moves an evenly matched defender
  carry: 0.4, // fraction of his push that carries the receiver past
  work: 3, // yd/s: the most that hands alone can move a man who was going slower
  hold: 0.55, // how much of a man's footwork is taken away with hands on him
  slow: 0.3, // ...and how much of his top speed
  slip: 0.75, // fraction of the speed he brings into a man that an evenly matched receiver turns sideways, sliding past
  power: 1.4, // how sharply a strength edge tells
  ride: 0.8, // hands on a receiver who has got past: this much of a squared-up jam, anywhere on the field
  tether: 14, // yd/s^2 a riding defender can hang on with when the receiver pulls away
  juke: 0.3, // fraction of the grip that survives a sidestep
  shake: 3, // ...and how much faster a sidestep sheds the hands
  maxTime: 0.8, // how long evenly matched hands stay on before they are shed
  rest: 0.6, // seconds before a shed defender can get his hands back on
  beaten: 1.3, // the least leverage a receiver's push-off has on a defender whose jam he has shed
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


// A ball that comes in stride with the other man right on him: he plays it
// hard, laying out for it or going up to take it at its highest point.
export const CONTEST = {
  near: 1.7, // the other man is this close: it is a contested ball
  ahead: 0.35, // ...and it is coming down where he is running (cosine)
  attack: 1.7, // a high-point jump pushes off this much harder
  reach: [0.08, 0.24], // ...and his hands get this much farther, by rating
  layoutReach: 0.18, // a layout gets the hands this much farther out, at the top rating
  // Who is better placed for the ball.
  lead: 0.3, // yards farther along the ball's flight that put a man ahead of the other one
  edge: 0.25, // yards closer to where it comes down that give the other man the better chance at it
};

// After the catch the receiver is a ball carrier until he scores or is stopped.
export const RUN = {
  maxTime: 7, // seconds after the catch before the play is whistled dead
};

// Bringing a ball carrier down.
export const TACKLE = {
  reach: 1.1, // yards between them at which the tackler gets his arms on him
  base: 0.7, // an evenly matched tackler, squared up on his feet, wraps him up this often
  skill: 0.9, // how sharply tackling against elusiveness tells
  behind: 0.62, // fraction of that from behind or from the side: an arm tackle
  juke: 0.5, // fraction left when the runner is mid-sidestep
  hitAt: 6, // closing speed (yd/s) where a made tackle is a hit that knocks him down at once
  wrap: [0.35, 0.85], // seconds a wrapped runner keeps churning before he goes down
  drag: 9, // yd/s^2 a wrap takes off him while he churns
  breakFree: 0.22, // chance an evenly matched runner breaks a wrap
  rest: 0.55, // seconds after a miss before the same man can try again
  hold: 0.86, // yards the tackler holds on at (just clear of the two bodies touching)
  // Laying out at his legs.
  diveMin: 0.8,
  diveRange: 3.8,
  diveSpeed: 11, // a lunge at a man's legs is quicker than a dive for a ball, yd/s
  diveRadius: 0.5, // how close the hands have to get to his legs
  diveBase: 0.5, // a dive that gets there brings him down this often, before quality and ratings
};

// Getting both feet down in bounds.
export const TOE = {
  zone: 1.4, // yards from a boundary where a man coming down with his momentum carrying him out reaches for it
  minOut: 0.8, // ...and that momentum, yd/s
  reach: [0.12, 0.62], // how far behind him he can drag his toes, poor to great body control
  stride: 0.13, // seconds until the second foot comes down on an ordinary landing
  late: 0.035, // ...and on a toe drag: they come down almost together
  drag: 0.26, // seconds the toes are dragging the turf
  friction: 12, // yd/s^2 the drag takes off him
  spread: 0.13, // feet this far either side of his centre line
  plantZone: 0.6, // going up with his momentum taking him to within this of a line, or over it...
  plant: 4, // ...he keeps up to this much of that momentum on the turf, yd/s (by body control)
};
