import { BODY, P, PARTICLE_COUNT } from './body.js';

const B = BODY;
const N = PARTICLE_COUNT;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
/** 0 before `from`, 1 after `to`, eased in between. */
const ramp = (u, from, to) => smooth(clamp((u - from) / (to - from), 0, 1));
const mix3 = (a, b, t, out) => {
  out[0] = mix(a[0], b[0], t);
  out[1] = mix(a[1], b[1], t);
  out[2] = mix(a[2], b[2], t);
  return out;
};

// Where the parts that carry weight rest on the turf (particle centres).
const HAND_Y = 0.06;
const FOOT_Y = 0.065;
const SOLE_Y = 0.05; // foot flat
const STANCE = B.hipWidth * 1.25; // feet this far either side of where he stands

/**
 * How far along his body, from hips toward head, the spot he will stand on
 * is while he lies there. Face down he pushes up and brings a foot under his
 * chest; on his back he sits up and gets his feet under him, so the spot is
 * down by his knees. The rag doll is slid so that this point sits where the
 * game says he is, which is what lets him stand up exactly there.
 */
export const STAND_ALONG = { prone: 0.3, supine: -0.47 };

/** Which way up counts as lying on his back. */
export const SUPINE_UP = 0.2;

/** `along` for however he is lying now (see STAND_ALONG): eased between the two. */
export function standAlong(up) {
  return mix(STAND_ALONG.prone, STAND_ALONG.supine, smooth(clamp((up + 0.1) / 0.5, 0, 1)));
}

/**
 * Two-bone reach: from `root` to `target` with bones l1, l2, the middle joint
 * bending toward `pole`. Writes the middle joint and where the end got to
 * (the target, pulled in or pushed out to what the limb can do).
 */
function reach(root, target, l1, l2, pole, mid, end, minDist) {
  let dx = target[0] - root[0];
  let dy = target[1] - root[1];
  let dz = target[2] - root[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1e-6;
  }
  dx /= d;
  dy /= d;
  dz /= d;
  d = clamp(d, minDist, (l1 + l2) * 0.985);
  const along = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // The part of the pole square to the limb's line.
  const dot = pole[0] * dx + pole[1] * dy + pole[2] * dz;
  let px = pole[0] - dx * dot;
  let py = pole[1] - dy * dot;
  let pz = pole[2] - dz * dot;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    px = dy;
    py = -dx;
    pz = 0;
    pl = Math.hypot(px, py, pz) || 1;
  }
  mid[0] = root[0] + dx * along + (px / pl) * off;
  mid[1] = root[1] + dy * along + (py / pl) * off;
  mid[2] = root[2] + dz * along + (pz / pl) * off;
  end[0] = root[0] + dx * d;
  end[1] = root[1] + dy * d;
  end[2] = root[2] + dz * d;
}

const MIN_LEG = Math.sqrt(B.thigh ** 2 + B.shin ** 2 - 2 * B.thigh * B.shin * Math.cos((50 * Math.PI) / 180));
const MIN_ARM = Math.sqrt(B.upperArm ** 2 + B.forearm ** 2 - 2 * B.upperArm * B.forearm * Math.cos((42 * Math.PI) / 180));

// Which way joints bend, in his own frame [left, up, forward].
const KNEE_DOWN = [0, -1, 0.25]; // kneeling: the knee is on the turf
const KNEE_FWD = [0, 0.25, 1]; // standing, squatting, stepping
const KNEE_UP = [0, 1, 0.35]; // on his back with his feet drawn in
const ELBOW_PUSH = [0.55, 1, -0.5]; // pushing up off the turf: elbows up and out
const ELBOW_PROP = [0.3, 0.5, -1]; // propped on his hands behind him
const ELBOW_HANG = [0.35, -0.2, -1]; // arms free

/**
 * Getting up off the turf.
 *
 * A man does not rise like a marionette: he gets his hands under him and
 * pushes, gets a knee under him, gets a foot under him, and stands up over
 * it. This works out that sequence for a rag doll that has come to rest (or
 * nearly) in any position, as a set of goals for its particles; the rag doll
 * is then moved toward them by its own "muscles" (Ragdoll.moveTo), softly at
 * first so that he gathers himself from however he fell, then firmly.
 *
 *   face down   hands by his chest -> push up and back onto his knees ->
 *               trunk up -> one foot steps through and plants -> up over it
 *   on his back feet drawn in, hands behind him -> sit up -> rock forward
 *               over his feet -> up
 *
 * Everything that bears weight (hands, knees, feet) is on the turf and stays
 * where it was put until it is lifted, so nothing floats and nothing slides.
 *
 * Plain numbers and arrays: no three.js in here, so it runs in Node.
 */
export class GetUp {
  constructor() {
    this.active = false;
    this.goal = new Float64Array(N * 3);
    this.path = 'prone'; // 'prone' | 'supine'
    this.heading = 0; // the way he faces as he gets up, radians (0 = +z)
    this.spot = { x: 0, z: 0 }; // where he ends up standing
    this.drive = 0;
    this.lead = 0; // which leg steps through first: 0 left, 1 right
    // Frame: origin on the turf, h = the way he faces, l = his left.
    this.ox = 0;
    this.oz = 0;
    this.hx = 0;
    this.hz = 1;
    this.lat0 = 0; // where his hips are when he starts, in that frame
    this.fwd0 = 0;
    this.pitch0 = 0;
    this.pts = Array.from({ length: N }, () => [0, 0, 0]);
    this.spec = {
      pelvis: [0, 0, 0],
      pitch: 0,
      feet: [[0, 0, 0], [0, 0, 0]],
      knees: [[0, 0, 1], [0, 0, 1]],
      hands: [[0, 0, 0], [0, 0, 0]],
      elbows: [[0, 0, -1], [0, 0, -1]],
    };
  }

  /**
   * Start from where the rag doll is now. (x, z) is where the game says he
   * is: he gets up there, or as near to it as his body is lying.
   */
  begin(rag, x, z) {
    const lie = rag.lie();
    const supine = lie.up > SUPINE_UP;
    this.path = supine ? 'supine' : 'prone';
    let ax = lie.ax;
    let az = lie.az;
    if (lie.flat < 0.2) {
      // Propped upright somehow: face the way his chest faces.
      const sl = rag.get(P.SH_L, {});
      const sr = rag.get(P.SH_R, {});
      ax = -(sl.z - sr.z);
      az = sl.x - sr.x;
      const n = Math.hypot(ax, az) || 1;
      ax /= n;
      az /= n;
      if (supine) {
        ax = -ax;
        az = -az;
      }
    }
    // Face down he gets up facing the way his head points; on his back, the way his feet do.
    this.hx = supine ? -ax : ax;
    this.hz = supine ? -az : az;
    this.heading = Math.atan2(this.hx, this.hz);
    this.ox = x;
    this.oz = z;
    const pelvis = rag.get(P.PELVIS, {});
    const neck = rag.get(P.NECK, {});
    const local = this.toLocal(pelvis.x, pelvis.y, pelvis.z, []);
    this.lat0 = local[0];
    this.fwd0 = local[2];
    const n = this.toLocal(neck.x, neck.y, neck.z, []);
    this.pitch0 = Math.atan2(n[2] - local[2], n[1] - local[1]);
    // The knee that is already farther up his body leads.
    const kl = rag.get(P.KN_L, {});
    const kr = rag.get(P.KN_R, {});
    this.lead = (kl.x - kr.x) * this.hx + (kl.z - kr.z) * this.hz >= 0 ? 0 : 1;
    // He stands up where his body is, near to where the game has him.
    const nominal = supine ? -STAND_ALONG.supine : STAND_ALONG.prone; // how far behind the spot his hips lie
    this.standFwd = clamp(this.fwd0 + nominal, -0.3, 0.3);
    this.standLat = clamp(this.lat0, -0.25, 0.25);
    const l = this.left();
    this.spot.x = this.ox + l[0] * this.standLat + this.hx * this.standFwd;
    this.spot.z = this.oz + l[1] * this.standLat + this.hz * this.standFwd;
    this.drive = 0;
    this.active = true;
  }

  stop() {
    this.active = false;
    this.drive = 0;
  }

  left() {
    return [this.hz, -this.hx];
  }

  toLocal(x, y, z, out) {
    const dx = x - this.ox;
    const dz = z - this.oz;
    out[0] = dx * this.hz - dz * this.hx;
    out[1] = y;
    out[2] = dx * this.hx + dz * this.hz;
    return out;
  }

  /**
   * Work out the goals for `u`, how far through getting up he is (0..1).
   * Fills `this.goal` and sets `this.drive`, how firmly to take him there.
   */
  update(u) {
    u = clamp(u, 0, 1);
    if (this.path === 'supine') this.fromBack(u);
    else this.fromFront(u);
    this.build();
    // Softly at first: he gathers himself from however he fell. Then it is all him.
    if (u < 0.16) this.drive = mix(0.012, 0.09, smooth(u / 0.16));
    else this.drive = mix(0.09, 1, ramp(u, 0.16, 0.48) ** 2);
    return this.drive;
  }

  /** Face down: hands, push up onto his knees, a foot through, up. */
  fromFront(u) {
    const s = this.spec;
    const lead = this.lead;
    const lat0 = this.lat0;
    const fwd0 = this.fwd0;
    const sl = this.standLat;
    const sf = this.standFwd;
    const hands = fwd0 + 0.42; // planted beside his chest
    const kneelFwd = sf - 0.44; // hips back over his knees, a stride behind where he will stand
    const kneelLat = mix(lat0, sl, 0.6);

    const push = ramp(u, 0.16, 0.4); // up off his chest and back onto his knees
    const rise = ramp(u, 0.38, 0.58); // trunk comes up off his hands: kneeling tall
    const free = ramp(u, 0.4, 0.56); // hands leave the turf
    const step = ramp(u, 0.52, 0.7); // the lead foot comes through and plants
    const stand = ramp(u, 0.68, 0.97); // up over it
    const follow = ramp(u, 0.74, 0.95); // the rear foot comes up alongside
    const hang = ramp(u, 0.62, 0.92);

    // Hips and trunk. The hips hitch up a little to let the foot through.
    const p = s.pelvis;
    p[0] = mix(mix(lat0, kneelLat, push), sl, stand);
    p[1] = mix(mix(0.17, 0.58, push) + 0.05 * Math.sin(Math.PI * step), B.hipHeight - 0.045, stand);
    p[2] = mix(mix(fwd0, kneelFwd, push), sf, stand);
    s.pitch = mix(mix(mix(mix(this.pitch0, 1.5, ramp(u, 0, 0.14)), 1.4, push), 0.3, rise), 0.07, stand);

    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? 1 : -1;
      // Hands: flat on the turf beside the chest, then onto his thighs, then down to his sides.
      const h = s.hands[i];
      h[0] = lat0 + sd * 0.33;
      h[1] = HAND_Y;
      h[2] = hands;
      mix3(h, [p[0] + sd * 0.2, p[1] - 0.04, p[2] + 0.2], free, h);
      mix3(h, [p[0] + sd * (B.shoulderWidth + 0.05), p[1] + 0.02, p[2] + 0.08], hang, h);
      mix3(ELBOW_PUSH, ELBOW_HANG, free, s.elbows[i]);
      s.elbows[i][0] *= sd;

      // Feet: toes dug in behind him, then shins on the turf as he kneels.
      const f = s.feet[i];
      f[0] = mix(lat0, kneelLat, push) + sd * 0.12;
      f[1] = FOOT_Y;
      f[2] = mix(fwd0 - 0.94, kneelFwd - 0.47, push);
      // Then each in turn comes through and plants flat under him.
      const through = i === lead ? step : follow;
      mix3(f, [sl + sd * STANCE, SOLE_Y, sf], through, f);
      f[1] += (i === lead ? 0.12 : 0.09) * Math.sin(Math.PI * through);
      mix3(KNEE_DOWN, KNEE_FWD, clamp(through * 4, 0, 1), s.knees[i]);
    }
  }

  /** On his back: feet in, hands behind, sit up, rock forward, up. */
  fromBack(u) {
    const s = this.spec;
    const side = (i) => (i === 0 ? 1 : -1);
    const lat0 = this.lat0;
    const fwd0 = this.fwd0;
    const sl = this.standLat;
    const sf = this.standFwd;

    const sit = ramp(u, 0.14, 0.44); // trunk comes up
    const rock = ramp(u, 0.42, 0.62); // and on over his feet
    const lift = ramp(u, 0.5, 0.74); // hips come off the turf
    const stand = ramp(u, 0.7, 0.97);
    const free = ramp(u, 0.46, 0.66); // hands leave the turf
    const hang = ramp(u, 0.74, 0.98);
    const draw = ramp(u, 0, 0.2); // feet drawn in

    const p = s.pelvis;
    p[0] = mix(lat0, sl, Math.max(lift, sit * 0.5));
    p[1] = mix(mix(0.17, 0.56, lift), B.hipHeight - 0.045, stand);
    p[2] = mix(mix(fwd0, sf - 0.2, lift), sf, stand);
    s.pitch = mix(mix(mix(mix(this.pitch0, -1.47, ramp(u, 0, 0.14)), -0.45, sit), 0.66, rock), 0.07, stand);

    for (let i = 0; i < 2; i++) {
      const sd = side(i);
      // Hands: on the turf just behind his hips to prop him up, then forward as he rocks over.
      const h = s.hands[i];
      h[0] = lat0 + sd * 0.3;
      h[1] = HAND_Y;
      h[2] = fwd0 - 0.22;
      mix3(h, [sl + sd * 0.27, 0.3, sf + 0.02], free, h);
      mix3(h, [p[0] + sd * (B.shoulderWidth + 0.05), p[1] + 0.02, p[2] + 0.08], hang, h);
      mix3(ELBOW_PROP, ELBOW_HANG, free, s.elbows[i]);
      s.elbows[i][0] *= sd;

      // Feet: drawn in until they are flat under his knees, and there they stay.
      const f = s.feet[i];
      f[0] = mix(lat0, sl, draw) + sd * STANCE;
      f[1] = mix(FOOT_Y, SOLE_Y, draw);
      f[2] = mix(fwd0 + 0.9, sf, draw);
      mix3(KNEE_UP, KNEE_FWD, lift, s.knees[i]);
    }
  }

  /** Turn the spec into where every particle goes. */
  build() {
    const s = this.spec;
    const pts = this.pts;
    const cp = Math.cos(s.pitch);
    const sp = Math.sin(s.pitch);
    // His spine and the way his chest faces, in [left, up, forward].
    const ux = 0;
    const uy = cp;
    const uz = sp;
    const fy = -sp;
    const fz = cp;
    const pel = s.pelvis;
    const at = (i, along, front, lat) => {
      const pt = pts[i];
      pt[0] = pel[0] + ux * along + lat;
      pt[1] = pel[1] + uy * along + fy * front;
      pt[2] = pel[2] + uz * along + fz * front;
      return pt;
    };
    at(P.PELVIS, 0, 0, 0);
    const neck = at(P.NECK, B.spine, 0, 0);
    at(P.CHEST, B.spine * 0.62, B.chestDepth, 0);
    // His head stays up: he is looking where he is going, not at the turf.
    let hy = uy + 0.6;
    let hz = uz;
    const hl = Math.hypot(hy, hz) || 1;
    hy /= hl;
    hz /= hl;
    const head = pts[P.HEAD];
    head[0] = neck[0];
    head[1] = neck[1] + hy * B.neck;
    head[2] = neck[2] + hz * B.neck;

    const ids = [
      [P.SH_L, P.EL_L, P.HA_L, P.HIP_L, P.KN_L, P.FT_L],
      [P.SH_R, P.EL_R, P.HA_R, P.HIP_R, P.KN_R, P.FT_R],
    ];
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? 1 : -1;
      const [SH, EL, HA, HIP, KN, FT] = ids[i];
      const shoulder = at(SH, B.spine - B.shoulderDrop, 0, sd * B.shoulderWidth);
      const hip = at(HIP, 0, 0, sd * B.hipWidth);
      reach(shoulder, s.hands[i], B.upperArm, B.forearm, s.elbows[i], pts[EL], pts[HA], MIN_ARM);
      reach(hip, s.feet[i], B.thigh, B.shin, s.knees[i], pts[KN], pts[FT], MIN_LEG);
    }

    // Into the world.
    const goal = this.goal;
    const lx = this.hz;
    const lz = -this.hx;
    for (let i = 0; i < N; i++) {
      const pt = pts[i];
      goal[i * 3] = this.ox + lx * pt[0] + this.hx * pt[2];
      goal[i * 3 + 1] = pt[1];
      goal[i * 3 + 2] = this.oz + lz * pt[0] + this.hz * pt[2];
    }
  }
}
