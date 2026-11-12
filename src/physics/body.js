// Body dimensions in yards (a 6'1" athlete), shared by the visible skeleton
// and the ragdoll so that the two always describe the same body.
//
// Model space: +y up, +z the way he faces, +x toward his LEFT.
export const BODY = {
  hipHeight: 1.03, // hip joints above the turf when standing
  ankle: 0.05, // ankle joint above the sole
  thigh: 0.5,
  shin: 0.48,
  hipWidth: 0.105, // half the distance between the hip joints
  chestAt: 0.3, // pelvis up to the joint between belly and ribcage
  spine: 0.6, // pelvis up to the shoulder line
  neck: 0.2, // shoulder line up to the centre of the head
  shoulderWidth: 0.25, // half the distance between the shoulder joints
  shoulderDrop: 0.03, // shoulder joints sit this far below the shoulder line
  upperArm: 0.33,
  forearm: 0.31,
  hand: 0.09,
  headRadius: 0.165,
  chestDepth: 0.16,
};

export const LEG_LENGTH = BODY.thigh + BODY.shin;
export const ARM_LENGTH = BODY.upperArm + BODY.forearm;

// Ragdoll particles. L is +x, R is -x.
export const P = {
  HEAD: 0,
  NECK: 1,
  CHEST: 2, // front of the ribcage: gives the torso depth so it cannot fold flat
  PELVIS: 3,
  SH_L: 4,
  SH_R: 5,
  EL_L: 6,
  EL_R: 7,
  HA_L: 8,
  HA_R: 9,
  HIP_L: 10,
  HIP_R: 11,
  KN_L: 12,
  KN_R: 13,
  FT_L: 14,
  FT_R: 15,
};
export const PARTICLE_COUNT = 16;

/** Where each particle sits, relative to the pelvis, standing with arms hanging. */
export function restPoints() {
  const B = BODY;
  const shY = B.spine - B.shoulderDrop;
  const pts = new Array(PARTICLE_COUNT);
  pts[P.PELVIS] = [0, 0, 0];
  pts[P.NECK] = [0, B.spine, 0];
  pts[P.HEAD] = [0, B.spine + B.neck, 0];
  pts[P.CHEST] = [0, B.spine * 0.62, B.chestDepth];
  for (const [s, SH, EL, HA, HIP, KN, FT] of [
    [1, P.SH_L, P.EL_L, P.HA_L, P.HIP_L, P.KN_L, P.FT_L],
    [-1, P.SH_R, P.EL_R, P.HA_R, P.HIP_R, P.KN_R, P.FT_R],
  ]) {
    pts[SH] = [s * B.shoulderWidth, shY, 0];
    pts[EL] = [s * B.shoulderWidth, shY - B.upperArm, 0];
    pts[HA] = [s * B.shoulderWidth, shY - B.upperArm - B.forearm, 0];
    pts[HIP] = [s * B.hipWidth, 0, 0];
    pts[KN] = [s * B.hipWidth, -B.thigh, 0];
    pts[FT] = [s * B.hipWidth, -B.thigh - B.shin, 0];
  }
  return pts;
}
