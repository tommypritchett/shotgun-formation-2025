/**
 * Which standard cards a player holds more than one of.
 *
 * The quarter-break swap covers duplicate standard cards as well as wild ones,
 * but ONLY duplicates: a hand of five different standard cards has nothing
 * wrong with it, and allowing any card to be swapped would turn a fix for dead
 * weight into a general reroll. The server enforces the same rule; this is so
 * the UI never offers a swap the server will silently refuse.
 *
 * Pure, so the rule can be tested without rendering a hand.
 */

/** A card's identity for duplicate purposes: the name and its value. */
const keyOf = (entry) => (entry && entry.card ? `${entry.card}|${entry.drinks}` : null);

/**
 * Entries from `standard` that appear two or more times, one entry per
 * duplicated card — not every copy, since swapping is one-at-a-time and
 * offering both copies of the same card reads as two different options.
 *
 * @param {Array<{card: string, drinks: number}>} standard
 * @returns {Array}
 */
export const duplicateStandardCards = (standard = []) => {
  const list = Array.isArray(standard) ? standard.filter((c) => keyOf(c)) : [];
  const counts = list.reduce((acc, entry) => {
    const k = keyOf(entry);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const seen = new Set();
  return list.filter((entry) => {
    const k = keyOf(entry);
    if (counts[k] < 2 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export default { duplicateStandardCards };
