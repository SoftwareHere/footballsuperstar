import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Everything here is generated, never downloaded, and seeded so the picture
// is the same on every load.

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const fade = (t) => t * t * (3 - 2 * t);

/**
 * Tileable value noise in 0..1: `cx` by `cy` lattice cells across the first
 * octave (different counts stretch it, like grass laid one way), doubling
 * each octave, each octave `gain` times as strong as the last.
 */
export function tileNoise(size, cx, cy, octaves, seed, gain = 0.5) {
  const rng = new RNG(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = cx << o;
    const ny = cy << o;
    const lat = new Float32Array(nx * ny);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ny;
      const y0 = Math.floor(fy);
      const ty = fade(fy - y0);
      const r0 = (y0 % ny) * nx;
      const r1 = ((y0 + 1) % ny) * nx;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * nx;
        const x0 = Math.floor(fx);
        const tx = fade(fx - x0);
        const a = x0 % nx;
        const b = (x0 + 1) % nx;
        const top = lat[r0 + a] + (lat[r0 + b] - lat[r0 + a]) * tx;
        const bot = lat[r1 + a] + (lat[r1 + b] - lat[r1 + a]) * tx;
        out[y * size + x] += (top + (bot - top) * ty) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Write a height field (w x h, wrapping) as a tangent-space normal map into `img` at (ox, oy). */
export function writeNormals(img, imgW, height, w, h, strength, ox = 0, oy = 0, wrap = true) {
  const at = (x, y) => {
    if (wrap) return height[((y + h) % h) * w + ((x + w) % w)];
    return height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  };
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const k = ((oy + y) * imgW + ox + x) * 4;
      d[k] = (-dx * inv * 0.5 + 0.5) * 255;
      d[k + 1] = (dy * inv * 0.5 + 0.5) * 255; // canvas rows run down, texture v runs up
      d[k + 2] = (inv * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
}

/** A canvas as a texture: mipmapped, sharp at an angle, optionally tiling. */
export function canvasTexture(canvas, { srgb = true, repeat = false, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}
