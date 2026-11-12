import * as THREE from 'three';
import { GRAVITY } from '../config.js';

const MAX = 420;

function blobTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Small things that sell contact with the ground: rubber pellets and bits of
 * turf thrown up by cleats and bodies, and a soft dark patch under each
 * player so he looks planted on the field.
 */
export class Effects {
  constructor() {
    this.group = new THREE.Group();
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.colors = new Float32Array(MAX * 3);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -5;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.075, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const tex = blobTexture();
    this.blobs = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 })
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.group.add(m);
      return m;
    });
  }

  /** Kick up `count` bits of turf at (x, z), thrown roughly along (vx, vz). */
  burst(x, z, count, vx = 0, vz = 0, power = 1) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const k = i * 3;
      this.pos[k] = x + (Math.random() - 0.5) * 0.3;
      this.pos[k + 1] = 0.04;
      this.pos[k + 2] = z + (Math.random() - 0.5) * 0.3;
      const spread = 1.6 * power;
      this.vel[k] = vx * 0.3 + (Math.random() - 0.5) * spread;
      this.vel[k + 1] = (0.9 + Math.random() * 2.2) * power;
      this.vel[k + 2] = vz * 0.3 + (Math.random() - 0.5) * spread;
      this.life[i] = 0.5 + Math.random() * 0.5;
      // Mostly black rubber, some green blades.
      const green = Math.random() < 0.35;
      this.colors[k] = green ? 0.12 : 0.03;
      this.colors[k + 1] = green ? 0.36 : 0.035;
      this.colors[k + 2] = green ? 0.12 : 0.03;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  /** Put the soft shadow under body number `i` at (x, z), `height` yards off the turf. */
  blob(i, x, z, height = 0, size = 1.25) {
    const b = this.blobs[i];
    b.visible = true;
    b.position.set(x, 0.022, z);
    const s = size * (1 + height * 0.35);
    b.scale.set(s, s, 1);
    b.material.opacity = Math.max(0.15, 0.8 - height * 0.5);
  }

  hideBlobs() {
    for (const b of this.blobs) b.visible = false;
  }

  update(dt) {
    if (dt <= 0) return;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      this.vel[k + 1] -= GRAVITY * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k] *= 0.4;
        this.vel[k + 1] = 0;
        this.vel[k + 2] *= 0.4;
      }
      if (this.life[i] <= 0) this.pos[k + 1] = -5; // parked out of sight
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
