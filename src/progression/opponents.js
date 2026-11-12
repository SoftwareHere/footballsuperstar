// The rival ladder. All names are fictional.
// Beat a rival to unlock the next one; earlier rivals can be replayed.

const r = (speed, acceleration, agility, hands, jumping, strength, stamina) => ({
  speed,
  acceleration,
  agility,
  hands,
  jumping,
  strength,
  stamina,
});

export const RIVALS = [
  {
    id: 'tuttle',
    name: 'Benny Tuttle',
    nick: 'Slow Feet',
    title: 'JV Walk-on',
    scout: 'Tries hard. Runs like he is carrying the water cooler.',
    ratings: r(45, 47, 46, 53, 50, 52, 50),
    number: 38,
    colors: { jersey: 0x8a8f98, trim: 0x2b2f36, helmet: 0xd9dde3, pants: 0x2b2f36 },
  },
  {
    id: 'hale',
    name: 'Marcus Hale',
    nick: 'Scout Team',
    title: 'Scout Team Corner',
    scout: 'Sound, nothing special. Punish him with speed.',
    ratings: r(56, 56, 55, 55, 56, 56, 58),
    number: 27,
    colors: { jersey: 0x2e8b57, trim: 0xf2f2f2, helmet: 0x1d5c3a, pants: 0xf2f2f2 },
  },
  {
    id: 'valmont',
    name: 'Tre Valmont',
    nick: 'Quick Twitch',
    title: 'Varsity Starter',
    scout: 'Jumpy feet and fast reactions, but he gets pushed around.',
    ratings: r(63, 66, 70, 60, 60, 52, 62),
    number: 4,
    colors: { jersey: 0xf2a100, trim: 0x111111, helmet: 0x111111, pants: 0x111111 },
  },
  {
    id: 'renner',
    name: 'Kofi Renner',
    nick: 'The Vice',
    title: 'All-Conference',
    scout: 'Big, strong, wins every jump ball. Not a burner.',
    ratings: r(65, 66, 64, 72, 80, 82, 68),
    number: 21,
    colors: { jersey: 0x6a1bb1, trim: 0xf5d547, helmet: 0xf5d547, pants: 0x3c0f66 },
  },
  {
    id: 'vance',
    name: 'Dario Vance',
    nick: 'Lockdown',
    title: 'College Standout',
    scout: 'Mirrors everything and has receiver hands.',
    ratings: r(74, 75, 82, 80, 72, 68, 74),
    number: 2,
    colors: { jersey: 0xc8102e, trim: 0xffffff, helmet: 0xffffff, pants: 0xc8102e },
  },
  {
    id: 'marlowe',
    name: 'Zeke Marlowe',
    nick: 'Jet',
    title: 'Pro Rookie',
    scout: 'Track speed. You will not simply outrun him.',
    ratings: r(90, 88, 78, 74, 78, 70, 82),
    number: 11,
    colors: { jersey: 0x00a3ad, trim: 0x0b1f2a, helmet: 0x0b1f2a, pants: 0xe8eef0 },
  },
  {
    id: 'crowe',
    name: 'Isaiah Crowe',
    nick: 'The Island',
    title: 'Pro Bowler',
    scout: 'No weakness to attack. Earn every inch.',
    ratings: r(88, 87, 88, 86, 85, 84, 86),
    number: 24,
    colors: { jersey: 0x101014, trim: 0xd4af37, helmet: 0xd4af37, pants: 0x101014 },
  },
  {
    id: 'kane',
    name: 'Cyrus Kane',
    nick: 'The Eraser',
    title: 'All-Pro Legend',
    scout: 'The best there is. Bring everything you have.',
    ratings: r(95, 94, 95, 93, 92, 90, 94),
    number: 1,
    colors: { jersey: 0xf4f4f6, trim: 0xb00020, helmet: 0xb00020, pants: 0xf4f4f6 },
  },
];

export const tierOf = (rival) => RIVALS.indexOf(rival) + 1;
export const rivalByTier = (tier) => RIVALS[Math.max(1, Math.min(RIVALS.length, tier)) - 1];
