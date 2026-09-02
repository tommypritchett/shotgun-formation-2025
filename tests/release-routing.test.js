/**
 * Every auto-called card must have a declaration path that exists.
 *
 * The deck decides which: five cards are Standard, First Down has its own
 * event, everything else is Wild. A card routed to the wrong path would either
 * fail to find any holder or declare with the wrong round length, and neither
 * shows up until a real game.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pathFor, STANDARD_CARDS } = require(path.join(ROOT, 'server/feed/routing.js'));
const { MODES, modeFor, NEVER } = require(path.join(ROOT, 'server/feed/cards.js'));

/** The deck, read from the client's own data file rather than duplicated. */
const deck = () => {
  const source = fs.readFileSync(path.join(ROOT, 'client/src/data/cards.js'), 'utf8');
  const out = {};
  const re = /\{\s*id:\s*'([^']+)'[\s\S]*?deck:\s*DECK\.(\w+)/g;
  let m;
  while ((m = re.exec(source))) out[m[1]] = m[2];
  return out;
};

describe('routing a detected card to a declaration path', () => {
  const decks = deck();

  it('sends First Down to its own event', () => {
    expect(pathFor('First Down')).toBe('firstDown');
    expect(decks['First Down'], 'First Down is not a deck card').toBeUndefined();
  });

  it('agrees with the deck on every card', () => {
    for (const [cardId, which] of Object.entries(decks)) {
      const expected = which === 'STANDARD' ? 'standard' : 'wild';
      expect(pathFor(cardId), `${cardId} is a ${which} card`).toBe(expected);
    }
  });

  it('has the right five Standard cards and no others', () => {
    const fromDeck = Object.entries(decks)
      .filter(([, which]) => which === 'STANDARD').map(([id]) => id).sort();
    expect([...STANDARD_CARDS].sort()).toEqual(fromDeck);
  });

  it('routes every machine-callable card somewhere real', () => {
    for (const cardId of Object.keys(MODES)) {
      if (modeFor(cardId) === NEVER) continue;
      expect(['firstDown', 'standard', 'wild']).toContain(pathFor(cardId));
    }
  });
});
