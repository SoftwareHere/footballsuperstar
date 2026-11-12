import { Rep } from './rep.js';
import { deriveParams } from './ratings.js';

/**
 * A game of 1-on-1s, first to `target` points.
 *
 * Whoever is on offense plays receiver. A completion is a point for the
 * receiver, an incompletion is a point for the defender, and possession
 * flips after every point.
 */
export class Match {
  constructor({ target, user, rival, rng, firstPossession = null }) {
    this.target = target;
    this.rng = rng;
    this.user = user; // { ratings, makeController(role) }
    this.rival = rival; // { ratings, makeController(role) }
    this.score = { user: 0, rival: 0 };
    this.stamina = { user: 1, rival: 1 };
    this.tossWinner = firstPossession ?? (rng.chance(0.5) ? 'user' : 'rival');
    this.possession = this.tossWinner; // who is on offense (the receiver)
    this.winner = null;
    this.history = [];
    this.rep = null;
    this.side = rng.chance(0.5) ? 1 : -1;
  }

  /** 'wr' when the user has the ball, 'db' when he is defending. */
  get userRole() {
    return this.possession === 'user' ? 'wr' : 'db';
  }

  get repNumber() {
    return this.history.length + 1;
  }

  startRep() {
    const offense = this.possession;
    const defense = offense === 'user' ? 'rival' : 'user';
    const part = (who, role) => ({
      ratings: this[who].ratings,
      controller: this[who].makeController(role, this),
      stamina: this.stamina[who],
    });
    this.rep = new Rep({ wr: part(offense, 'wr'), db: part(defense, 'db'), rng: this.rng, side: this.side });
    return this.rep;
  }

  /** Score the finished rep, flip possession, and report what happened. */
  recordResult() {
    const rep = this.rep;
    const result = rep.result;
    const offense = this.possession;
    const defense = offense === 'user' ? 'rival' : 'user';
    const scorer = result.complete ? offense : defense;
    this.score[scorer] += 1;

    // Carry fatigue into the next rep, with a breather in between.
    const tired = { [offense]: rep.wr, [defense]: rep.db };
    for (const who of ['user', 'rival']) {
      const rest = deriveParams(this[who].ratings).betweenReps;
      this.stamina[who] = Math.min(1, tired[who].stamina + rest);
    }

    const entry = { offense, scorer, userRole: this.userRole, ...result };
    this.history.push(entry);
    if (this.score[scorer] >= this.target) this.winner = scorer;
    this.possession = defense;
    this.side = -this.side;
    return entry;
  }

  /**
   * What has this player been running on offense lately? Used so the rival
   * corner adapts when the user leans on one kind of route.
   */
  tendency(who) {
    const recent = this.history.filter((h) => h.offense === who && h.category).slice(-4);
    const counts = {};
    for (const h of recent) counts[h.category] = (counts[h.category] || 0) + 1;
    let best = null;
    for (const [cat, n] of Object.entries(counts)) if (n >= 2 && (!best || n > counts[best])) best = cat;
    return best ? { expect: best, confidence: counts[best] / 4 } : { expect: null, confidence: 0 };
  }

  /** Per-role tallies for the post-game screen. */
  summary() {
    const s = { catches: 0, targets: 0, stops: 0, defended: 0, picks: 0 };
    for (const h of this.history) {
      if (h.userRole === 'wr') {
        s.targets += 1;
        if (h.complete) s.catches += 1;
      } else {
        s.defended += 1;
        if (!h.complete) s.stops += 1;
        if (h.reason === 'int') s.picks += 1;
      }
    }
    return s;
  }
}
