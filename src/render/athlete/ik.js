import * as THREE from 'three';

export const DOWN = new THREE.Vector3(0, -1, 0);
export const UP = new THREE.Vector3(0, 1, 0);

const inv = new THREE.Quaternion();
const local = new THREE.Vector3();
const d = new THREE.Vector3();
const perp = new THREE.Vector3();
const mid = new THREE.Vector3();
const end = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * Point a bone along a world direction. The bone lies along `rest` in its
 * parent's space when its own rotation is zero. Sets `joint.quaternion` and
 * writes the bone's resulting world rotation to `outWorld`.
 */
export function aimBone(joint, parentWorld, worldDir, outWorld, rest = DOWN) {
  inv.copy(parentWorld).invert();
  local.copy(worldDir).applyQuaternion(inv).normalize();
  joint.quaternion.setFromUnitVectors(rest, local);
  outWorld.copy(parentWorld).multiply(joint.quaternion);
}

/**
 * Two-bone IK (hip-knee-foot or shoulder-elbow-hand).
 *   root    world position of the first joint
 *   target  world position the end should reach (clamped to what the limb can reach)
 *   pole    world direction the middle joint bends toward
 * Writes world rotations of both bones and, if asked, where the end got to.
 */
export function solveTwoBone(upper, lower, parentWorld, root, target, pole, l1, l2, outUpper, outLower, outEnd = null) {
  d.subVectors(target, root);
  let dist = d.length();
  if (dist < 1e-6) {
    d.set(0, -1, 0);
    dist = 0;
  } else {
    d.divideScalar(dist);
  }
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.03), (l1 + l2) * 0.998);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // The part of the pole that is square to the limb's line.
  perp.copy(pole).addScaledVector(d, -pole.dot(d));
  if (perp.lengthSq() < 1e-8) {
    perp.set(d.y, -d.x, 0);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  }
  perp.normalize();
  mid.copy(root).addScaledVector(d, l1 * cosA).addScaledVector(perp, l1 * sinA);
  end.copy(root).addScaledVector(d, dist);
  dir.subVectors(mid, root).normalize();
  aimBone(upper, parentWorld, dir, outUpper);
  dir.subVectors(end, mid).normalize();
  aimBone(lower, outUpper, dir, outLower);
  if (outEnd) outEnd.copy(end);
}
