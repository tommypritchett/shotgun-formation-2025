/**
 * The quarter break — what may be shed, and how the selection behaves.
 *
 * Shedding redundancy, not rerolling: only duplicates are selectable and one
 * copy of each is always kept. The selection is multi-tap with a wrap back to
 * zero, because a mis-tap has to be recoverable — that is the specific
 * complaint this replaced.
 */
import { describe, expect, it } from 'vitest';
import {
  duplicateGroups, swappableGroups, toggleSelection,
  selectedCount, totalSelected, selectionToCards,
} from '../../client/src/lib/duplicate-cards.js';

const c = (card, drinks) => ({ card, drinks });

describe('what may be shed', () => {
  it('finds a card held twice, and offers one of it', () => {
    const [g] = duplicateGroups([c('Penalty', 1), c('Touchdown', 3), c('Penalty', 1)]);
    expect(g.card.card).toBe('Penalty');
    expect(g.held).toBe(2);
    expect(g.spare).toBe(1);
  });

  it('always keeps one: 3 held means 2 spare', () => {
    const [g] = duplicateGroups([c('Penalty', 1), c('Penalty', 1), c('Penalty', 1)]);
    expect(g.held).toBe(3);
    expect(g.spare).toBe(2);
  });

  it('ignores a card held exactly once', () => {
    expect(duplicateGroups([c('Penalty', 1), c('Touchdown', 3)])).toEqual([]);
  });

  it('treats the same name at a different value as a different card', () => {
    expect(duplicateGroups([c('Penalty', 1), c('Penalty', 2)])).toEqual([]);
  });

  it('covers both decks in one list, tagged', () => {
    const groups = swappableGroups({
      standard: [c('Penalty', 1), c('Penalty', 1)],
      wild: [c('Doink', 40), c('Doink', 40)],
    });
    expect(groups.map((g) => g.deck).sort()).toEqual(['standard', 'wild']);
  });

  it('does not fall over on rubbish', () => {
    expect(duplicateGroups(undefined)).toEqual([]);
    expect(duplicateGroups([null, {}, 7])).toEqual([]);
    expect(swappableGroups({})).toEqual([]);
  });
});

describe('selecting what to shed', () => {
  const groups = swappableGroups({
    standard: [c('Penalty', 1), c('Penalty', 1), c('Penalty', 1),
      c('Touchdown', 3), c('Touchdown', 3)],
  });
  const penalty = groups.find((g) => g.card.card === 'Penalty');   // held 3, spare 2
  const touchdown = groups.find((g) => g.card.card === 'Touchdown'); // held 2, spare 1

  it('the owner example: 3 Penalty and 2 Touchdown means 3 selectable', () => {
    expect(penalty.spare + touchdown.spare).toBe(3);
  });

  it('tapping adds one copy at a time, up to the spare count', () => {
    let sel = {};
    sel = toggleSelection(sel, penalty);
    expect(selectedCount(sel, penalty)).toBe(1);
    sel = toggleSelection(sel, penalty);
    expect(selectedCount(sel, penalty)).toBe(2);
  });

  it('tapping past the last spare clears it — a mis-tap is recoverable', () => {
    let sel = {};
    sel = toggleSelection(sel, touchdown);      // 1 of 1
    expect(selectedCount(sel, touchdown)).toBe(1);
    sel = toggleSelection(sel, touchdown);      // wraps to 0
    expect(selectedCount(sel, touchdown)).toBe(0);
    expect(totalSelected(sel)).toBe(0);
  });

  it('never selects the last copy of a card', () => {
    let sel = {};
    for (let i = 0; i < 10; i += 1) sel = toggleSelection(sel, penalty);
    expect(selectedCount(sel, penalty)).toBeLessThanOrEqual(penalty.spare);
  });

  it('does not modify the selection it was given', () => {
    const before = {};
    const after = toggleSelection(before, penalty);
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });

  it('builds the flat list the server wants, one entry per copy', () => {
    let sel = {};
    sel = toggleSelection(sel, penalty);
    sel = toggleSelection(sel, penalty);        // 2 Penalty
    sel = toggleSelection(sel, touchdown);      // 1 Touchdown
    expect(totalSelected(sel)).toBe(3);

    const cards = selectionToCards(sel, groups);
    expect(cards).toHaveLength(3);
    expect(cards.filter((x) => x.card === 'Penalty')).toHaveLength(2);
    expect(cards.filter((x) => x.card === 'Touchdown')).toHaveLength(1);
    expect(cards.every((x) => x.deck === 'standard')).toBe(true);
  });

  it('keeps the two decks apart even if a card name collided', () => {
    const both = swappableGroups({
      standard: [c('X', 1), c('X', 1)],
      wild: [c('X', 1), c('X', 1)],
    });
    let sel = toggleSelection({}, both[0]);
    expect(totalSelected(sel)).toBe(1);
    sel = toggleSelection(sel, both[1]);
    expect(totalSelected(sel), 'the two decks shared one selection slot').toBe(2);
  });
});
