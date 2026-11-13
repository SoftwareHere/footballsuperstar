import { FIELD, GRAVITY, FALL, DIVE, JUMP, BALANCE, CONTACT, HANDS } from '../config.js';
import { clamp, len2, angleDelta } from '../core/vec.js';
import { deriveParams, norm } from './ratings.js';

/**
 * Intent is what a controller (keyboard or AI) wants this tick:
 *   { x, z }   desired direction (length <= 1 acts as a throttle)
 *   sprint     burn stamina for top speed
 *   jump       leave the ground and play the ball (a jump, or a dive when
 *              the ball is out of jumping reach)
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
    this.divedThisTick = false;
    this.fellThisTick = false;
    this.landedThisTick = false;
    this.stumbledThisTick = false;
    this.speedCap = 1; // set by AI for backpedalling
    this.backpedal = false;
    this.faceTarget = null; // optional { x, z } to look at instead of the run direction
    this.callTimer = 0; // hand up, asking for the ball
    this.hasBall = false;
    this.mood = null; // 'celebrate' | 'dejected' once the rep is decided

    // Leaving his feet: he loads his legs, goes up, and comes down on them.
    this.gather = 0; // seconds left loading for a jump; his feet are still on the turf
    this.jumpPlan = null; // { x, z, t } where and when the ball he is going up for arrives
    this.landing = 0; // seconds left soaking up a landing
    this.track = null; // { x, z } a live ball: he turns his body to it when he plays it
    this.squareUp = false; // on his feet, turn to the ball rather than the way he is running
    this.diving = false; // laid out for the ball
    this.diveDir = { x: 0, z: -1 };

    // Staying on them. Contact takes balance away; with none left he goes over.
    this.balance = 1;
    this.stumble = 0; // seconds left catching himself
    this.stumbleFor = 0; // how long this stumble was to start with
    this.shoveDir = { x: 0, z: 0 }; // the way the last hit pushed him
    this.sinceContact = 9;

    // Hands. Set every tick by the rep while two men are within arm's reach.
    this.hands = null; // { kind: 'jam' | 'check' | 'release', k, side }
    this.held = 0; // 0..1 how much of his footwork the other man's hands are taking away

    // Ending up on the turf.
    this.down = false; // on the turf, or getting back up; ignores his controller
    this.downTimer = 0; // seconds until he starts to get up
    this.rise = 0; // 0 lying .. 1 back on his feet
    this.fall = null; // { vx, vy, vz, high } the shove that put him down
    this.securing = false; // ball in his hands but the catch is not finished
    this.catchInfo = null; // { type, toeTap } how he caught it
    this.coast = false; // after the whistle: ease to a stop rather than slam on the brakes
  }

  get speed() {
    return len2(this.vel.x, this.vel.z);
  }

  get inBounds() {
    return Math.abs(this.pos.x) <= FIELD.halfWidth && this.pos.z >= FIELD.endZ;
  }

  /** 1 at the start of a stumble, 0 once he has his feet back. */
  get stumbling() {
    return this.stumble > 0 && this.stumbleFor > 0 ? this.stumble / this.stumbleFor : 0;
  }

  /**
   * `play` is how a jump should be taken when the ball is live: null for a
   * plain jump, { dive: false, x, z, t } to go up toward the ball arriving at
   * (x, z) in t seconds, or { dive: true, x, z, speed, air } to lay out for it.
   */
  step(intent, dt, play = null) {
    const p = this.params;
    this.jukedThisTick = 0;
    this.jumpedThisTick = false;
    this.divedThisTick = false;
    this.fellThisTick = false;
    this.landedThisTick = false;
    this.stumbledThisTick = false;
    this.jukeTimer = Math.max(0, this.jukeTimer - dt);
    this.jukeLock = Math.max(0, this.jukeLock - dt);
    this.callTimer = Math.max(0, this.callTimer - dt);
    this.stumble = Math.max(0, this.stumble - dt);
    this.landing = Math.max(0, this.landing - dt);
    this.sinceContact += dt;

    if (this.down) {
      this.stepDown(dt);
      return;
    }

    if (this.airborne) {
      this.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.y <= 0) this.land();
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToWorld();
      this.regen(dt, false);
      this.turnToBall(dt);
      return;
    }

    // Balance comes back once nobody is leaning on him.
    if (this.sinceContact > 0.2) this.balance = Math.min(1, this.balance + dt / p.balanceRecover);

    if (this.gather > 0) {
      // Legs loaded, feet still down: his momentum carries him over them.
      this.gather -= dt;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToWorld();
      this.regen(dt, false);
      this.turnToBall(dt);
      if (this.gather <= 0) this.takeOff();
      return;
    }

    this.recovery = Math.max(0, this.recovery - dt);

    if (intent.jump && this.recovery <= 0) {
      if (play && play.dive) {
        this.dive(play);
        return;
      }
      // Hands go up now; the feet leave once the legs have loaded.
      this.gather = JUMP.load;
      this.attempting = true;
      this.jumpPlan = play && Number.isFinite(play.x) ? { x: play.x, z: play.z, t: play.t } : null;
      this.jukeLock = 0;
      this.sprinting = false;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampToWorld();
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

    // A man catching his balance, or with hands on him, is not free to run.
    const stumbling = this.stumbling;
    let control = (1 - 0.6 * stumbling) * (1 - HANDS.hold * this.held);

    let maxSpeed = p.topSpeed * (this.sprinting ? 1 : p.jogFactor) * this.speedCap;
    if (this.recovery > 0) maxSpeed *= 0.6;
    maxSpeed *= 1 - 0.4 * stumbling;

    let tx = moving ? dx * maxSpeed : 0;
    let tz = moving ? dz * maxSpeed : 0;
    if (this.jukeLock > 0) {
      tx = this.jukeDir * p.jukeSpeed;
      control = Math.max(control, 0.8); // the sidestep is what gets him off the hands
    }
    this.want.x = tx;
    this.want.z = tz;

    // Building speed in the direction you're already going uses acceleration;
    // braking and cutting use the (agility-driven) cut rate.
    const cutRate = this.coast ? Math.min(p.cutRate, 7.5) : p.cutRate;
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.z;
    const dv = len2(dvx, dvz);
    if (dv > 1e-6) {
      const speed = this.speed;
      let along = 1;
      if (speed > 0.5) along = clamp((dvx * this.vel.x + dvz * this.vel.z) / (dv * speed), 0, 1);
      const rate = (cutRate + (p.accel - cutRate) * along) * control;
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

  /** The legs fire. With a ball to go and get, he pushes off toward it. */
  takeOff() {
    const p = this.params;
    this.gather = 0;
    this.airborne = true;
    this.jumpedThisTick = true;
    this.vy = Math.sqrt(2 * GRAVITY * p.jumpHeight);
    this.y = 0.001;
    const plan = this.jumpPlan;
    this.jumpPlan = null;
    if (!plan) return; // a plain jump just carries his momentum
    // Be where the ball is when it gets there, as far as one push allows.
    const hang = (2 * this.vy) / GRAVITY;
    const t = clamp(plan.t - JUMP.load, 0.15, hang);
    let ax = (plan.x - this.pos.x) / t - this.vel.x;
    let az = (plan.z - this.pos.z) / t - this.vel.z;
    const a = len2(ax, az);
    if (a > JUMP.attack) {
      ax *= JUMP.attack / a;
      az *= JUMP.attack / a;
    }
    this.vel.x += ax;
    this.vel.z += az;
    this.want.x = this.vel.x;
    this.want.z = this.vel.z;
  }

  /** Back to earth: on the turf if he dove or was hit out of the air, otherwise on his feet. */
  land() {
    const impact = -this.vy;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.attempting = false;
    this.landedThisTick = true;
    const agile = clamp(norm(this.ratings.agility), 0, 1);
    if (this.diving) {
      // A dive always ends on the turf.
      this.goDown(DIVE.downTime - 0.15 * agile, this.fall || { vx: 0, vy: -impact, vz: 0, high: false });
      return;
    }
    if (this.balance <= 0) {
      this.goDown(CONTACT.downTime, this.fall || { vx: 0, vy: -impact, vz: 0, high: false });
      return;
    }
    // He gets his feet under him. A man who was bumped up there lands heavy.
    const shaky = 1 - this.balance;
    this.landing = JUMP.landing * (1 + 1.2 * shaky);
    this.recovery = this.landing;
    this.fall = null;
    if (shaky > BALANCE.stumbleAt) this.startStumble(shaky);
  }

  /** Lay out toward (x, z): low, flat and committed. He lands on the turf. */
  dive({ x, z, speed, air = DIVE.minAir }) {
    const n = len2(x, z) || 1;
    this.diveDir = { x: x / n, z: z / n };
    this.airborne = true;
    this.attempting = true;
    this.diving = true;
    this.divedThisTick = true;
    this.gather = 0;
    this.vy = (GRAVITY * air) / 2; // just enough hang time to meet the ball
    this.y = 0.001;
    this.vel.x = this.diveDir.x * speed;
    this.vel.z = this.diveDir.z * speed;
    this.want.x = this.vel.x;
    this.want.z = this.vel.z;
    this.facing = Math.atan2(this.diveDir.x, this.diveDir.z);
    this.faceTarget = null;
    this.jukeLock = 0;
    this.sprinting = false;
    this.stamina = Math.max(0, this.stamina - 0.06);
  }

  /**
   * Take a hit. `power` is how much closing speed lands on him (yd/s) and
   * (dx, dz) the way it pushes him. A man with his feet set soaks up more
   * than one in the air. Returns 'fall' when his balance is gone, 'stumble'
   * when he is knocked off his stride but keeps his feet, otherwise null.
   * `floor` is the least balance the hit can leave him with.
   */
  hit(power, dx, dz, floor = 0) {
    this.sinceContact = 0;
    const landed = power - BALANCE.absorb;
    if (landed <= 0 || this.down) return null;
    const set = this.airborne || this.gather > 0 ? BALANCE.air : 1;
    const before = this.balance;
    this.balance = Math.max(Math.min(before, floor), before - landed / (BALANCE.capacity * this.params.poise * set));
    const n = len2(dx, dz);
    if (n > 1e-6) {
      this.shoveDir.x = dx / n;
      this.shoveDir.z = dz / n;
    }
    if (this.balance <= 0) return 'fall';
    const lost = before - this.balance;
    if (lost <= BALANCE.stumbleAt) return null;
    // In the air there is nothing to stumble on: it shows when he lands.
    if (!this.airborne) this.startStumble(1 - this.balance);
    return 'stumble';
  }

  /** Knocked off his stride: a few ragged steps to get his feet back under him. */
  startStumble(amount) {
    const [short, long] = BALANCE.stumble;
    const time = short + (long - short) * clamp(amount, 0, 1);
    if (time <= this.stumble) return;
    this.stumble = time;
    this.stumbleFor = time;
    this.stumbledThisTick = true;
    this.jukeLock = 0;
  }

  /** Put him on the turf for `seconds`, shoved by `fall` = { vx, vy, vz, high }. */
  goDown(seconds, fall) {
    this.down = true;
    this.downTimer = Math.max(this.downTimer, seconds);
    this.rise = 0;
    this.fall = fall;
    this.fellThisTick = true;
    this.attempting = false;
    this.sprinting = false;
    this.gather = 0;
    this.jumpPlan = null;
    this.landing = 0;
    this.balance = 0;
    this.stumble = 0;
    this.hands = null;
    this.held = 0;
    this.jukeLock = 0;
    this.want.x = 0;
    this.want.z = 0;
  }

  /** Knocked off his feet by a hit. In the air he keeps falling until he lands. */
  knockdown(fall, seconds) {
    this.vel.x = this.vel.x * 0.45 + fall.vx;
    this.vel.z = this.vel.z * 0.45 + fall.vz;
    if (this.airborne) {
      this.airborne = false;
      this.vy = Math.min(this.vy, 1) + fall.vy * 0.3;
    }
    this.goDown(seconds, fall);
  }

  /** On the turf: slide to a stop, lie there, then pick himself up. */
  stepDown(dt) {
    let inAir = false;
    if (this.y > 0 || this.vy > 0) {
      inAir = true;
      this.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    } else {
      const speed = this.speed;
      if (speed > 1e-6) {
        const k = Math.max(0, speed - FALL.friction * dt) / speed;
        this.vel.x *= k;
        this.vel.z *= k;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampToWorld();
    this.regen(dt, false);
    if (this.rise <= 0) {
      this.downTimer -= dt;
      // Nobody gets up while he is still sliding.
      if (this.downTimer > 0 || inAir || this.speed > FALL.settle) return;
      this.downTimer = 0;
    }
    this.vel.x = 0;
    this.vel.z = 0;
    this.rise = Math.min(1, this.rise + dt / FALL.getUp);
    if (this.rise >= 1) {
      this.down = false;
      this.diving = false;
      this.rise = 0;
      this.fall = null;
      this.balance = 1;
      this.recovery = 0.1;
    }
  }

  regen(dt, draining) {
    const p = this.params;
    if (draining) this.stamina = Math.max(0, this.stamina - dt / p.sprintSeconds);
    else this.stamina = Math.min(1, this.stamina + dt * p.staminaRegen);
  }

  /** Going up for it, he turns his whole body to the ball. */
  turnToBall(dt) {
    if (!this.track || !this.attempting || this.diving) return;
    const dx = this.track.x - this.pos.x;
    const dz = this.track.z - this.pos.z;
    if (dx * dx + dz * dz < 0.04) return; // right on top of him: no direction to turn to
    const d = angleDelta(this.facing, Math.atan2(dx, dz));
    this.facing += clamp(d, -JUMP.turnRate * dt, JUMP.turnRate * dt);
  }

  updateFacing(dt) {
    let target = null;
    let rate = 14;
    if (this.squareUp && this.track) {
      const dx = this.track.x - this.pos.x;
      const dz = this.track.z - this.pos.z;
      if (dx * dx + dz * dz > 0.04) {
        target = Math.atan2(dx, dz);
        rate = JUMP.turnRate;
      }
    } else if (this.faceTarget) {
      target = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
    } else if (this.speed > 0.6) {
      target = Math.atan2(this.vel.x, this.vel.z);
    }
    if (target === null) return;
    const d = angleDelta(this.facing, target);
    this.facing += clamp(d, -rate * dt, rate * dt);
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
