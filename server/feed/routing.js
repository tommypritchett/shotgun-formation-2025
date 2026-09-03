/**
 * Which declaration path a detected card takes.
 *
 * The deck decides, not the detector. Five cards are Standard, First Down is
 * its own event, and everything else is Wild — so most auto-called cards go
 * through the wild path. That is fine: `wildCardConfirmed` only ever used its
 * `player` argument for a log line, and the work loops over everyone holding
 * the card, so a declaration needs no selecting player.
 *
 * Kept as data next to the detector rather than as branches inside it, so
 * adding a card is a one-line change in one place.
 */

/** The five Standard-deck cards, from client/src/data/cards.js. */
const STANDARD_CARDS = new Set(['Penalty', 'Sacks', 'Touchdown', 'Field Goal', 'Turnover']);

/** First Down is not in the deck at all — it has its own event and duration. */
const FIRST_DOWN = 'First Down';

/**
 * @returns {'firstDown'|'standard'|'wild'}
 */
const pathFor = (cardId) => {
  if (cardId === FIRST_DOWN) return 'firstDown';
  if (STANDARD_CARDS.has(cardId)) return 'standard';
  return 'wild';
};

module.exports = { pathFor, STANDARD_CARDS, FIRST_DOWN };
