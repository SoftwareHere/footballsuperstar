import { GRAVITY, CATCH_HEIGHT, TIP } from '../config.js';

/** The football: held by the QB, in flight, caught, or loose after a deflection. */
export class Ball {
  constructor(x, y, z) {
    this.state = 'held'; // 'held' | 'flight' | 'caught' | 'loose' | 'dead'
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.target = null; // where it comes down to catch height
    this.flightTime = 0;
    this.tFlight = 0;
    this.holder = null;
    this.tips = 0; // times it has come off somebody's hands and stayed alive
  }

  /** Seconds until the ball reaches its target point. */
  get eta() {
    return this.flightTime - this.tFlight;
  }

  throwTo(from, target, flightTime) {
    this.state = 'flight';
    this.pos = { x: from.x, y: from.y, z: from.z };
    this.target = { ...target };
    this.flightTime = flightTime;
    this.tFlight = 0;
    this.vel = {
      x: (target.x - from.x) / flightTime,
      z: (target.z - from.z) / flightTime,
      y: (target.y - from.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
    };
  }

  /**
   * When and where the ball next comes down through height `h`.
   * Returns { t, x, z } with t in seconds from now, or null if it never does.
   */
  whenAt(h) {
    const vy = this.vel.y;
    const disc = vy * vy + 2 * GRAVITY * (this.pos.y - h);
    if (disc < 0) return null;
    const t = (vy + Math.sqrt(disc)) / GRAVITY;
    if (t < 0) return null;
    return { t, x: this.pos.x + this.vel.x * t, z: this.pos.z + this.vel.z * t };
  }

  /**
   * The ball comes off somebody's hands and pops up, still alive. It is a
   * fresh (short) flight: the target and clock are solved again so everything
   * that tracks a pass tracks the tip too.
   */
  tip(rng) {
    this.tips += 1;
    this.state = 'flight';
    this.holder = null;
    this.vel.x = this.vel.x * TIP.keep + rng.range(-TIP.scatter, TIP.scatter);
    this.vel.z = this.vel.z * TIP.keep + rng.range(-TIP.scatter, TIP.scatter);
    this.vel.y = rng.range(TIP.pop[0], TIP.pop[1]);
    const h = Math.min(CATCH_HEIGHT, this.pos.y);
    const land = this.whenAt(h);
    this.target = { x: land.x, y: h, z: land.z };
    this.flightTime = land.t;
    this.tFlight = 0;
  }

  /** Knock the ball off course (drop or swat). It can no longer be caught. */
  deflect(rng, energy = 1) {
    this.state = 'loose';
    this.holder = null;
    this.vel.x = this.vel.x * 0.2 + rng.range(-3, 3) * energy;
    this.vel.z = this.vel.z * 0.2 + rng.range(-3, 3) * energy;
    this.vel.y = rng.range(1, 4) * energy;
  }

  attachTo(athlete) {
    this.state = 'caught';
    this.holder = athlete;
  }

  /** Advance the ball. Returns true on the tick a live pass hits the ground. */
  step(dt) {
    if (this.state === 'caught' && this.holder) {
      const h = this.holder;
      this.pos.x = h.pos.x + Math.sin(h.facing) * 0.25;
      this.pos.z = h.pos.z + Math.cos(h.facing) * 0.25;
      this.pos.y = h.y + (h.down ? 0.35 : 1.25);
      return false;
    }
    if (this.state !== 'flight' && this.state !== 'loose') return false;
    this.tFlight += dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.y -= GRAVITY * dt;
    if (this.pos.y <= 0.12) {
      this.pos.y = 0.12;
      const wasLive = this.state === 'flight';
      if (Math.abs(this.vel.y) > 2.5) {
        this.vel.y = -this.vel.y * 0.35;
        this.vel.x *= 0.5;
        this.vel.z *= 0.5;
        this.state = 'loose';
      } else {
        this.vel = { x: 0, y: 0, z: 0 };
        this.state = 'dead';
      }
      return wasLive;
    }
    return false;
  }
}
