import * as THREE from 'three';

/**
 * The camera always looks downfield, so up-screen is downfield and the
 * controls never rotate. "follow" sits behind your athlete; "broadcast" is a
 * high wide angle of the whole rep.
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
  }

  /** Jump straight to the next target instead of easing (new rep, mode change). */
  cut() {
    this.snapNext = true;
  }

  update(dt, { focus, other = null, ball, mode }) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.cut();
    }
    const flight = ball && ball.state === 'flight' && ball.target;
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
  }

  ease(dt, rate) {
    const k = this.snapNext ? 1 : 1 - Math.exp(-rate * dt);
    this.snapNext = false;
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
