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
