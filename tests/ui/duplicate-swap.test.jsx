/**
 * Item 5 — the quarter-break swap covers duplicate standard cards.
 *
 * Duplicates ONLY. A hand of five different standard cards has nothing wrong
 * with it; holding the same card twice is the dead weight this fixes. The
 * server enforces the same rule, and this keeps the UI from offering a swap
 * that would then be silently refused.
 */
import { describe, expect, it } from 'vitest';
import { duplicateStandardCards } from '../../client/src/lib/duplicate-cards.js';

const c = (card, drinks) => ({ card, drinks });

describe('finding the duplicates worth swapping', () => {
  it('finds a card held twice', () => {
    const out = duplicateStandardCards([c('Penalty', 1), c('Touchdown', 3), c('Penalty', 1)]);
    expect(out.map((x) => x.card)).toEqual(['Penalty']);
  });

  it('offers a duplicated card ONCE, not once per copy', () => {
    // Both copies are the same option; listing two reads as two choices.
    const out = duplicateStandardCards([c('Penalty', 1), c('Penalty', 1), c('Penalty', 1)]);
    expect(out).toHaveLength(1);
  });

  it('ignores a hand with nothing duplicated', () => {
    expect(duplicateStandardCards([c('Penalty', 1), c('Touchdown', 3), c('Sacks', 2)]))
      .toEqual([]);
  });

  it('treats the same name at a different value as a different card', () => {
    // Card identity in this deck is name AND value.
    expect(duplicateStandardCards([c('Penalty', 1), c('Penalty', 2)])).toEqual([]);
  });

  it('finds several duplicated cards at once', () => {
    const out = duplicateStandardCards([
      c('Penalty', 1), c('Penalty', 1), c('Sacks', 2), c('Sacks', 2), c('Touchdown', 3),
    ]);
    expect(out.map((x) => x.card).sort()).toEqual(['Penalty', 'Sacks']);
  });

  it('does not fall over on rubbish', () => {
    expect(duplicateStandardCards(undefined)).toEqual([]);
    expect(duplicateStandardCards(null)).toEqual([]);
    expect(duplicateStandardCards([null, undefined, {}, c('Penalty', 1)])).toEqual([]);
  });
});
