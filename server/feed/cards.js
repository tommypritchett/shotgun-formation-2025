/**
 * Which cards a machine may call, and how.
 *
 * The ids here MUST match `client/src/data/cards.js` exactly — `Sacks` plural,
 * `Blocked Kicks` plural, `Fake Punt/FG` with no spaces. They are the wire
 * value; a mismatch fails silently, which is the worst way for this to break.
 * `tests/detector-cards.test.js` pins every id against that file.
 */

/** Fires on its own. Structured data, high confidence. */
const AUTO = 'auto';
/** Offered to the Ref with a countdown. Derived, medium confidence. */
const SUGGEST = 'suggest';
/** Never machine-called. No structured signal exists. */
const NEVER = 'never';

/**
 * Ordering for a play that legitimately produces more than one card.
 *
 * They queue and run sequentially through the normal single-round path, so if
 * the queue goes stale and drops something, what is lost must be the smaller
 * event. Lower number = fires first = survives.
 */
const PRIORITY = {
  'Touchdown': 10,
  'Defensive TD': 10,
  'Special Teams TD': 10,
  'Safety': 15,
  'Turnover': 20,
  'Turnover on Downs': 20,
  '2 PT Conversion': 25,
  'Field Goal': 30,
  'Missed FG': 30,
  'Missed PAT': 30,
  'Blocked Kicks': 35,
  'Onside Recovered': 35,
  'Onside Attempt': 40,
  'Fake Punt/FG': 40,
  'Penalty Calls TD Back': 45,
  'Big Play 50+': 50,
  'Big Play 20+': 55,
  'Sacks': 60,
  '3 n Out': 65,
  'Disqualified': 70,
  'Penalty': 80,
  'First Down': 90,
};

const MODES = {
  // Tier A — auto-called. First Down and Penalty included by owner decision:
  // they are the volume that keeps a dull game alive.
  'Touchdown': AUTO,
  'Field Goal': AUTO,
  'Sacks': AUTO,
  'Turnover': AUTO,
  'Safety': AUTO,
  '2 PT Conversion': AUTO,
  'Missed FG': AUTO,
  'Missed PAT': AUTO,
  'Turnover on Downs': AUTO,
  'Defensive TD': AUTO,
  'Special Teams TD': AUTO,
  'Big Play 20+': AUTO,
  'Big Play 50+': AUTO,
  'First Down': AUTO,
  'Penalty': AUTO,

  // Tier B — suggested to the Ref, never fired alone.
  '3 n Out': SUGGEST,
  'Blocked Kicks': SUGGEST,
  'Onside Attempt': SUGGEST,
  'Onside Recovered': SUGGEST,
  'Penalty Calls TD Back': SUGGEST,
  'Disqualified': SUGGEST,   // college only — enforced in detect.js

  // Tier C — no structured signal exists. Ref-only, forever. Named in the UI
  // rather than left as cards that silently never appear.
  'Doink': NEVER,
  'Record Broken': NEVER,
  // Moved here in Session 17, on evidence rather than the original guess. The
  // plan assumed the play text "sometimes says fake". It never does: the word
  // appears in 0 of 111 games scanned across both leagues, and a fake reads as
  // an ordinary fourth-down rush with no marker separating it from a scramble.
  // There is nothing to detect, so it stops claiming there is.
  'Fake Punt/FG': NEVER,
};

/** Yardage thresholds, so the numbers are not buried in the logic. */
const BIG_PLAY_YARDS = 20;
const HUGE_PLAY_YARDS = 50;

const modeFor = (cardId) => MODES[cardId] || NEVER;
const priorityFor = (cardId) => (cardId in PRIORITY ? PRIORITY[cardId] : 999);

/** Sort detections deterministically: bigger event first, then by card id. */
const byPriority = (a, b) =>
  priorityFor(a.cardId) - priorityFor(b.cardId) || a.cardId.localeCompare(b.cardId);

module.exports = {
  AUTO, SUGGEST, NEVER,
  MODES, PRIORITY,
  BIG_PLAY_YARDS, HUGE_PLAY_YARDS,
  modeFor, priorityFor, byPriority,
};
