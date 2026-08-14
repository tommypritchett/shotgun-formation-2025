/**
 * Shotgun Formation — canonical card data.
 *
 * SINGLE SOURCE OF TRUTH for the client. Never hardcode a card name, drink
 * value, or copy count anywhere else in the app.
 *
 * ⚠️  `id` is the WIRE VALUE. It must match the strings produced by
 *     generateDecks() in server.js EXACTLY, including the awkward ones:
 *     'Sacks' (plural), 'Blocked Kicks' (plural), 'Fake Punt/FG' (no spaces
 *     around the slash). Changing an `id` breaks card matching on the server.
 *
 *     `label` is what humans see. It's allowed to differ from `id`.
 *
 * `copiesPerPlayer` mirrors server.js generateDecks(playerCount) — the deck is
 * built as `copiesPerPlayer * playerCount`. It's here so the client can display
 * rarity and so a test can assert client and server never drift apart.
 *
 * `printCopies` is the fixed count for the physical 150-card deck. It is NOT
 * used by the app.
 */

export const DECK = { STANDARD: 'standard', WILD: 'wild' };

/** 10 drinks = 1 shotgun. Mirrors the server rule in playStandardCard/assignDrinks. */
export const DRINKS_PER_SHOTGUN = 10;

/** Real round durations from server.js startTimer() calls. Do not change. */
export const ROUND_DURATIONS = { standard: 21, wild: 11, firstDown: 6 };

export const STANDARD_CARDS = [
  {
    id: 'Penalty', label: 'Penalty', deck: DECK.STANDARD, icon: 'penalty',
    drinks: 1, copiesPerPlayer: 9, printCopies: 27,
    trigger: 'Any accepted penalty flag',
  },
  {
    id: 'Sacks', label: 'Sack', deck: DECK.STANDARD, icon: 'sack',
    drinks: 2, copiesPerPlayer: 8, printCopies: 24,
    trigger: 'Quarterback tackled behind the line of scrimmage',
  },
  {
    id: 'Touchdown', label: 'Touchdown', deck: DECK.STANDARD, icon: 'touchdown',
    drinks: 3, copiesPerPlayer: 7, printCopies: 21,
    trigger: 'Any touchdown scored by either team',
  },
  {
    id: 'Field Goal', label: 'Field Goal', deck: DECK.STANDARD, icon: 'fieldgoal',
    drinks: 2, copiesPerPlayer: 6, printCopies: 18,
    trigger: 'Any successful field goal',
  },
  {
    id: 'Turnover', label: 'Turnover', deck: DECK.STANDARD, icon: 'turnover',
    drinks: 4, copiesPerPlayer: 5, printCopies: 15,
    trigger: 'Interception, or fumble recovered by the defense',
  },
];

export const WILD_CARDS = [
  {
    id: '3 n Out', label: '3 n Out', deck: DECK.WILD, icon: 'threeout',
    drinks: 4, copiesPerPlayer: 6, printCopies: 6,
    trigger: 'Offense punts after failing to gain a first down',
  },
  {
    id: 'Big Play 20+', label: 'Big Play 20+', deck: DECK.WILD, icon: 'big20',
    drinks: 5, copiesPerPlayer: 5, printCopies: 5,
    trigger: 'Any single play gaining 20 or more yards',
  },
  {
    id: 'Turnover on Downs', label: 'Turnover on Downs', deck: DECK.WILD, icon: 'turnoverdowns',
    drinks: 10, copiesPerPlayer: 5, printCopies: 5,
    trigger: 'Offense fails to convert on fourth down',
  },
  {
    id: 'Missed FG', label: 'Missed FG', deck: DECK.WILD, icon: 'missedfg',
    drinks: 5, copiesPerPlayer: 4, printCopies: 4,
    trigger: 'A field goal attempt is no good',
  },
  {
    id: 'Big Play 50+', label: 'Big Play 50+', deck: DECK.WILD, icon: 'big50',
    drinks: 10, copiesPerPlayer: 3, printCopies: 3,
    trigger: 'Any single play gaining 50 or more yards',
  },
  {
    id: 'Onside Attempt', label: 'Onside Attempt', deck: DECK.WILD, icon: 'onsidea',
    drinks: 10, copiesPerPlayer: 3, printCopies: 3,
    trigger: 'An onside kick is attempted',
  },
  {
    id: 'Fake Punt/FG', label: 'Fake Punt / FG', deck: DECK.WILD, icon: 'fake',
    drinks: 10, copiesPerPlayer: 3, printCopies: 3,
    trigger: 'A fake is run on fourth down',
  },
  {
    id: '2 PT Conversion', label: '2 PT Conversion', deck: DECK.WILD, icon: 'twopt',
    drinks: 5, copiesPerPlayer: 3, printCopies: 3,
    trigger: 'A two-point conversion is attempted',
  },
  {
    id: 'Doink', label: 'Doink', deck: DECK.WILD, icon: 'doink',
    drinks: 40, copiesPerPlayer: 2, printCopies: 2,
    trigger: 'A kick hits the upright or the crossbar',
  },
  {
    id: 'Blocked Kicks', label: 'Blocked Kick', deck: DECK.WILD, icon: 'blocked',
    drinks: 10, copiesPerPlayer: 1, printCopies: 2,
    trigger: 'Any punt, field goal, or PAT is blocked',
  },
  {
    id: 'Missed PAT', label: 'Missed PAT', deck: DECK.WILD, icon: 'missedpat',
    drinks: 6, copiesPerPlayer: 1, printCopies: 2,
    trigger: 'An extra point attempt is no good',
  },
  {
    id: 'Penalty Calls TD Back', label: 'Penalty Calls TD Back', deck: DECK.WILD, icon: 'pentdback',
    drinks: 10, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'A touchdown is negated by a penalty',
  },
  {
    id: 'Special Teams TD', label: 'Special Teams TD', deck: DECK.WILD, icon: 'sttd',
    drinks: 20, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'A punt or kick returned for a touchdown',
  },
  {
    id: 'Disqualified', label: 'Disqualified', deck: DECK.WILD, icon: 'dq',
    drinks: 20, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'A player is ejected from the game',
  },
  {
    id: 'Safety', label: 'Safety', deck: DECK.WILD, icon: 'safety',
    drinks: 20, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'Offense is tackled in its own end zone',
  },
  {
    id: 'Defensive TD', label: 'Defensive TD', deck: DECK.WILD, icon: 'deftd',
    drinks: 20, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'Defense scores — pick-six or fumble return',
  },
  {
    id: 'Onside Recovered', label: 'Onside Recovered', deck: DECK.WILD, icon: 'onsider',
    drinks: 40, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'The kicking team recovers its own onside kick',
  },
  {
    id: 'Record Broken', label: 'Record Broken', deck: DECK.WILD, icon: 'record',
    drinks: 40, copiesPerPlayer: 1, printCopies: 1,
    trigger: 'A league, franchise, or game record falls',
  },
];

/**
 * First Down is NOT a card. It's a global event the Host declares — everyone
 * drinks 1. It has no entry in either deck on the server. It's here only so the
 * UI can render it in the Declare Action list with the same visual treatment.
 */
export const FIRST_DOWN = {
  id: 'First Down', label: 'First Down', deck: null, icon: 'firstdown',
  drinks: 1, copiesPerPlayer: 0, printCopies: 1,
  trigger: 'Everyone at the table drinks once',
  isGlobalEvent: true,
};

export const ALL_CARDS = [...STANDARD_CARDS, ...WILD_CARDS];

/** What the Host sees in the Declare Action modal. Order is deliberate. */
export const DECLARABLE = [...STANDARD_CARDS, FIRST_DOWN];

const BY_ID = new Map([...ALL_CARDS, FIRST_DOWN].map((c) => [c.id, c]));

/** Look up a card by its wire value. Returns undefined for unknown ids. */
export const getCard = (id) => BY_ID.get(id);

/** How many whole shotguns a drink value represents. 40 -> 4, 6 -> 0. */
export const shotgunsFor = (drinks) => Math.floor(drinks / DRINKS_PER_SHOTGUN);

/**
 * How a card's value should be displayed. Mirrors the existing client rule:
 * values >= 10 render as shotguns, everything else as drinks.
 */
export const formatValue = (drinks) => {
  const shotguns = shotgunsFor(drinks);
  if (shotguns >= 1) {
    return { amount: shotguns, unit: shotguns === 1 ? 'Shotgun' : 'Shotguns', isShotgun: true };
  }
  return { amount: drinks, unit: drinks === 1 ? 'Drink' : 'Drinks', isShotgun: false };
};

/**
 * Colour tier for a card. Drives which accent the card renders in.
 *   'amber' — Standard deck
 *   'neon'  — Wild deck
 *   'blood' — the 4-shotgun monsters (Doink, Onside Recovered, Record Broken)
 */
export const tierFor = (card) => {
  if (card.drinks >= 40) return 'blood';
  return card.deck === DECK.WILD ? 'neon' : 'amber';
};

/** Totals, for tests that assert client and server decks agree. */
export const DECK_TOTALS = {
  standardPerPlayer: STANDARD_CARDS.reduce((n, c) => n + c.copiesPerPlayer, 0), // 35
  wildPerPlayer: WILD_CARDS.reduce((n, c) => n + c.copiesPerPlayer, 0),         // 43
};
