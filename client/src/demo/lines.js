/**
 * Turning a scripted beat into the words in the event feed.
 *
 * Pure, and separate from the components, because this is where the demo's
 * ARITHMETIC lives — and a wrong number here is a false claim in a marketing
 * asset, not a cosmetic bug. Keeping it out of JSX means the sums can be tested
 * directly against `data/cards.js`.
 *
 * Nothing in `script.js` states what a card is worth. It names a card id and a
 * number of copies; the value is looked up and multiplied here, so the demo
 * cannot drift from the real deck.
 */
import { getCard, formatValue, DRINKS_PER_SHOTGUN } from '../data/cards';

/** What `copies` of a card are worth, in raw drinks. */
export const totalDrinks = (cardId, copies = 1) => {
  const card = getCard(cardId);
  if (!card) return 0;
  return card.drinks * Math.max(1, copies);
};

/**
 * How that total reads on screen.
 *
 * Deliberately `formatValue`, the same helper the real card face uses, so a
 * 20-value Wild says "2 shotguns" in the feed for exactly the reason it says
 * "2 SHOTGUNS" on the card. Two code paths would be two chances to disagree.
 */
export const valueWords = (drinks) => {
  const v = formatValue(drinks);
  return `${v.amount} ${v.unit.toLowerCase()}`;
};

/** "Marcus has a Sack card — 2 drinks" / "Dylan has 2 Touchdown cards — 6 drinks" */
export const holderLine = (player, cardId, copies = 1) => {
  const card = getCard(cardId);
  if (!card) return `${player} has a card`;
  const n = Math.max(1, copies);
  const total = totalDrinks(cardId, n);
  const noun = n > 1 ? `${n} ${card.label} cards` : `a ${card.label} card`;
  return `${player} has ${noun} — ${valueWords(total)}`;
};

/** "Marcus → Tommy   2 drinks" — a pour is stated in the script and checked by tests. */
export const pourLine = (from, to, { drinks, shotguns }) => {
  const amount = shotguns
    ? `${shotguns} ${shotguns === 1 ? 'shotgun' : 'shotguns'}`
    : `${drinks} ${drinks === 1 ? 'drink' : 'drinks'}`;
  return `${from} → ${to}   ${amount}`;
};

/** A pour's worth in raw drinks, so a split can be summed against the card. */
export const pourDrinks = (pour = {}) =>
  (pour.shotguns ? pour.shotguns * DRINKS_PER_SHOTGUN : 0) + (pour.drinks || 0);

/** Render one scripted feed entry to its display text. */
export const lineText = (entry) => {
  if (!entry) return '';
  switch (entry.kind) {
    case 'holder':
      return holderLine(entry.player, entry.cardId, entry.copies);
    case 'pour':
      return pourLine(entry.from, entry.to, entry);
    default:
      return entry.text || '';
  }
};

export default { totalDrinks, valueWords, holderLine, pourLine, pourDrinks, lineText };
