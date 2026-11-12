import * as THREE from 'three';
import { clamp } from '../core/vec.js';

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

function numberTexture(number, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.font = '900 96px "Arial Narrow", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(number), 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A low-poly football player built from primitives, animated procedurally
 * from the simulation state (speed, jumping, catching, celebrating...).
 * The model faces +z; one unit is one yard.
 */
export class AthleteModel {
  constructor(colors, number = 1) {
    this.group = new THREE.Group();
    this.mats = {
      jersey: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
      trim: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
      helmet: new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.25 }),
      pants: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }),
      number: new THREE.MeshBasicMaterial({ transparent: true }),
    };
    this.phase = Math.random() * 6;
    this.time = Math.random() * 10;
    this.build();
    this.setLook(colors, number);
  }

  mesh(geometry, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  build() {
    const M = this.mats;
    const body = (this.body = new THREE.Group());
    body.position.y = 1.0; // hips
    this.group.add(body);

    body.add(this.mesh(new THREE.BoxGeometry(0.36, 0.2, 0.23), M.pants, 0, 0.02, 0));
    const torso = (this.torso = new THREE.Group());
    body.add(torso);
    torso.add(this.mesh(new THREE.BoxGeometry(0.42, 0.5, 0.25), M.jersey, 0, 0.36, 0));
    torso.add(this.mesh(new THREE.BoxGeometry(0.62, 0.17, 0.33), M.jersey, 0, 0.58, 0));
    torso.add(this.mesh(new THREE.BoxGeometry(0.64, 0.035, 0.34), M.trim, 0, 0.5, 0));

    for (const z of [0.128, -0.128]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), M.number);
      plate.position.set(0, 0.36, z);
      if (z < 0) plate.rotation.y = Math.PI;
      torso.add(plate);
    }

    const head = (this.head = new THREE.Group());
    head.position.y = 0.84;
    torso.add(head);
    head.add(this.mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), M.skin, 0, -0.12, 0));
    head.add(this.mesh(new THREE.SphereGeometry(0.175, 16, 12), M.helmet, 0, 0.03, 0));
    head.add(this.mesh(new THREE.BoxGeometry(0.05, 0.03, 0.36), M.trim, 0, 0.19, -0.01));
    head.add(this.mesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), M.dark, 0, -0.02, 0.165));
    head.add(this.mesh(new THREE.BoxGeometry(0.22, 0.025, 0.07), M.trim, 0, -0.03, 0.175));

    const limb = (r, length, mat) => {
      const m = this.mesh(new THREE.CylinderGeometry(r, r * 0.86, length, 8), mat, 0, -length / 2, 0);
      return m;
    };

    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.34, 0.56, 0);
      torso.add(shoulder);
      shoulder.add(limb(0.07, 0.3, M.jersey));
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      elbow.add(limb(0.055, 0.28, M.skin));
      elbow.add(this.mesh(new THREE.SphereGeometry(0.062, 8, 6), M.trim, 0, -0.31, 0));
      return { shoulder, elbow, side };
    });

    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, -0.06, 0);
      body.add(hip);
      hip.add(limb(0.095, 0.46, M.pants));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      knee.add(limb(0.07, 0.42, M.trim));
      knee.add(this.mesh(new THREE.BoxGeometry(0.12, 0.09, 0.28), M.dark, 0, -0.44, 0.06));
      return { hip, knee, side };
    });
  }

  setLook(colors, number) {
    const M = this.mats;
    M.jersey.color.setHex(colors.jersey);
    M.trim.color.setHex(colors.trim);
    M.helmet.color.setHex(colors.helmet);
    M.pants.color.setHex(colors.pants);
    if (colors.skin) M.skin.color.setHex(colors.skin);
    M.number.map?.dispose();
    M.number.map = numberTexture(number, '#' + new THREE.Color(colors.trim).getHexString());
    M.number.needsUpdate = true;
  }

  /**
   * state: { x, y, z, facing, speed, backpedal, airborne, attempting,
   *          calling, hasBall, mood, throwing (0..1 or null), crouch }
   */
  update(dt, s) {
    this.time += dt;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.facing;

    const amp = clamp(s.speed / 8.5, 0, 1);
    if (s.speed > 0.3) this.phase += dt * (4.5 + s.speed * 1.55);
    const sin = Math.sin(this.phase);
    const cos = Math.cos(this.phase);
    const dir = s.backpedal ? -0.6 : 1;

    // target pose
    let lean = amp * 0.3 * (s.backpedal ? -0.35 : 1) + (s.crouch ? 0.22 : 0);
    let bob = Math.abs(sin) * 0.05 * amp;
    let headTilt = 0;
    const crouchKnee = s.crouch ? 0.45 : 0.08;
    const hips = [-sin * 0.95 * amp * dir - (s.crouch ? 0.3 : 0), sin * 0.95 * amp * dir - (s.crouch ? 0.3 : 0)];
    const knees = [crouchKnee + amp * 1.15 * Math.max(0, cos), crouchKnee + amp * 1.15 * Math.max(0, -cos)];
    const shoulders = [sin * 0.9 * amp, -sin * 0.9 * amp];
    const spread = [0.08, 0.08]; // arms out from the body
    const elbows = [-(0.35 + 1.05 * amp), -(0.35 + 1.05 * amp)];

    if (s.airborne || s.attempting) {
      shoulders[0] = shoulders[1] = -2.85;
      elbows[0] = elbows[1] = -0.18;
      spread[0] = spread[1] = 0.12;
      hips[0] = -0.25;
      hips[1] = 0.2;
      knees[0] = 0.75;
      knees[1] = 0.35;
      lean = 0.05;
    } else if (s.throwing !== null && s.throwing !== undefined) {
      // cock the arm back, then whip it through
      const k = s.throwing;
      shoulders[1] = k < 1 ? -2.4 - 0.5 * k : -1.1;
      elbows[1] = k < 1 ? -1.5 + 0.6 * k : -0.25;
      spread[1] = 0.5;
      shoulders[0] = -1.1;
      elbows[0] = -0.7;
      lean = k < 1 ? -0.08 : 0.2;
    } else if (s.mood === 'celebrate') {
      const pump = Math.sin(this.time * 11);
      shoulders[0] = shoulders[1] = -2.6 + pump * 0.25;
      elbows[0] = elbows[1] = -0.5;
      spread[0] = spread[1] = 0.35;
      bob = Math.abs(Math.sin(this.time * 5.5)) * 0.22;
      lean = -0.06;
    } else if (s.mood === 'dejected') {
      lean = 0.3;
      headTilt = 0.55;
      shoulders[0] = shoulders[1] = 0.1;
      elbows[0] = elbows[1] = -0.15;
    } else if (s.calling) {
      shoulders[1] = -2.95;
      elbows[1] = -0.1;
      spread[1] = 0.25;
    }
    if (s.hasBall && s.mood !== 'celebrate') {
      shoulders[0] = -0.55;
      elbows[0] = -1.9;
    }

    const r = 18;
    this.body.rotation.x = damp(this.body.rotation.x, lean, r, dt);
    this.body.position.y = damp(this.body.position.y, 1.0 - (s.crouch ? 0.12 : 0) + bob, 22, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headTilt, 8, dt);
    this.legs.forEach((leg, i) => {
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hips[i], 30, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, knees[i], 30, dt);
    });
    this.arms.forEach((arm, i) => {
      arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, shoulders[i], r, dt);
      arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * spread[i], r, dt);
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, elbows[i], r, dt);
    });
  }
}
