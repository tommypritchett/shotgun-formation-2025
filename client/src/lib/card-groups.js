/**
 * How the per-card dial is grouped on screen.
 *
 * Twenty-four switches in a list is unusable. The owner reaches for this after
 * a real game night, on a phone, while nine people wait — so the grouping is by
 * HOW OFTEN a card fires, because that is the question being asked ("this is
 * too much, what do I turn down?"), not by deck or by tier.
 *
 * Counts are from ten real games (docs/REPLAY_WATCH_REPORT.md) and are shown in
 * the UI, because "First Down, about 30 a game" answers the question far faster
 * than the card name alone.
 */

/** Mean per game across the ten fixtures. Used for grouping and for display. */
export const PER_GAME = {
  'First Down': 30,
  'Penalty': 11,
  'Big Play 20+': 11,
  'Touchdown': 5,
  'Sacks': 4,
  '3 n Out': 3,
  'Field Goal': 3,
  'Turnover': 2,
  'Big Play 50+': 1,
  'Turnover on Downs': 1,
  'Onside Attempt': 0.3,
  'Missed FG': 0.2,
  'Defensive TD': 0.2,
  'Blocked Kicks': 0.2,
  'Safety': 0.1,
  'Special Teams TD': 0.1,
  'Penalty Calls TD Back': 0.1,
  'Onside Recovered': 0.1,
  'Disqualified': 0.1,
  '2 PT Conversion': 0.1,
  'Missed PAT': 0.1,
};

export const GROUPS = [
  {
    key: 'loud',
    title: 'The volume',
    hint: 'These are most of your rounds. Turn one down and the night gets quieter.',
    cards: ['First Down', 'Big Play 20+', 'Penalty'],
  },
  {
    key: 'core',
    title: 'The moments',
    hint: 'A few a game each. This is the game most people picture.',
    cards: ['Touchdown', 'Sacks', 'Field Goal', 'Turnover', 'Big Play 50+', 'Turnover on Downs'],
  },
  {
    key: 'rare',
    title: 'Rare',
    hint: 'Once a game at most, often not at all.',
    cards: ['Safety', 'Defensive TD', 'Special Teams TD', '2 PT Conversion', 'Missed FG', 'Missed PAT'],
  },
  {
    key: 'suggest',
    title: 'Asked, not called',
    hint: 'The feed is less sure of these, so it asks the Ref first.',
    cards: ['3 n Out', 'Blocked Kicks', 'Onside Attempt', 'Onside Recovered',
      'Penalty Calls TD Back', 'Disqualified'],
  },
];

/** Cards no feed can see. Named so nobody wonders why they never fire. */
export const REF_ONLY = ['Doink', 'Record Broken', 'Fake Punt/FG'];

/** "about 30 a game" / "rare" — the phrase shown under a card name. */
export const frequencyLabel = (cardId) => {
  const n = PER_GAME[cardId];
  if (n === undefined) return '';
  if (n >= 10) return `about ${Math.round(n)} a game`;
  if (n >= 1) return `${Math.round(n)}–${Math.round(n) + 1} a game`;
  return 'rare';
};

export default { GROUPS, REF_ONLY, PER_GAME, frequencyLabel };
