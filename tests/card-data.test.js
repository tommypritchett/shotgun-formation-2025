/**
 * Phase 3a (the part that is pure test work) — the client's card data and the
 * server's deck must never drift apart.
 *
 * `client/src/data/cards.js` is the same data going onto a physical printed
 * deck. If an `id` here stops matching the string `generateDecks()` produces,
 * the app silently stops recognising a card that is sitting in someone's hand
 * on a table. This test makes that impossible to do by accident.
 *
 * `server.js` exports nothing and calls `listen()` at module load, so we lift
 * the two declarations we need straight out of its source text and evaluate
 * them in isolation. That keeps the guard honest: it reads whatever is actually
 * in the file today, with no duplicated copy to fall out of date.
 */
import { describe, expect, it } from 'vitest';
import { liftFromServer } from './helpers/lift-from-server.js';
import {
  DECK,
  DECK_TOTALS,
  DECLARABLE,
  FIRST_DOWN,
  ROUND_DURATIONS as CLIENT_ROUND_DURATIONS,
  STANDARD_CARDS,
  WILD_CARDS,
  formatValue,
  getCard,
} from '../client/src/data/cards.js';

const THIS_FILE = 'tests/card-data.test.js';

const generateDecks = liftFromServer(
  /const generateDecks = \(playerCount\) => \{[\s\S]*?\n\};/,
  'generateDecks',
  THIS_FILE
);
const serverRoundDurations = liftFromServer(
  /const ROUND_DURATIONS = \{[^}]*\};/,
  'ROUND_DURATIONS',
  THIS_FILE
);

/** `{ [cardName]: { drinks, copies } }` for a one-player deck. */
const tally = (cards) =>
  cards.reduce((acc, card) => {
    const entry = acc[card.card] || { drinks: card.drinks, copies: 0 };
    expect(card.drinks, `server deals ${card.card} at two different values`).toBe(entry.drinks);
    return { ...acc, [card.card]: { ...entry, copies: entry.copies + 1 } };
  }, {});

const { standardDeck, wildDeck } = generateDecks(1);
const serverStandard = tally(standardDeck);
const serverWild = tally(wildDeck);

describe('cards.js matches the server deck', () => {
  it.each(STANDARD_CARDS.map((c) => [c.id, c]))(
    'Standard "%s" has the server\'s drink value and copy count',
    (id, card) => {
      expect(serverStandard[id], `"${id}" is not in the server's Standard deck`).toBeTruthy();
      expect(serverStandard[id].drinks).toBe(card.drinks);
      expect(serverStandard[id].copies).toBe(card.copiesPerPlayer);
    }
  );

  it.each(WILD_CARDS.map((c) => [c.id, c]))(
    'Wild "%s" has the server\'s drink value and copy count',
    (id, card) => {
      expect(serverWild[id], `"${id}" is not in the server's Wild deck`).toBeTruthy();
      expect(serverWild[id].drinks).toBe(card.drinks);
      expect(serverWild[id].copies).toBe(card.copiesPerPlayer);
    }
  );

  it('has no server card missing from cards.js', () => {
    const missingStandard = Object.keys(serverStandard).filter((id) => !getCard(id));
    const missingWild = Object.keys(serverWild).filter((id) => !getCard(id));
    expect({ missingStandard, missingWild }).toEqual({ missingStandard: [], missingWild: [] });
  });

  it('puts every card in the deck the server deals it from', () => {
    for (const card of STANDARD_CARDS) expect(card.deck).toBe(DECK.STANDARD);
    for (const card of WILD_CARDS) expect(card.deck).toBe(DECK.WILD);
    // Safety is a Wild card, which is why it can never appear in a Standard hand.
    expect(serverWild.Safety).toBeTruthy();
    expect(serverStandard.Safety).toBeUndefined();
  });

  it('agrees on deck size: 35 Standard + 43 Wild per player', () => {
    expect(DECK_TOTALS.standardPerPlayer).toBe(35);
    expect(DECK_TOTALS.wildPerPlayer).toBe(43);
    expect(standardDeck).toHaveLength(DECK_TOTALS.standardPerPlayer);
    expect(wildDeck).toHaveLength(DECK_TOTALS.wildPerPlayer);
    expect(standardDeck.length + wildDeck.length).toBe(78);
  });

  it('scales with player count exactly as the server does', () => {
    const forFive = generateDecks(5);
    expect(forFive.standardDeck).toHaveLength(DECK_TOTALS.standardPerPlayer * 5);
    expect(forFive.wildDeck).toHaveLength(DECK_TOTALS.wildPerPlayer * 5);
  });

  it('keeps the awkward wire values exactly as the server spells them', () => {
    // These are the ones most likely to be "tidied up" on a print proof.
    expect(getCard('Sacks')).toBeTruthy(); // plural
    expect(getCard('Blocked Kicks')).toBeTruthy(); // plural
    expect(getCard('Fake Punt/FG')).toBeTruthy(); // no spaces around the slash
    expect(getCard('Disqualified')).toBeTruthy(); // NOT "Disqualiffety"
    expect(getCard('3 n Out')).toBeTruthy();
    expect(getCard('2 PT Conversion')).toBeTruthy();
  });

  it('shares one set of round durations with the server', () => {
    expect(CLIENT_ROUND_DURATIONS).toEqual(serverRoundDurations);
    expect(serverRoundDurations).toEqual({ standard: 21, wild: 11, firstDown: 6 });
  });
});

describe('card display rules', () => {
  it('offers the Host exactly the 5 Standard cards plus First Down', () => {
    expect(DECLARABLE).toHaveLength(6);
    expect(DECLARABLE.map((c) => c.id)).toEqual([
      'Penalty',
      'Sacks',
      'Touchdown',
      'Field Goal',
      'Turnover',
      'First Down',
    ]);
  });

  it('treats First Down as a global event, not a card in either deck', () => {
    expect(FIRST_DOWN.isGlobalEvent).toBe(true);
    expect(FIRST_DOWN.deck).toBeNull();
    expect(serverStandard['First Down']).toBeUndefined();
    expect(serverWild['First Down']).toBeUndefined();
  });

  it('renders values of 10 or more as shotguns, matching the server fold', () => {
    expect(formatValue(1)).toEqual({ amount: 1, unit: 'Drink', isShotgun: false });
    expect(formatValue(9)).toEqual({ amount: 9, unit: 'Drinks', isShotgun: false });
    expect(formatValue(10)).toEqual({ amount: 1, unit: 'Shotgun', isShotgun: true });
    expect(formatValue(40)).toEqual({ amount: 4, unit: 'Shotguns', isShotgun: true });
  });

  it('formats every real card the same way the server folds it', () => {
    for (const card of [...STANDARD_CARDS, ...WILD_CARDS]) {
      const formatted = formatValue(card.drinks);
      expect(formatted.amount).toBe(
        formatted.isShotgun ? Math.floor(card.drinks / 10) : card.drinks
      );
    }
  });
});
