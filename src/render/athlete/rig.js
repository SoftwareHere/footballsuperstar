import * as THREE from 'three';
import { BODY } from '../../physics/body.js';

const B = BODY;

/** A body of revolution from [[y, radius], ...] listed bottom to top. */
function lathe(profile, material, { segments = 14, squash = 1, widen = 1 } = {}) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0005), y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, segments), material);
  mesh.scale.set(widen, 1, squash);
  mesh.castShadow = true;
  return mesh;
}

/**
 * A limb segment hanging from its joint down to -length, with rounded ends.
 * radii = [top, middle, bottom]; `bulge` is how far down the middle sits (0..1).
 */
function limbProfile(length, [rTop, rMid, rBot], bulge = 0.4) {
  const out = [];
  const n = 9;
  out.push([-length - rBot * 0.6, 0]);
  for (let i = 0; i <= n; i++) {
    const t = 1 - i / n; // 1 at the bottom, 0 at the top
    let r;
    if (t < bulge) r = rTop + (rMid - rTop) * Math.sin((t / bulge) * Math.PI * 0.5);
    else r = rMid + (rBot - rMid) * (1 - Math.cos(((t - bulge) / (1 - bulge)) * Math.PI * 0.5));
    out.push([-length * t, r]);
  }
  out.push([rTop * 0.6, 0]);
  return out;
}

const limb = (length, radii, material, bulge, opts) => lathe(limbProfile(length, radii, bulge), material, opts);

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A horizontal bar of the facemask: an arc of tube wrapped around the front of the helmet. */
function maskBar(radius, y, arc, material, forward = 0) {
  const bar = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.0085, 5, 14, arc), material);
  bar.rotation.set(Math.PI / 2, 0, Math.PI / 2 - arc / 2);
  bar.position.set(0, y, forward);
  bar.castShadow = true;
  return bar;
}

function buildHead(M) {
  const head = new THREE.Group(); // origin at the base of the neck
  const cy = B.neck; // centre of the helmet
  const r = B.headRadius;
  head.add(mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.12, 10), M.skin, 0, 0.04, 0));

  // The shell: a full dome, plus the back and sides down to the jaw. The face is open.
  const shell = new THREE.Group();
  shell.position.y = cy;
  shell.scale.set(1, 1.03, 1.1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.helmet);
  // Sides and back: everything except a ~120 degree window at the front (+z).
  const open = 1.05; // half-width of the face opening, radians
  const back = new THREE.Mesh(
    new THREE.SphereGeometry(r, 18, 8, Math.PI / 2 + open, Math.PI * 2 - open * 2, Math.PI * 0.5, Math.PI * 0.3),
    M.helmet
  );
  const brow = new THREE.Mesh(new THREE.SphereGeometry(r * 1.005, 12, 3, Math.PI / 2 - open, open * 2, Math.PI * 0.36, Math.PI * 0.14), M.helmet);
  for (const m of [dome, back, brow]) {
    m.castShadow = true;
    shell.add(m);
  }
  // Stripe over the top, front to back.
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(r * 1.002, 0.005, 4, 18, Math.PI * 0.86), M.trim);
  stripe.rotation.order = 'YXZ';
  stripe.rotation.set(0, -Math.PI / 2, Math.PI * 0.07);
  stripe.scale.set(1, 1, 6);
  shell.add(stripe);
  head.add(shell);

  // Inside the opening: a dark visor over the eyes and a little skin below it.
  const face = mesh(new THREE.SphereGeometry(r * 0.86, 14, 10), M.skin, 0, cy - 0.012, 0.022);
  face.scale.set(0.92, 1, 1);
  head.add(face);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.97, 14, 4, Math.PI / 2 - open * 0.92, open * 1.84, Math.PI * 0.39, Math.PI * 0.16),
    M.visor
  );
  visor.position.set(0, cy, 0.012);
  visor.scale.set(1, 1.03, 1.1);
  head.add(visor);

  // Facemask.
  const maskR = r * 1.1 * 0.98;
  head.add(maskBar(maskR, cy - 0.035, 2.0, M.mask, 0.004));
  head.add(maskBar(maskR * 0.97, cy - 0.085, 1.9, M.mask, 0.006));
  head.add(maskBar(maskR * 0.9, cy - 0.132, 1.75, M.mask, 0.004));
  for (const x of [-0.045, 0.045]) {
    const post = mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.105, 5), M.mask, x, cy - 0.084, maskR * 0.94);
    post.rotation.x = 0.12;
    head.add(post);
  }
  // Chin strap and ear holes.
  head.add(mesh(new THREE.BoxGeometry(0.1, 0.03, 0.035), M.trim, 0, cy - 0.145, 0.105));
  for (const s of [-1, 1]) head.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8), M.dark, s * r * 0.985, cy - 0.03, 0.01).rotateZ(Math.PI / 2));
  return head;
}

/**
 * The player: a jointed skeleton with the body built onto it.
 *
 *   pelvis -> spine -> chest -> head
 *                      chest -> shoulder -> elbow -> hand   (x2)
 *   pelvis -> hip -> knee -> foot                           (x2)
 *
 * `root` stays at the world origin; `pelvis` is placed in world space by
 * whoever is driving the body (the animator or the ragdoll). Arms and legs
 * are listed left (+x) first. Every limb hangs straight down at rest.
 */
export function buildRig(M) {
  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  root.add(pelvis);

  // Hips: padded pants.
  const hips = mesh(new THREE.SphereGeometry(0.175, 16, 12), M.pants, 0, 0.03, -0.005);
  hips.scale.set(1.05, 0.78, 0.8);
  pelvis.add(hips);
  const belt = mesh(new THREE.TorusGeometry(0.158, 0.016, 6, 20), M.trim, 0, 0.115, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.74, 1);
  pelvis.add(belt);

  // Belly.
  const spine = new THREE.Group();
  spine.position.y = 0.06;
  pelvis.add(spine);
  spine.add(
    lathe(
      [
        [0.02, 0.15],
        [0.06, 0.165],
        [0.16, 0.172],
        [0.27, 0.19],
      ],
      M.jersey,
      { squash: 0.72 }
    )
  );

  // Ribcage and shoulder pads.
  const chest = new THREE.Group();
  chest.position.y = B.chestAt - 0.06;
  spine.add(chest);
  const top = B.spine - B.chestAt; // shoulder line, in chest space
  chest.add(
    lathe(
      [
        [-0.03, 0.19],
        [0.06, 0.212],
        [0.16, 0.225],
        [0.24, 0.2],
        [0.3, 0.12],
        [0.33, 0.075],
      ],
      M.jersey,
      { squash: 0.7 }
    )
  );
  const pads = mesh(new THREE.CapsuleGeometry(0.105, 0.36, 6, 12), M.jersey, 0, top - 0.02, -0.005);
  pads.rotation.z = Math.PI / 2;
  pads.scale.set(0.86, 1, 1.4);
  chest.add(pads);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(0.125, 12, 10), M.jersey, s * (B.shoulderWidth + 0.035), top - 0.03, 0);
    cap.scale.set(1.05, 0.78, 1.18);
    chest.add(cap);
    // Shoulder stripe.
    const stripe = mesh(new THREE.TorusGeometry(0.103, 0.012, 5, 14), M.trim, s * (B.shoulderWidth + 0.085), top - 0.05, 0);
    stripe.rotation.y = Math.PI / 2;
    stripe.rotation.z = 0;
    stripe.scale.set(1.15, 0.8, 1);
    chest.add(stripe);
  }
  chest.add(mesh(new THREE.TorusGeometry(0.082, 0.02, 6, 14), M.trim, 0, top + 0.015, 0).rotateX(Math.PI / 2));

  // Numbers, front and back.
  for (const dir of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), M.number);
    plate.position.set(0, 0.1, dir * 0.163);
    if (dir < 0) plate.rotation.y = Math.PI;
    chest.add(plate);
  }

  const head = buildHead(M);
  head.position.y = top + 0.01;
  chest.add(head);

  const arms = [1, -1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * B.shoulderWidth, top - B.shoulderDrop, 0);
    chest.add(shoulder);
    // Sleeve, then bare arm.
    shoulder.add(limb(0.17, [0.078, 0.076, 0.068], M.jersey, 0.3));
    const bicep = limb(B.upperArm - 0.1, [0.064, 0.062, 0.05], M.skin, 0.35);
    bicep.position.y = -0.1;
    shoulder.add(bicep);
    const cuff = mesh(new THREE.TorusGeometry(0.066, 0.011, 5, 12), M.trim, 0, -0.165, 0);
    cuff.rotation.x = Math.PI / 2;
    shoulder.add(cuff);

    const elbow = new THREE.Group();
    elbow.position.y = -B.upperArm;
    shoulder.add(elbow);
    elbow.add(limb(B.forearm, [0.05, 0.053, 0.036], M.skin, 0.3));
    const band = mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.05, 10), M.trim, 0, -B.forearm + 0.045, 0);
    elbow.add(band);

    const hand = new THREE.Group();
    hand.position.y = -B.forearm;
    elbow.add(hand);
    const palm = mesh(new THREE.CapsuleGeometry(0.034, 0.055, 4, 8), M.glove, 0, -0.045, 0);
    palm.scale.set(1.15, 1, 0.62);
    hand.add(palm);
    const thumb = mesh(new THREE.CapsuleGeometry(0.014, 0.035, 3, 6), M.glove, 0, -0.03, 0.035);
    thumb.rotation.x = -0.7;
    hand.add(thumb);
    return { shoulder, elbow, hand, side };
  });

  const legs = [1, -1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * B.hipWidth, 0, 0);
    pelvis.add(hip);
    hip.add(limb(B.thigh, [0.112, 0.108, 0.074], M.pants, 0.3));
    // Thigh pad.
    const pad = mesh(new THREE.SphereGeometry(0.07, 10, 8), M.pants, 0, -0.2, 0.062);
    pad.scale.set(1, 1.5, 0.5);
    hip.add(pad);

    const knee = new THREE.Group();
    knee.position.y = -B.thigh;
    hip.add(knee);
    // Pants finish just below the knee, then the sock.
    knee.add(limb(0.13, [0.078, 0.076, 0.062], M.pants, 0.4));
    const kneePad = mesh(new THREE.SphereGeometry(0.052, 10, 8), M.pants, 0, -0.01, 0.045);
    kneePad.scale.set(1, 1.2, 0.6);
    knee.add(kneePad);
    const calf = limb(B.shin - 0.1, [0.058, 0.066, 0.04], M.sock, 0.35);
    calf.position.y = -0.1;
    knee.add(calf);
    const sockBand = mesh(new THREE.CylinderGeometry(0.062, 0.06, 0.035, 10), M.trim, 0, -0.14, 0);
    knee.add(sockBand);

    const foot = new THREE.Group(); // the ankle
    foot.position.y = -B.shin;
    knee.add(foot);
    const shoe = mesh(new THREE.CapsuleGeometry(0.046, 0.15, 5, 10), M.dark, 0, -0.012, 0.062);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1, 1, 0.78);
    foot.add(shoe);
    const sole = mesh(new THREE.BoxGeometry(0.085, 0.014, 0.24), M.sole, 0, -B.ankle + 0.008, 0.062);
    foot.add(sole);
    foot.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.012), M.trim, 0, 0.0, 0.11));
    return { hip, knee, foot, side };
  });

  return { root, pelvis, spine, chest, head, arms, legs };
}
