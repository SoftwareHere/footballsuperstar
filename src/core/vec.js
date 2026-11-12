export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const len2 = (x, z) => Math.hypot(x, z);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Shortest signed difference between two angles (radians). */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Distance from point p to the vertical segment at (x, z) spanning y in [bottom, top]. */
export function distToVerticalSegment(p, x, z, bottom, top) {
  const dy = p.y < bottom ? bottom - p.y : p.y > top ? p.y - top : 0;
  return Math.hypot(p.x - x, p.z - z, dy);
}

/** Distance from point p to the 3D segment a-b (all { x, y, z }). */
export function distToSegment3(p, ax, ay, az, bx, by, bz) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const len = ux * ux + uy * uy + uz * uz;
  let t = len > 1e-9 ? ((p.x - ax) * ux + (p.y - ay) * uy + (p.z - az) * uz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (ax + ux * t), p.y - (ay + uy * t), p.z - (az + uz * t));
}
