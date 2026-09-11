/**
 * The "Follow a game" walkthrough — every beat, every word, every timing.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * The demo is a PURE CLIENT-SIDE SCRIPT. No socket, no server, no ESPN poll,
 * no fixture file, no bot players joining a real room. It runs on a Tuesday in
 * July with the server asleep, and it runs identically on every take — which
 * is the whole point, because it gets screen-recorded and re-recorded.
 *
 * Everything that decides what the viewer sees lives HERE, so the sequence can
 * be re-cut without touching a component.
 *
 * ── Two rules that are not style preferences ─────────────────────────────
 *
 * 1. **No drink value is ever written down in this file.** Beats name a CARD
 *    ID and a number of copies; the renderer looks the value up in
 *    `data/cards.js` and does the arithmetic. If this file said "Touchdown, 6
 *    drinks" it could drift from the real game, and a wrong number in a
 *    marketing asset is a lie about the product. The one place numbers do
 *    appear is a pour SPLIT (4 and 2), and `tests/ui/demo-script.test.jsx`
 *    asserts every split sums to exactly what the card is worth.
 *
 * 2. **No real teams.** Every club and city below is invented. The live app
 *    reading a real scoreboard for a game you are watching is one thing; a
 *    promotional asset that gets cut into videos and pasted into DMs is a
 *    different thing, and it carries nobody else's marks. The letters "NFL" do
 *    not appear anywhere on this route, and a test enforces both.
 *
 * ── Randomness ───────────────────────────────────────────────────────────
 *
 * None. Not one call to Math.random or Date.now. Same run, every time.
 */

/**
 * The slate the picker shows. All invented — see rule 2 above.
 * `at` is the away side, `home` the home side, exactly as a real slate reads.
 */
export const SLATE = [
  {
    id: 'g1', away: { code: 'LKS', name: 'Lakeshore', score: 14 },
    home: { code: 'FTV', name: 'Fort Vale', score: 10 },
    state: 'in', detail: 'Q2 8:41',
  },
  {
    id: 'g2', away: { code: 'GRB', name: 'Granite Bay', score: 21 },
    home: { code: 'KRW', name: 'Kestrel Ridge', score: 24 },
    state: 'in', detail: 'Q3 2:07',
  },
  {
    id: 'g3', away: { code: 'CHF', name: 'Copperhead Flats', score: 3 },
    home: { code: 'MCD', name: 'Marrow Creek', score: 6 },
    state: 'in', detail: 'Q2 0:58',
  },
  {
    id: 'g4', away: { code: 'TDW', name: 'Tidewater', score: 0 },
    home: { code: 'PCF', name: 'Pinecrest', score: 0 },
    state: 'pre', detail: '4:25 PM',
  },
  {
    id: 'g5', away: { code: 'ALP', name: 'Alder Point', score: 0 },
    home: { code: 'SDH', name: 'Sandhollow', score: 0 },
    state: 'pre', detail: '4:25 PM',
  },
  {
    id: 'g6', away: { code: 'BRW', name: 'Bramblewood', score: 17 },
    home: { code: 'VDG', name: 'Verdigris', score: 31 },
    state: 'post', detail: 'Final',
  },
  {
    id: 'g7', away: { code: 'HSQ', name: 'Halcyon Springs', score: 28 },
    home: { code: 'NGL', name: 'Northgate', score: 27 },
    state: 'post', detail: 'Final',
  },
  {
    id: 'g8', away: { code: 'EMF', name: 'Ember Flats', score: 0 },
    home: { code: 'SMW', name: 'Saltmarsh', score: 0 },
    state: 'pre', detail: '8:20 PM',
  },
];

/** The game the demo follows. Must be one of SLATE. */
export const FOLLOWED_ID = 'g1';

/**
 * Three players, fixed. Player 1 holds the whistle.
 *
 * Avatars are assigned by `lib/avatars.assignAvatars`, which is deterministic
 * by name — so these three are the same characters in every recording, without
 * this file having to name a character.
 */
export const PLAYERS = [
  { id: 'p1', name: 'Tommy', isRef: true },
  { id: 'p2', name: 'Dylan', isRef: false },
  { id: 'p3', name: 'Marcus', isRef: false },
];

/**
 * Opening hands: 5 Standard + 2 Wild each, matching a real deal.
 *
 * These are CARD IDS from data/cards.js — `Sacks` plural, `Fake Punt/FG` with
 * no spaces. A typo here fails silently in the real game, so the test suite
 * checks every id in this file exists.
 *
 * The hands are built around the beats: Marcus holds the Sack (beat 3), Dylan
 * holds two Touchdowns (beat 5), Tommy holds the Turnover (beat 7), and Marcus
 * holds the 20-value Wild that is the climax (beat 8).
 */
export const HANDS = {
  Tommy: {
    // TWO Turnovers on purpose: 2 x 4 = 8, and with Marcus's single Turnover
    // pouring 2 more onto the same player that round totals exactly 10 —
    // which is what makes the round results fold it into one shotgun. See
    // the `turnover` beat.
    standard: ['Turnover', 'Turnover', 'Field Goal', 'Penalty', 'Sacks'],
    wild: ['Big Play 20+', 'Blocked Kicks'],
  },
  Dylan: {
    standard: ['Touchdown', 'Touchdown', 'Penalty', 'Field Goal', 'Sacks'],
    wild: ['3 n Out', 'Missed FG'],
  },
  Marcus: {
    standard: ['Sacks', 'Penalty', 'Touchdown', 'Field Goal', 'Turnover'],
    wild: ['Safety', 'Big Play 50+'],
  },
};

/**
 * Between the beats below the demo plays every Standard card in the deck —
 * Penalty, Sacks, Touchdown, Field Goal and Turnover — a First Down, and three
 * different Wilds at three different values (4, 5 and 20). That range is the
 * point: one card teaches the loop, the spread teaches the deck.
 */

/** The Wild card at the climax. 20 drinks, which the card face renders as 2 shotguns. */
export const CLIMAX_CARD = 'Safety';

/**
 * The beats, in order.
 *
 * Each beat is addressable: the controls step one beat at a time and `?beat=8`
 * deep-links the shotgun moment, so these ten are the units and must stay ten.
 * Detail WITHIN a beat is scheduled by `at` offsets on feed lines, which is how
 * pours land one at a time without splitting a beat in two.
 *
 * `ms` is the beat's length at 1x. Total is asserted by the test suite to sit
 * in the 100–130s target.
 *
 * `set` is merged into the stage state when the beat opens. Anything absent is
 * left alone, so stepping backwards can rebuild state by replaying from beat 1.
 *
 * Feed line kinds:
 *   'event'  — what happened in the football game
 *   'holder' — who holds the card; the VALUE IS COMPUTED from cards.js
 *   'pour'   — one player pouring on another
 *   'note'   — plain commentary
 */
/**
 * Every round beat runs in two halves:
 *
 *   1. the round — EVERY holder pours their whole pool, then locks in
 *   2. `resultsAt` — the board flips to Round Results for RESULTS_MS
 *
 * Both halves matter. A demo where one person pours and the others watch
 * misrepresents the game; a demo that cuts before the results never shows the
 * ten-drinks-is-one-shotgun fold, which is the rule the game is named after.
 */
export const RESULTS_MS = 3000;

export const BEATS = [
  {
    n: 1, id: 'pick', ms: 6500,
    caption: "Pick the game you're watching.",
    set: { screen: 'picker', pickedId: null },
    feed: [], pickAt: 3800,
  },
  {
    n: 2, id: 'deal', ms: 5000,
    caption: 'Everyone gets a hand: five Standard, two Wild.',
    set: { screen: 'board', declared: null, scoreDetail: 'Q2 8:41' },
    feed: [{ at: 200, kind: 'note', text: 'Following: Lakeshore @ Fort Vale' }],
  },

  // Every one of the three holds a Sack, so all three pour.
  {
    n: 3, id: 'sack', ms: 12500, resultsAt: 9500,
    caption: 'The app watches the game and calls the card for you.',
    caption2: 'It holds each call a few seconds, so it never announces a play before you see it.',
    set: {
      declared: { cardId: 'Sacks', holder: 'Marcus', copies: 1 },
      scoreDetail: 'Q2 8:12', round: { seconds: 21 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'SACK — Fort Vale' },
      { at: 1400, kind: 'note', text: 'All three are holding a Sack' },
      { at: 6800, kind: 'note', text: 'Everyone locks in' },
    ],
    pours: [
      { at: 3000, from: 'Tommy', to: 'Dylan', n: 2 },
      { at: 4200, from: 'Dylan', to: 'Marcus', n: 2 },
      { at: 5400, from: 'Marcus', to: 'Tommy', n: 2 },
    ],
    lockAt: 6800,
  },

  {
    n: 4, id: 'firstdown', ms: 8000, resultsAt: 5000,
    caption: 'Not everything is a card. A first down is everyone, once.',
    set: {
      declared: { cardId: null, globalEvent: 'First Down', holder: null, copies: 0 },
      scoreDetail: 'Q2 7:30', round: { seconds: 6 },
    },
    feed: [{ at: 200, kind: 'event', text: 'FIRST DOWN — everyone drinks 1' }],
    everyone: 1,
  },

  {
    n: 5, id: 'touchdown', ms: 13000, resultsAt: 10000,
    caption: 'Holding two copies? It counts twice — and you choose who drinks.',
    set: {
      declared: { cardId: 'Touchdown', holder: 'Dylan', copies: 2 },
      score: { away: 21, home: 10 }, scoreDetail: 'Q2 6:04', round: { seconds: 21 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'TOUCHDOWN — Lakeshore' },
      { at: 1400, kind: 'note', text: 'Dylan holds two, Marcus holds one' },
      { at: 7600, kind: 'note', text: 'Both lock in' },
    ],
    pours: [
      { at: 2800, from: 'Dylan', to: 'Tommy', n: 4 },
      { at: 4200, from: 'Dylan', to: 'Marcus', n: 2 },
      { at: 5800, from: 'Marcus', to: 'Tommy', n: 3 },
    ],
    lockAt: 7600,
  },

  {
    n: 6, id: 'fieldgoal', ms: 11500, resultsAt: 8500,
    caption: null,
    set: {
      declared: { cardId: 'Field Goal', holder: 'Tommy', copies: 1 },
      score: { away: 21, home: 13 }, scoreDetail: 'Q2 4:52', round: { seconds: 21 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'FIELD GOAL — Fort Vale' },
      { at: 6200, kind: 'note', text: 'Everyone locks in' },
    ],
    pours: [
      { at: 2400, from: 'Tommy', to: 'Marcus', n: 2 },
      { at: 3600, from: 'Dylan', to: 'Marcus', n: 2 },
      { at: 4800, from: 'Marcus', to: 'Dylan', n: 2 },
    ],
    lockAt: 6200,
  },

  {
    n: 7, id: 'penalty', ms: 10500, resultsAt: 7500,
    caption: null,
    set: {
      declared: { cardId: 'Penalty', holder: 'Marcus', copies: 1 },
      scoreDetail: 'Q2 4:05', round: { seconds: 21 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'PENALTY — holding, Lakeshore' },
      { at: 5400, kind: 'note', text: 'Everyone locks in' },
    ],
    pours: [
      { at: 2200, from: 'Tommy', to: 'Dylan', n: 1 },
      { at: 3200, from: 'Dylan', to: 'Marcus', n: 1 },
      { at: 4200, from: 'Marcus', to: 'Tommy', n: 1 },
    ],
    lockAt: 5400,
  },

  // ── the fold: Dylan takes 8 + 2 = 10 in one round, and the results
  //    turn that into a single shotgun. This is the rule the game is
  //    named after, so it gets its own beat and a caption.
  {
    n: 8, id: 'turnover', ms: 14500, resultsAt: 11000,
    caption: 'Ten drinks in a round is a shotgun. Watch the results.',
    set: {
      declared: { cardId: 'Turnover', holder: 'Tommy', copies: 2 },
      scoreDetail: 'Q2 3:19', round: { seconds: 21 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'TURNOVER — interception' },
      { at: 1400, kind: 'note', text: 'Tommy holds two Turnovers — eight drinks' },
      { at: 8600, kind: 'note', text: "That is ten on Dylan — it becomes a shotgun" },
    ],
    pours: [
      { at: 3000, from: 'Tommy', to: 'Dylan', n: 8 },
      { at: 5600, from: 'Marcus', to: 'Dylan', n: 2 },
      { at: 7000, from: 'Marcus', to: 'Tommy', n: 2 },
    ],
    lockAt: 8600,
  },

  {
    n: 9, id: 'wild-bigplay', ms: 10500, resultsAt: 7500,
    caption: 'Wild cards are green, and worth more.',
    set: {
      declared: { cardId: 'Big Play 20+', holder: 'Tommy', copies: 1, wild: true },
      scoreDetail: 'Q2 2:40', round: { seconds: 11 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'BIG PLAY — 34 yards, Lakeshore' },
      { at: 5400, kind: 'note', text: 'Tommy locks in' },
    ],
    pours: [{ at: 2600, from: 'Tommy', to: 'Marcus', n: 5 }],
    lockAt: 5400,
  },

  {
    n: 10, id: 'wild-3nout', ms: 10000, resultsAt: 7000,
    caption: null,
    set: {
      declared: { cardId: '3 n Out', holder: 'Dylan', copies: 1, wild: true },
      scoreDetail: 'Q2 2:02', round: { seconds: 11 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'THREE AND OUT — Fort Vale punts' },
      { at: 5000, kind: 'note', text: 'Dylan locks in' },
    ],
    pours: [{ at: 2400, from: 'Dylan', to: 'Tommy', n: 4 }],
    lockAt: 5000,
  },

  {
    n: 11, id: 'shotgun', ms: 14000, resultsAt: 11000,
    caption: 'A Wild worth twenty is two shotguns on its own.',
    set: {
      declared: { cardId: CLIMAX_CARD, holder: 'Marcus', copies: 1, wild: true },
      scoreDetail: 'Q2 1:44', round: { seconds: 11 },
    },
    feed: [
      { at: 200, kind: 'event', text: 'SAFETY — Fort Vale' },
      { at: 1600, kind: 'note', text: 'Marcus plays a Wild — the Ref confirms it' },
      { at: 7600, kind: 'note', text: 'Marcus locks in' },
    ],
    pours: [{ at: 4600, from: 'Marcus', to: 'Dylan', n: 2, shotgun: true }],
    lockAt: 7600,
  },

  {
    n: 12, id: 'standings', ms: 6500,
    caption: "There's a running score. It is a competition.",
    set: { declared: null, showStandings: true, scoreDetail: 'Q2 0:31', boardTab: 'stand' },
    feed: [{ at: 300, kind: 'note', text: 'Standings after the quarter' }],
  },
  {
    n: 13, id: 'end', ms: 7000,
    caption: null,
    set: { screen: 'end', showStandings: false },
    feed: [],
  },
];

/** The end card. Copy lives here so it can be re-cut with the rest. */
export const END_CARD = {
  title: 'Shotgun Formation',
  line: 'Play it free with your friends.',
  url: 'shotgunformation.com',
  sub: 'Physical deck coming soon.',
  cta: 'Play it now',
};

/** Total runtime at 1x, in ms. Pinned by the test suite. */
export const TOTAL_MS = BEATS.reduce((n, b) => n + b.ms, 0);

export default { SLATE, FOLLOWED_ID, PLAYERS, HANDS, BEATS, END_CARD, TOTAL_MS, CLIMAX_CARD };
