import * as THREE from 'three';

/** The football, plus a soft shadow blob so its position reads in the air. */
export class BallModel {
  constructor() {
    this.group = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x7a3f1d, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.6 });
    this.spinner = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), leather);
    body.scale.set(1, 1, 1.65);
    body.castShadow = true;
    this.spinner.add(body);
    for (const z of [-0.105, 0.105]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.011, 6, 16), white);
      stripe.position.z = z;
      this.spinner.add(stripe);
    }
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.11), white);
    laces.position.y = 0.105;
    this.spinner.add(laces);
    this.group.add(this.spinner);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.look = new THREE.Vector3();
  }

  update(dt, ball) {
    this.group.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
    const moving = ball.state === 'flight' || ball.state === 'loose';
    if (moving) {
      const v = ball.vel;
      if (Math.hypot(v.x, v.y, v.z) > 0.5) {
        this.look.set(ball.pos.x + v.x, ball.pos.y + v.y, ball.pos.z + v.z);
        this.group.lookAt(this.look);
      }
      this.spinner.rotation.z += dt * (ball.state === 'flight' ? 28 : 9);
    }
    this.shadow.visible = moving;
    this.shadow.position.set(ball.pos.x, 0.02, ball.pos.z);
    const k = 1 + ball.pos.y * 0.12;
    this.shadow.scale.set(k, k, k);
    this.shadow.material.opacity = Math.max(0.08, 0.38 - ball.pos.y * 0.025);
  }
}
