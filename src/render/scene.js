import * as THREE from 'three';
import { QB } from '../config.js';
import { createField, skyTexture } from './field.js';
import { AthleteModel } from './athleteModel.js';
import { BallModel } from './ballModel.js';
import { Markers } from './markers.js';
import { CameraRig } from './cameraRig.js';

export const USER_COLORS = { jersey: 0x1e6bff, trim: 0xffffff, helmet: 0xf4f6fa, pants: 0xf4f6fa };
const QB_COLORS = { jersey: 0xff7a1a, trim: 0x1b1b1f, helmet: 0xe9e9ee, pants: 0x2b2f36, skin: 0xc68c5a };

/** Everything Three.js: owns the renderer and mirrors the simulation each frame. */
export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xc4def2, 110, 320);

    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x2f6b3a, 1.25));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);

    scene.add(createField());

    this.userModel = new AthleteModel(USER_COLORS, 1);
    this.rivalModel = new AthleteModel({ jersey: 0xc8102e, trim: 0xffffff, helmet: 0x222222, pants: 0x222222, skin: 0x6b4226 }, 2);
    this.qbModel = new AthleteModel(QB_COLORS, 12);
    this.ball = new BallModel();
    this.markers = new Markers();
    scene.add(this.userModel.group, this.rivalModel.group, this.qbModel.group, this.ball.group, this.ball.shadow, this.markers.group);

    this.rig = new CameraRig(1);
    this.focus = { x: 0, z: 0 };
    this.tmp = new THREE.Vector3();
    this.throwClock = 0;
    this.resize();
  }

  setRival(rival) {
    this.rivalModel.setLook({ skin: 0x6b4226, ...rival.colors }, rival.number);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  lightOn(x, z) {
    this.sun.position.set(x + 22, 48, z + 20);
    this.sun.target.position.set(x, 0, z);
  }

  athleteState(a, crouch) {
    return {
      x: a.pos.x,
      y: a.y,
      z: a.pos.z,
      facing: a.facing,
      speed: a.speed,
      backpedal: a.backpedal,
      airborne: a.airborne,
      attempting: a.attempting,
      calling: a.callTimer > 0,
      hasBall: a.hasBall,
      mood: a.mood,
      crouch,
      throwing: null,
    };
  }

  /** Mirror a live rep. `userRole` is 'wr' or 'db'. */
  syncRep(dt, rep, userRole, cameraMode) {
    const user = userRole === 'wr' ? rep.wr : rep.db;
    const rival = userRole === 'wr' ? rep.db : rep.wr;
    const pre = rep.phase === 'presnap';
    for (const m of [this.rivalModel, this.qbModel]) m.group.visible = true;
    this.ball.group.visible = true;
    this.markers.group.visible = true;

    this.userModel.update(dt, this.athleteState(user, pre));
    this.rivalModel.update(dt, this.athleteState(rival, pre));

    const qb = rep.qb;
    if (qb.state === 'thrown') this.throwClock += dt;
    else this.throwClock = 0;
    this.qbModel.update(dt, {
      x: qb.pos.x,
      y: 0,
      z: qb.pos.z,
      facing: qb.facing,
      speed: qb.state === 'drop' && rep.t < QB.dropTime ? 3 : 0,
      backpedal: true,
      crouch: pre,
      throwing: qb.state === 'windup' ? qb.windupT / QB.windup : qb.state === 'thrown' && this.throwClock < 0.45 ? 1 : null,
    });

    this.ball.update(dt, rep.ball);
    this.markers.update(dt, { user, rival, ball: rep.ball });
    this.focus.x = user.pos.x;
    this.focus.z = user.pos.z;
    this.lightOn(user.pos.x, user.pos.z);
    this.rig.update(dt, {
      focus: this.focus,
      other: userRole === 'db' && rep.phase !== 'done' ? rival.pos : null,
      ball: rep.ball,
      mode: cameraMode,
    });
  }

  /** Behind the menus: just your player on the field, camera drifting around. */
  syncMenu(dt) {
    this.rivalModel.group.visible = false;
    this.qbModel.group.visible = false;
    this.ball.group.visible = false;
    this.ball.shadow.visible = false;
    this.markers.group.visible = false;
    this.userModel.update(dt, { x: 0, y: 0, z: 0, facing: this.rig.orbit + 0.6, speed: 0 });
    this.lightOn(0, 0);
    this.rig.updateMenu(dt);
  }

  /** Screen position (0..1) of a world point, and whether it is in view. */
  project(pos) {
    const v = this.tmp.set(pos.x, pos.y, pos.z).project(this.rig.camera);
    const behind = v.z > 1;
    let x = v.x;
    let y = v.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const visible = !behind && Math.abs(x) < 0.96 && Math.abs(y) < 0.94;
    return { x: (x + 1) / 2, y: (1 - y) / 2, visible, behind };
  }

  render() {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
