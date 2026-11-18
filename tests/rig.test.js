import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRig } from '../src/render/athlete/rig.js';

describe('the player model', () => {
  it('limbs and the lower body face out from themselves, not straight up or down', () => {
    // Bones: spine 1, elbows 5 and 8 (forearms), hips 10 and 13 (thighs), knees 11 and 14 (shins).
    const mesh = buildRig(new THREE.MeshBasicMaterial()).mesh;
    const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (const bone of [1, 5, 8, 10, 11, 13, 14]) {
      let count = 0;
      let flat = 0;
      let vertical = 0;
      for (let i = 0; i < position.count; i++) {
        if (skinIndex.getX(i) !== bone || skinWeight.getX(i) < 0.99) continue;
        count += 1;
        const ny = Math.abs(normal.getY(i));
        flat += ny;
        if (ny > 0.999) vertical += 1;
      }
      expect(count).toBeGreaterThan(20);
      expect(vertical).toBe(0);
      expect(flat / count).toBeLessThan(0.35); // round tubes: mostly sideways
    }
  });
});
