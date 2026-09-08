/**
 * What may be shed at the quarter break, and what the player is giving up.
 *
 * The rule is shedding redundancy, not rerolling a hand:
 *
 *  - only cards held two or more times are selectable, and
 *  - one copy of each is always kept, so `n` copies means at most `n - 1` may
 *    go.
 *
 * The server enforces exactly this and refuses an over-reach whole rather than
 * partly, so the UI must never offer a selection the server would reject —
 * otherwise Confirm silently does nothing and spends the allowance.
 *
 * Pure, so the rule can be tested without rendering a hand.
 */

/** A card's identity: the name AND its value. Same name, different value, is a different card. */
export const cardKey = (entry) =>
  (entry && entry.card ? `${entry.card}|${entry.drinks}` : null);

/**
 * Every card in one deck held two or more times.
 *
 * @returns {Array<{key: string, card: object, held: number, spare: number}>}
 *   `spare` is how many may be shed — always `held - 1`.
 */
export const duplicateGroups = (cards = []) => {
  const list = Array.isArray(cards) ? cards.filter((c) => cardKey(c)) : [];
  const byKey = new Map();
  for (const entry of list) {
    const key = cardKey(entry);
    const at = byKey.get(key);
    if (at) at.held += 1;
    else byKey.set(key, { key, card: entry, held: 1 });
  }
  return [...byKey.values()]
    .filter((g) => g.held >= 2)
    .map((g) => ({ ...g, spare: g.held - 1 }));
};

/** Both decks at once, tagged, for a single sheet. */
export const swappableGroups = (hand = {}) => [
  ...duplicateGroups(hand.standard).map((g) => ({ ...g, deck: 'standard' })),
  ...duplicateGroups(hand.wild).map((g) => ({ ...g, deck: 'wild' })),
];

/** The selection key a group is counted under. Deck-qualified: the two decks
 *  can hold cards that would otherwise collide. */
export const groupKey = (group) => `${group.deck}|${group.key}`;

/**
 * Toggle one more copy of a group into the selection, or clear it if every
 * spare is already selected.
 *
 * Tapping cycles 0 → 1 → … → spare → 0, so a mis-tap is always recoverable by
 * carrying on tapping — which is the specific thing that prompted this.
 * Returns a NEW selection; the caller's object is never modified.
 */
export const toggleSelection = (selection = {}, group) => {
  const key = groupKey(group);
  const at = selection[key] || 0;
  const next = at >= group.spare ? 0 : at + 1;
  const out = { ...selection };
  if (next === 0) delete out[key];
  else out[key] = next;
  return out;
};

/** How many copies of this group are selected. */
export const selectedCount = (selection = {}, group) => selection[groupKey(group)] || 0;

/** Total cards selected across every group. */
export const totalSelected = (selection = {}) =>
  Object.values(selection).reduce((a, n) => a + n, 0);

/**
 * The flat list the server wants: one entry per copy being shed, each tagged
 * with its deck.
 */
export const selectionToCards = (selection = {}, groups = []) =>
  groups.flatMap((g) => {
    const n = selectedCount(selection, g);
    return Array.from({ length: n }, () => ({
      card: g.card.card, drinks: g.card.drinks, deck: g.deck,
    }));
  });

export default {
  duplicateGroups, swappableGroups, toggleSelection,
  selectedCount, totalSelected, selectionToCards, groupKey, cardKey,
};
