import * as THREE from 'three';

const flat = (geometry, color, opacity = 1) => {
  const m = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
};

/** Ground markers: who you are, who he is, and where the ball is coming down. */
export class Markers {
  constructor() {
    this.group = new THREE.Group();
    this.userRing = flat(new THREE.RingGeometry(0.5, 0.64, 32), 0x3fe0ff, 0.95);
    this.rivalRing = flat(new THREE.RingGeometry(0.5, 0.58, 32), 0xff4d4d, 0.7);
    this.target = flat(new THREE.RingGeometry(0.5, 0.72, 40), 0xffe23d, 0.95);
    this.targetDot = flat(new THREE.CircleGeometry(0.16, 20), 0xffe23d, 0.95);
    this.closing = flat(new THREE.RingGeometry(0.94, 1.0, 48), 0xffffff, 0.9);
    this.group.add(this.userRing, this.rivalRing, this.target, this.targetDot, this.closing);
    this.hideTarget();
    this.time = 0;
  }

  hideTarget() {
    this.target.visible = this.targetDot.visible = this.closing.visible = false;
  }

  update(dt, { user, rival, ball }) {
    this.time += dt;
    this.userRing.position.set(user.pos.x, 0.03, user.pos.z);
    this.rivalRing.position.set(rival.pos.x, 0.03, rival.pos.z);
    const pulse = 1 + Math.sin(this.time * 6) * 0.05;
    this.userRing.scale.set(pulse, pulse, 1);

    if (ball.state === 'flight' && ball.target) {
      const t = ball.target;
      this.target.visible = this.targetDot.visible = this.closing.visible = true;
      this.target.position.set(t.x, 0.035, t.z);
      this.targetDot.position.set(t.x, 0.036, t.z);
      this.closing.position.set(t.x, 0.037, t.z);
      // The white ring closes onto the yellow one exactly as the ball arrives.
      const k = Math.max(0, ball.eta) / Math.max(ball.flightTime, 0.01);
      const scale = 0.75 + 3.2 * k;
      this.closing.scale.set(scale, scale, 1);
      this.closing.material.opacity = 0.35 + 0.6 * (1 - k);
    } else {
      this.hideTarget();
    }
  }
}
