import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { makeCanvas, writeNormals, canvasTexture } from './textures.js';

const HALF_LENGTH = 0.16;
const RADIUS = 0.1;

/** Pebbled leather, four panel seams, white stripes near the tips and the laces on top. */
function leather() {
  const W = 512;
  const H = 256;
  const rng = new RNG(77);
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  g.fillStyle = '#6e3518';
  g.fillRect(0, 0, W, H);
  // Wear: lighter and darker patches.
  for (let i = 0; i < 60; i++) {
    const x = rng.next() * W;
    const y = rng.next() * H;
    const r = 8 + rng.next() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rng.chance(0.5) ? 'rgba(150,80,40,0.25)' : 'rgba(40,15,5,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const height = new Float32Array(W * H);
  for (let i = 0; i < height.length; i++) height[i] = rng.next() * 0.5;
  // Seams between the panels.
  g.fillStyle = 'rgba(25,10,4,0.85)';
  for (let k = 0; k < 4; k++) {
    const x = Math.round((0.125 + k * 0.25) * W);
    g.fillRect(x - 1.5, 0, 3, H);
    for (let y = 0; y < H; y++) for (let d = -3; d <= 3; d++) height[y * W + ((x + d + W) % W)] = Math.abs(d) < 2 ? 0 : 0.2;
  }
  // Stripes near each tip.
  g.fillStyle = '#f1ede2';
  for (const v of [0.17, 0.79]) g.fillRect(0, v * H, W, 0.045 * H);
  // Laces on top: a strip and eight stitches across it.
  g.fillStyle = '#f4f1e8';
  const lx = W / 2;
  g.fillRect(lx - 3, H * 0.32, 6, H * 0.36);
  for (let i = 0; i < 8; i++) {
    const y = H * (0.34 + i * 0.045);
    g.fillRect(lx - 14, y, 28, 5);
    for (let x = lx - 14; x < lx + 14; x++) for (let d = 0; d < 5; d++) height[Math.floor(y + d) * W + x] = 1;
  }
  const n = makeCanvas(W, H);
  const ng = n.getContext('2d');
  const img = ng.createImageData(W, H);
  writeNormals(img, W, height, W, H, 1.2);
  ng.putImageData(img, 0, 0);
  return { map: canvasTexture(canvas, { anisotropy: 4 }), normal: canvasTexture(n, { srgb: false, anisotropy: 4 }) };
}

/** The football, plus a soft shadow blob so its position reads in the air. */
export class BallModel {
  constructor() {
    this.group = new THREE.Group();
    const profile = [];
    for (let i = 0; i <= 24; i++) {
      const t = -1 + (i / 24) * 2;
      profile.push(new THREE.Vector2(Math.max(0.0008, RADIUS * Math.pow(1 - t * t, 0.72)), t * HALF_LENGTH));
    }
    const geo = new THREE.LatheGeometry(profile, 24);
    geo.rotateX(Math.PI / 2); // long axis along z, laces on top
    const { map, normal } = leather();
    this.spinner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.58 }));
    this.spinner.castShadow = true;
    this.group.add(this.spinner);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.look = new THREE.Vector3();
  }

  /**
   * `pos` is where to draw a ball that is in the air (smoothed between sim
   * steps); `holder` is the model whose hands it is in, if anybody's.
   */
  update(dt, ball, pos = ball.pos, holder = null) {
    const moving = ball.state === 'flight' || ball.state === 'loose';
    if (holder) {
      this.group.position.copy(holder.socket);
      this.look.copy(holder.socket).add(holder.socketDir);
      this.group.lookAt(this.look);
    } else {
      this.group.position.set(pos.x, pos.y, pos.z);
    }
    if (moving) {
      const v = ball.vel;
      if (Math.hypot(v.x, v.y, v.z) > 0.5) {
        this.look.set(pos.x + v.x, pos.y + v.y, pos.z + v.z);
        this.group.lookAt(this.look);
      }
      // A thrown ball is a tight spiral; a tipped one tumbles.
      const spiral = ball.state === 'flight' && !ball.tips;
      this.spinner.rotation.z += dt * (spiral ? 28 : 9);
      this.spinner.rotation.x = spiral ? 0 : this.spinner.rotation.x + dt * 11;
    } else {
      this.spinner.rotation.x = 0;
    }
    this.shadow.visible = moving;
    this.shadow.position.set(pos.x, 0.02, pos.z);
    const k = 1 + pos.y * 0.12;
    this.shadow.scale.set(k, k, k);
    this.shadow.material.opacity = Math.max(0.08, 0.38 - pos.y * 0.025);
  }
}
