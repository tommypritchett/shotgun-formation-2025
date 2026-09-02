/**
 * Which cards have ever fired against a REAL game.
 *
 * 2 PT Conversion passed every unit test it had and was incapable of firing on
 * real data: the try is appended to the touchdown's text and the play still
 * carries `scoreValue: 6`. Disqualified was in exactly the same position — its
 * rule required the words "disqualified" or "ejected", and ESPN writes neither.
 * Both were only ever going to be caught by running real games through.
 *
 * So this test is the standing guard: every card the detector claims to call
 * must have fired at least once across the fixture set, or be named here as a
 * known gap with a reason. A card at zero is a card that might not work.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay, detectDrive } = require(path.join(ROOT, 'server/feed/detect.js'));
const { MODES, modeFor, NEVER } = require(path.join(ROOT, 'server/feed/cards.js'));

/**
 * Cards with no real-data coverage, and why. Removing a card from this list
 * without a fixture that fires it will fail the test — which is the point.
 */
const KNOWN_GAPS = {
  // Empty, and it should stay that way. Fake Punt/FG used to sit here; it is
  // now NEVER, which is the honest answer rather than a permanent exemption.
  // A card that cannot fire should not be advertised as one that can.
};

const counts = () => {
  const tally = {};
  for (const league of ['nfl', 'college-football']) {
    for (const file of fs.readdirSync(path.join(ROOT, 'fixtures', league))) {
      const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, file), 'utf8'));
      if (!game.plays.length) continue;
      for (const play of game.plays) {
        for (const c of detectPlay(play, { league })) tally[c.cardId] = (tally[c.cardId] || 0) + 1;
      }
      for (const drive of game.drives || []) {
        for (const c of detectDrive(drive)) tally[c.cardId] = (tally[c.cardId] || 0) + 1;
      }
    }
  }
  return tally;
};

describe('real-data coverage', () => {
  const tally = counts();

  const machineCalled = Object.keys(MODES).filter((id) => modeFor(id) !== NEVER);

  for (const cardId of machineCalled) {
    it(`${cardId} has fired against a real game`, () => {
      if (KNOWN_GAPS[cardId]) {
        // Documented gap. If it starts firing, delete the entry and this passes
        // on the real branch instead.
        expect(tally[cardId] || 0, `${cardId} now fires — remove it from KNOWN_GAPS`).toBe(0);
        return;
      }
      expect(
        tally[cardId] || 0,
        `${cardId} has never fired against any fixture. It passes its unit tests, `
          + 'which is exactly what 2 PT Conversion and Disqualified did while being '
          + 'incapable of firing. Capture a fixture that exercises it, or add it to '
          + 'KNOWN_GAPS with a reason.'
      ).toBeGreaterThan(0);
    });
  }

  it('does not quietly grow the list of known gaps', () => {
    // A gap is a card claiming to be machine-callable while never having fired.
    // The right fix is nearly always to capture a fixture or move it to NEVER,
    // not to add an exemption here.
    expect(Object.keys(KNOWN_GAPS)).toEqual([]);
  });

  it('never machine-calls the Ref-only cards', () => {
    for (const cardId of ['Doink', 'Record Broken', 'Fake Punt/FG']) {
      expect(tally[cardId] || 0, `${cardId} fired, and it must never`).toBe(0);
    }
  });
});
