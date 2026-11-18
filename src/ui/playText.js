// What the result banner says about a rep: a headline, and a line that tells
// the play from the catch to the whistle. Pure text, no DOM, so it can be
// tested on its own.

// How the catch was made, when it was something worth shouting about.
export const CATCH_TITLES = {
  dive: 'DIVING CATCH!',
  oneHand: 'ONE-HANDED!',
  overShoulder: 'OVER THE SHOULDER!',
  juggle: 'JUGGLING CATCH!',
  low: 'SHOESTRING CATCH!',
};

// How the catch itself is described, at the start of the line.
const CATCH_WORDS = {
  dive: 'Diving catch',
  oneHand: 'One-handed catch',
  overShoulder: 'Over-the-shoulder catch',
  juggle: 'Juggling catch',
  low: 'Shoestring catch',
};

const REASON_TEXT = {
  drop: 'Dropped',
  breakup: 'Broken up at the catch',
  swat: 'Swatted away',
  ground: 'Nobody got there',
  hit: 'Jarred loose by the hit',
};

/** "the 17", "the 1", or "the end zone", from yards to the goal line. */
export function spot(yards) {
  if (yards === undefined || yards === null) return 'the spot';
  if (yards <= 0) return 'the end zone';
  return `the ${Math.max(1, Math.round(yards))}`;
}

const yardsText = (n) => {
  const r = Math.round(n);
  return `${r} yard${r === 1 ? '' : 's'}`;
};

const tackles = (n) => (n === 1 ? 'broke a tackle' : `broke ${n} tackles`);

/** The first half of the line: where and how he caught it. */
function caughtAt(e) {
  const where = e.catchYard <= 0 ? 'in the end zone' : `at ${spot(e.catchYard)}`;
  if (e.toeTap) return `Toe-tap ${where}`;
  if (e.throughContact) return `Held on through the hit ${where}`;
  return `${CATCH_WORDS[e.catchType] || 'Caught'} ${where}`;
}

/** The second half: how the run after the catch ended. */
function howItEnded(e) {
  const at = spot(e.endYard);
  const after = e.yac >= 1 ? ` (${yardsText(e.yac)} after the catch)` : '';
  switch (e.endedBy) {
    case 'endzone':
      if (e.catchYard <= 0) return '';
      if (e.stretched) return `dove across the goal line${after}`;
      return `took it ${yardsText(e.catchYard)} to the end zone`;
    case 'wrap':
      return `brought down at ${at}${after}`;
    case 'hit':
      return e.yac >= 1 ? `laid out at ${at}${after}` : 'knocked down on the spot';
    case 'dive':
      return `tripped up by a diving tackle at ${at}${after}`;
    case 'stretch':
      return `dove to ${at}${after}`;
    case 'pushed':
      return `pushed out at ${at}${after}`;
    case 'oob':
      return e.yac >= 1 ? `out of bounds at ${at}${after}` : 'and went out of bounds';
    case 'whistle':
      return `whistled dead at ${at}`;
    case 'down':
      return 'down where he landed';
    default:
      return '';
  }
}

/** The whole play, from the catch to where it ended. */
export function completionLine(e) {
  const parts = [caughtAt(e)];
  const end = howItEnded(e);
  if (end) parts.push(end);
  if (e.brokenTackles) parts.push(tackles(e.brokenTackles));
  return parts.join(', ');
}

function headline(e, offense) {
  if (e.complete) {
    if (e.touchdown) return 'TOUCHDOWN!';
    if (!offense) {
      // On defense the headline is how you stopped him.
      if (e.endedBy === 'dive') return 'DIVING TACKLE!';
      if (e.endedBy === 'hit' && e.yac >= 1) return 'BIG HIT!';
      if (e.endedBy === 'wrap') return 'TACKLED!';
      if (e.endedBy === 'pushed') return 'PUSHED OUT!';
      return 'CAUGHT';
    }
    if (e.throughContact) return 'HELD ON THROUGH THE HIT!';
    if (e.toeTap) return 'TOE-TAP!';
    return CATCH_TITLES[e.catchType] || 'COMPLETE!';
  }
  if (e.reason === 'int') return e.tips ? 'PICKED OFF THE TIP!' : 'INTERCEPTED!';
  if (e.reason === 'oob') return 'OUT OF BOUNDS';
  if (e.reason === 'hit') return 'JARRED LOOSE!';
  if (e.reason === 'swat' || e.reason === 'breakup') return offense ? 'BROKEN UP' : 'PASS BROKEN UP!';
  return 'INCOMPLETE';
}

function incompleteLine(e) {
  if (e.reason === 'int') return `Picked off at ${spot(e.pickYard)}`;
  if (e.reason === 'oob') {
    if (e.pickOob) return 'Picked off, but he came down out of bounds';
    if (e.bodyOut) return 'Landed out of bounds. No catch';
    if (e.feetOut === 1) return 'One foot came down out. No catch';
    return 'Came down out of bounds. No catch';
  }
  if (e.lostToGround) return 'Lost it going to the ground';
  if (e.tips) return 'Tipped, and nobody came down with it';
  return REASON_TEXT[e.reason] || 'Incomplete';
}

/**
 * The result banner for a finished rep (a match history entry).
 *   rival   the rival's short name, as the scoreboard shows it
 * Returns { title, detail, good } where `good` is true when it went your way.
 */
export function describePlay(e, { rival = 'RIVAL' } = {}) {
  const offense = e.userRole === 'wr';
  const mine = e.scorer === 'user';
  const who = mine ? 'YOU' : rival.toUpperCase();
  const line = e.complete ? completionLine(e) : incompleteLine(e);
  return { title: headline(e, offense), detail: `${line} · +${e.points ?? 1} ${who}`, good: mine };
}
