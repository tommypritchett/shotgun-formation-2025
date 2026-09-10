/**
 * The "Follow a game" walkthrough — the parts that can be wrong.
 *
 * This is a marketing asset. It will be screen-recorded, cut into videos and
 * sent to people who judge the whole project on it. So the tests are not about
 * whether it looks nice — they are about whether it TELLS THE TRUTH:
 *
 *   - every card it names is a real card,
 *   - every number it shows is a number the real game would produce,
 *   - and no real club's name is anywhere in it.
 *
 * A demo that displays "5 drinks" for a card worth 4 is a false claim about the
 * product, and it would be shipped at exactly the moment the most strangers
 * were looking at it.
 */
import { describe, expect, it } from 'vitest';
import { BEATS, SLATE, PLAYERS, HANDS, FOLLOWED_ID, CLIMAX_CARD, TOTAL_MS, END_CARD }
  from '../../client/src/demo/script.js';
import { totalDrinks, holderLine, pourDrinks, lineText, valueWords }
  from '../../client/src/demo/lines.js';
import { getCard, DRINKS_PER_SHOTGUN } from '../../client/src/data/cards.js';

/** Every card id the script mentions, from any position. */
const scriptedCardIds = () => {
  const ids = [];
  Object.values(HANDS).forEach((hand) => {
    ids.push(...(hand.standard || []), ...(hand.wild || []));
  });
  BEATS.forEach((b) => {
    if (b.set && b.set.declared && b.set.declared.cardId) ids.push(b.set.declared.cardId);
    (b.feed || []).forEach((f) => { if (f.cardId) ids.push(f.cardId); });
  });
  ids.push(CLIMAX_CARD);
  return [...new Set(ids)];
};

describe('every card the demo names is a real card', () => {
  it('resolves in data/cards.js', () => {
    const missing = scriptedCardIds().filter((id) => !getCard(id));
    expect(missing, `these ids are not in data/cards.js: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses the awkward ids exactly — a typo fails silently in the real game', () => {
    // `Sacks` plural, `Blocked Kicks` plural, `Fake Punt/FG` with no spaces.
    const ids = scriptedCardIds();
    expect(ids).toContain('Sacks');
    expect(ids, 'the singular "Sack" is not a card id').not.toContain('Sack');
  });

  it('deals a real hand: five Standard and two Wild each', () => {
    for (const p of PLAYERS) {
      const hand = HANDS[p.name];
      expect(hand, `${p.name} has no hand`).toBeTruthy();
      expect(hand.standard).toHaveLength(5);
      expect(hand.wild).toHaveLength(2);
      hand.standard.forEach((id) =>
        expect(getCard(id).deck, `${id} is not a Standard card`).toBe('standard'));
      hand.wild.forEach((id) =>
        expect(getCard(id).deck, `${id} is not a Wild card`).toBe('wild'));
    }
  });

  it('gives every declared card to somebody who is actually holding it', () => {
    for (const b of BEATS) {
      const d = b.set && b.set.declared;
      if (!d || !d.cardId || !d.holder) continue;
      const hand = HANDS[d.holder];
      const held = [...hand.standard, ...hand.wild]
        .filter((id) => id === d.cardId).length;
      expect(held, `beat ${b.n}: ${d.holder} does not hold ${d.cardId}`)
        .toBeGreaterThanOrEqual(d.copies || 1);
    }
  });
});

describe('the arithmetic is the real game\'s arithmetic', () => {
  it('two 3-drink Touchdowns is 6, not 3 and not 5', () => {
    expect(getCard('Touchdown').drinks).toBe(3);
    expect(totalDrinks('Touchdown', 2)).toBe(6);
    expect(holderLine('Dylan', 'Touchdown', 2)).toBe('Dylan has 2 Touchdown cards — 6 drinks');
  });

  it('a Wild worth 20 reads as 2 shotguns, never as 20 drinks', () => {
    const card = getCard(CLIMAX_CARD);
    expect(card.drinks).toBe(2 * DRINKS_PER_SHOTGUN);
    expect(valueWords(card.drinks)).toBe('2 shotguns');
    expect(holderLine('Marcus', CLIMAX_CARD, 1))
      .toBe(`Marcus has a ${card.label} card — 2 shotguns`);
  });

  it('a single Sack is 2 drinks and says "a Sack card", using the label not the id', () => {
    expect(holderLine('Marcus', 'Sacks', 1)).toBe('Marcus has a Sack card — 2 drinks');
  });

  /**
   * The one place the script states a number: how a card's value is SPLIT
   * between players. Each split has to add back up to what the card is worth,
   * or the demo shows drinks appearing from nowhere.
   */
  it('every pour split sums to exactly what the card was worth', () => {
    let declared = null;
    for (const b of BEATS) {
      if (b.set && 'declared' in b.set) declared = b.set.declared;
      const pours = (b.feed || []).filter((f) => f.kind === 'pour');
      if (pours.length === 0) continue;
      // The beat's pours belong to the most recently declared card.
      expect(declared, `beat ${b.n} pours with nothing declared`).toBeTruthy();
      if (!declared.cardId) continue;   // a global event, not a card
      const poured = pours.reduce((n, p) => n + pourDrinks(p), 0);
      const worth = totalDrinks(declared.cardId, declared.copies || 1);
      expect(poured,
        `beat ${b.n}: ${declared.cardId} x${declared.copies || 1} is worth ${worth} `
        + `but the demo pours ${poured}`).toBe(worth);
    }
  });

  it('never renders a number the real game could not produce', () => {
    // Any holder line's total must equal copies x the card's own value.
    for (const b of BEATS) {
      for (const f of (b.feed || [])) {
        if (f.kind !== 'holder') continue;
        const expected = getCard(f.cardId).drinks * (f.copies || 1);
        expect(lineText(f)).toContain(valueWords(expected));
      }
    }
  });
});

/**
 * Strip comments before scanning.
 *
 * These files EXPLAIN the rules — "no real club names", "no Math.random" — so
 * the forbidden words appear in their own documentation. A scanner that cannot
 * tell prose from code fails on the very comment describing the rule it
 * enforces, which is exactly what happened on the first run.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const demoFile = (name) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const url = require('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(
    path.resolve(here, '..', '..', 'client', 'src', 'demo', name), 'utf8');
};

describe('no real club appears anywhere', () => {
  const scriptText = () => stripComments(demoFile('script.js'));

  /**
   * Nicknames, not city names: a city can coincide innocently, a nickname
   * cannot. This is the list that would actually embarrass the project if it
   * turned up in a video.
   */
  const REAL_NICKNAMES = [
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals',
    'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts',
    'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams', 'Dolphins', 'Vikings',
    'Patriots', 'Saints', 'Giants', 'Jets', 'Eagles', 'Steelers', '49ers',
    'Seahawks', 'Buccaneers', 'Titans', 'Commanders',
    'Crimson Tide', 'Buckeyes', 'Wolverines', 'Longhorns', 'Sooners', 'Trojans',
    'Bulldogs', 'Gators', 'Tigers', 'Aggies', 'Volunteers', 'Nittany Lions',
  ];

  it('names no real club', () => {
    const text = scriptText();
    const found = REAL_NICKNAMES.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
    expect(found, `real club names in the demo script: ${found.join(', ')}`).toEqual([]);
  });

  it('does not use the letters NFL on this route', () => {
    expect(/\bNFL\b/.test(scriptText()), 'the demo script says NFL').toBe(false);
  });

  it('the slate is all invented and internally consistent', () => {
    expect(SLATE.length).toBeGreaterThanOrEqual(6);
    const ids = SLATE.map((g) => g.id);
    expect(new Set(ids).size, 'duplicate game ids').toBe(ids.length);
    expect(SLATE.find((g) => g.id === FOLLOWED_ID), 'the followed game is not on the slate')
      .toBeTruthy();
    SLATE.forEach((g) => {
      expect(g.away.code).toMatch(/^[A-Z]{2,4}$/);
      expect(g.home.code).toMatch(/^[A-Z]{2,4}$/);
      expect(['in', 'pre', 'post']).toContain(g.state);
    });
  });
});

describe('the sequence itself', () => {
  it('is ten addressable beats, numbered 1..10', () => {
    expect(BEATS.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('keeps the shotgun at beat 8, because deep links point at it', () => {
    expect(BEATS[7].id).toBe('shotgun');
    expect(BEATS[7].set.declared.cardId).toBe(CLIMAX_CARD);
  });

  it('runs 100-130 seconds at 1x', () => {
    expect(TOTAL_MS).toBeGreaterThanOrEqual(100_000);
    expect(TOTAL_MS).toBeLessThanOrEqual(130_000);
  });

  it('schedules every feed line inside its own beat', () => {
    for (const b of BEATS) {
      for (const f of (b.feed || [])) {
        expect(f.at, `beat ${b.n}: a line is scheduled past the end of the beat`)
          .toBeLessThan(b.ms);
      }
    }
  });

  it('has no randomness and no wall clock', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const dir = path.resolve(here, '..', '..', 'client', 'src', 'demo');
    const text = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))
      .map((f) => stripComments(fs.readFileSync(path.join(dir, f), 'utf8')))
      .join('\n');
    expect(/Math\.random/.test(text), 'the demo uses Math.random — takes will differ')
      .toBe(false);
    expect(/Date\.now|new Date\(\)/.test(text), 'the demo reads the wall clock')
      .toBe(false);
  });

  it('the scanner would still catch a real one', () => {
    // A stripper that removed everything would make both tests above vacuous.
    expect(/Math\.random/.test(stripComments('const x = Math.random();'))).toBe(true);
    expect(/\bNFL\b/.test(stripComments("const t = 'NFL Sunday';"))).toBe(true);
    expect(/Math\.random/.test(stripComments('// uses Math.random'))).toBe(false);
    expect(/\bNFL\b/.test(stripComments('/* the letters NFL */'))).toBe(false);
  });

  it('ends on a CTA with somewhere to go', () => {
    expect(BEATS[9].set.screen).toBe('end');
    expect(END_CARD.url).toBeTruthy();
    expect(END_CARD.cta).toBeTruthy();
  });
});
