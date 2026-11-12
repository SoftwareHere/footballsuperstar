import * as THREE from 'three';

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

// The cinematic camera's fixed mount, per role: yards behind the player,
// yards above the turf, how far it sits off his shoulder, and how far ahead
// of him it looks. On defense the receiver starts behind you, so the mount
// is farther back to keep him in the picture.
const LOCK = {
  wr: { back: 5.4, height: 2.75, side: 0.55, ahead: 9, fov: 50 },
  db: { back: 11.5, height: 5.6, side: 0, ahead: 7, fov: 50 },
};

/**
 * The camera always looks downfield, so up-screen is downfield and the
 * controls never rotate.
 *
 *   follow     sits behind your athlete and eases after him
 *   broadcast  a high wide angle of the whole rep
 *   lock       cinematic: bolted to your athlete. It moves exactly as he
 *              moves, with no lag and no swivel, and never turns away from
 *              the end zone.
 */
export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 600);
    this.pos = new THREE.Vector3(0, 8, 14);
    this.look = new THREE.Vector3(0, 1, -6);
    this.wantPos = new THREE.Vector3();
    this.wantLook = new THREE.Vector3();
    this.mode = 'follow';
    this.orbit = 0;
    this.snapNext = true;
    this.fov = 52;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.offset = new THREE.Vector3(); // camera minus player, for the lock camera (and its tests)
  }

  /** Jump straight to the next target instead of easing (new rep, mode change). */
  cut() {
    this.snapNext = true;
  }

  /** Rattle the camera: a hit, or a body landing. `amount` is roughly yards. */
  shake(amount) {
    this.shakeAmount = Math.min(0.5, Math.max(this.shakeAmount, amount));
  }

  update(dt, { focus, other = null, ball, mode, role = 'wr' }) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.cut();
    }
    const flight = ball && ball.state === 'flight' && ball.target;
    let fov = 52;
    if (mode === 'lock') {
      const m = LOCK[role] || LOCK.wr;
      // Bolted on: no easing. The only things that change are the lens
      // (wider at speed and while the ball is up) and a little shake.
      const side = focus.x >= 0 ? -m.side : m.side; // over the shoulder nearer the middle of the field
      this.lockSide = this.snapNext || this.lockSide === undefined ? side : this.lockSide;
      this.offset.set(this.lockSide, m.height, m.back);
      this.pos.set(focus.x + this.offset.x, (focus.y || 0) * 0.7 + this.offset.y, focus.z + this.offset.z);
      this.look.set(this.pos.x, this.pos.y - (m.height - 1.25), this.pos.z - m.back - m.ahead);
      fov = m.fov + Math.min(8, (focus.speed || 0) * 0.8) + (flight ? 6 : 0);
      this.finish(dt, fov, 5);
      return;
    }
    if (mode === 'broadcast') {
      this.wantPos.set(focus.x * 0.3, 25, focus.z * 0.55 + 25);
      this.wantLook.set(focus.x * 0.55, 0, focus.z * 0.6 - 8);
      if (flight) this.wantLook.lerp(new THREE.Vector3(ball.target.x, 0, ball.target.z), 0.35);
    } else {
      let back = 9.5;
      let height = 5.0;
      let lookX = focus.x;
      let lookZ = focus.z - 8;
      // On defense the receiver starts between you and the camera: back the
      // camera off until he is comfortably in frame.
      const behind = other ? Math.min(12, Math.max(0, other.z - focus.z)) : 0;
      back += behind * 0.95;
      height += behind * 0.4;
      lookZ += behind * 0.7;
      if (other) lookX = focus.x * 0.75 + other.x * 0.25;
      if (flight) {
        // Pull back and up so the ball dropping in from behind is visible,
        // and lean the view toward where it is coming down.
        back += 3.5;
        height += 3.2;
        lookX = focus.x * 0.6 + ball.target.x * 0.4;
        lookZ = (focus.z + ball.target.z) / 2 - 3;
      }
      this.wantPos.set(focus.x * 0.92, height, focus.z + back);
      this.wantLook.set(lookX, 1.3, lookZ);
    }
    this.ease(dt, 5.5);
    this.finish(dt, fov, 6);
  }

  /** Slow orbit used behind the menus. */
  updateMenu(dt) {
    this.orbit += dt * 0.12;
    // On wide screens, frame the player to the right of the menu panel.
    const shift = this.camera.aspect > 1.3 ? 2.1 : 0;
    const rx = Math.cos(this.orbit) * shift;
    const rz = -Math.sin(this.orbit) * shift;
    this.wantPos.set(Math.sin(this.orbit) * 6.5 - rx, 2.4, Math.cos(this.orbit) * 6.5 - rz);
    this.wantLook.set(-rx, 1.2, -rz);
    this.ease(dt, 3);
    this.shakeAmount = 0;
    this.finish(dt, 46, 4);
  }

  ease(dt, rate) {
    const k = this.snapNext ? 1 : 1 - Math.exp(-rate * dt);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
  }

  /** Place the real camera: position, aim, lens and shake. */
  finish(dt, fov, fovRate) {
    this.fov = this.snapNext ? fov : damp(this.fov, fov, fovRate, dt);
    this.snapNext = false;
    const cam = this.camera;
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.pos);
    let lx = this.look.x;
    let ly = this.look.y;
    if (this.shakeAmount > 0.002) {
      this.shakeTime += dt;
      const a = this.shakeAmount;
      const t = this.shakeTime;
      cam.position.x += Math.sin(t * 61) * a * 0.5;
      cam.position.y += Math.sin(t * 79 + 1.3) * a;
      lx += Math.sin(t * 47 + 0.7) * a * 0.6;
      ly += Math.sin(t * 53 + 2.1) * a * 0.6;
      this.shakeAmount *= Math.exp(-9 * dt);
    } else {
      this.shakeAmount = 0;
    }
    cam.lookAt(lx, ly, this.look.z);
  }
}
