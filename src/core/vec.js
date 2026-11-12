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
