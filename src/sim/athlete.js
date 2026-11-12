import { FIELD, GRAVITY } from '../config.js';
import { clamp, len2, angleDelta } from '../core/vec.js';
import { deriveParams } from './ratings.js';

/**
 * Intent is what a controller (keyboard or AI) wants this tick:
 *   { x, z }   desired direction (length <= 1 acts as a throttle)
 *   sprint     burn stamina for top speed
 *   jump       leave the ground and reach for the ball
 *   juke       -1 / +1 for a quick sidestep toward -x / +x
 */
export const NO_INTENT = Object.freeze({ x: 0, z: 0, sprint: false, jump: false, juke: 0 });

export class Athlete {
  constructor({ ratings, x = 0, z = 0, stamina = 1, facing = Math.PI }) {
    this.ratings = ratings;
    this.params = deriveParams(ratings);
    this.pos = { x, z };
    this.vel = { x: 0, z: 0 };
    this.want = { x: 0, z: 0 }; // the velocity he is trying to reach
    this.y = 0;
    this.vy = 0;
    this.facing = facing; // radians, 0 = +z, PI = downfield
    this.stamina = clamp(stamina, 0, 1);
    this.exhausted = false;
    this.sprinting = false;
    this.airborne = false;
    this.attempting = false; // hands up, playing the ball
    this.recovery = 0; // seconds of sluggishness after landing
    this.jukeTimer = 0; // cooldown
    this.jukeLock = 0; // while > 0 the sidestep carries
    this.jukeDir = 0;
    this.jukedThisTick = 0;
    this.jumpedThisTick = false;
    this.speedCap = 1; // set by AI for backpedalling
    this.backpedal = false;
    this.faceTarget = null; // optional { x, z } to look at instead of the run direction
    this.callTimer = 0; // hand up, asking for the ball
    this.hasBall = false;
    this.mood = null; // 'celebrate' | 'dejected' once the rep is decided
  }

  get speed() {
    return len2(this.vel.x, this.vel.z);
  }

  get inBounds() {
    return Math.abs(this.pos.x) <= FIELD.halfWidth && this.pos.z >= FIELD.endZ;
  }

  step(intent, dt) {
    const p = this.params;
    this.jukedThisTick = 0;
    this.jumpedThisTick = false;
    this.jukeTimer = Math.max(0, this.jukeTimer - dt);
    this.jukeLock = Math.max(0, this.jukeLock - dt);
    this.callTimer = Math.max(0, this.callTimer - dt);

    if (this.airborne) {
      this.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.attempting = false;
        this.recovery = 0.2;
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToWorld();
      this.regen(dt, false);
      return;
    }

    this.recovery = Math.max(0, this.recovery - dt);

    if (intent.jump && this.recovery <= 0) {
      this.airborne = true;
      this.attempting = true;
      this.jumpedThisTick = true;
      this.vy = Math.sqrt(2 * GRAVITY * p.jumpHeight);
      this.y = 0.001;
      // A running jump carries its momentum.
      return;
    }

    if (intent.juke && this.jukeTimer <= 0 && this.stamina > 0.08 && this.recovery <= 0) {
      this.jukeDir = Math.sign(intent.juke);
      this.jukeTimer = p.jukeCooldown;
      this.jukeLock = 0.16;
      this.jukedThisTick = this.jukeDir;
      this.vel.x = this.jukeDir * p.jukeSpeed;
      this.vel.z *= 0.82;
      this.stamina = Math.max(0, this.stamina - 0.1);
    }

    let dx = intent.x;
    let dz = intent.z;
    let throttle = len2(dx, dz);
    if (throttle > 1) {
      dx /= throttle;
      dz /= throttle;
      throttle = 1;
    }
    const moving = throttle > 0.05;

    if (this.stamina <= 0) this.exhausted = true;
    else if (this.stamina > 0.25) this.exhausted = false;
    this.sprinting = Boolean(intent.sprint) && moving && !this.exhausted;

    let maxSpeed = p.topSpeed * (this.sprinting ? 1 : p.jogFactor) * this.speedCap;
    if (this.recovery > 0) maxSpeed *= 0.6;

    let tx = moving ? dx * maxSpeed : 0;
    let tz = moving ? dz * maxSpeed : 0;
    if (this.jukeLock > 0) tx = this.jukeDir * p.jukeSpeed;
    this.want.x = tx;
    this.want.z = tz;

    // Building speed in the direction you're already going uses acceleration;
    // braking and cutting use the (agility-driven) cut rate.
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.z;
    const dv = len2(dvx, dvz);
    if (dv > 1e-6) {
      const speed = this.speed;
      let along = 1;
      if (speed > 0.5) along = clamp((dvx * this.vel.x + dvz * this.vel.z) / (dv * speed), 0, 1);
      const rate = p.cutRate + (p.accel - p.cutRate) * along;
      const stepLen = Math.min(dv, rate * dt);
      this.vel.x += (dvx / dv) * stepLen;
      this.vel.z += (dvz / dv) * stepLen;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampToWorld();
    this.regen(dt, this.sprinting && this.speed > 1);
    this.updateFacing(dt);
  }

  regen(dt, draining) {
    const p = this.params;
    if (draining) this.stamina = Math.max(0, this.stamina - dt / p.sprintSeconds);
    else this.stamina = Math.min(1, this.stamina + dt * p.staminaRegen);
  }

  updateFacing(dt) {
    let target = null;
    if (this.faceTarget) {
      target = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
    } else if (this.speed > 0.6) {
      target = Math.atan2(this.vel.x, this.vel.z);
    }
    if (target === null) return;
    const d = angleDelta(this.facing, target);
    this.facing += clamp(d, -14 * dt, 14 * dt);
  }

  clampToWorld() {
    const maxX = FIELD.halfWidth + FIELD.oobMargin;
    if (this.pos.x > maxX) {
      this.pos.x = maxX;
      this.vel.x = Math.min(0, this.vel.x);
    } else if (this.pos.x < -maxX) {
      this.pos.x = -maxX;
      this.vel.x = Math.max(0, this.vel.x);
    }
    const minZ = FIELD.endZ - FIELD.oobMargin;
    if (this.pos.z < minZ) {
      this.pos.z = minZ;
      this.vel.z = Math.max(0, this.vel.z);
    } else if (this.pos.z > FIELD.backZ - 1) {
      this.pos.z = FIELD.backZ - 1;
      this.vel.z = Math.min(0, this.vel.z);
    }
  }
}
