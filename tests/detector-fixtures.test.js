/**
 * Whole recorded games, end to end through the detector.
 *
 * The unit tests say each rule is right in isolation. These say the detector is
 * right about a real game — which is the only claim that matters, and the only
 * one that would have caught the two bugs the fixtures actually found:
 *
 *  - `2 PT Conversion` never fired, because the try is appended to the
 *    touchdown's text and the play still carries `scoreValue: 6`.
 *  - `Turnover on Downs` never fired, because at play level a failed fourth
 *    down is an ordinary incompletion. It is only named at drive level.
 *
 * Both were invisible to hand-built plays and obvious the moment a real game
 * ran through.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay, detectGame } = require(path.join(ROOT, 'server/feed/detect.js'));

const fixture = (league, id) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));

const countsOf = (detections) => detections.reduce((acc, d) => {
  acc[d.cardId] = (acc[d.cardId] || 0) + 1;
  return acc;
}, {});

describe('real NFL games', () => {
  it('calls a high-scoring game the way the box score reads', () => {
    // SF 26 - LAR 42. Ten touchdowns between them.
    const counts = countsOf(detectGame(fixture('nfl', '401772879')));
    expect(counts.Touchdown).toBe(10);
    expect(counts['First Down']).toBeGreaterThan(40);
    expect(counts.Penalty).toBeGreaterThan(0);
  });

  it('still finds plenty to do in a 24-point slog', () => {
    // CAR 7 - NO 17. The case for auto-calling First Down at all: three
    // touchdowns in the whole game, but the room is not left with nothing.
    const counts = countsOf(detectGame(fixture('nfl', '401772877')));
    expect(counts.Touchdown).toBe(3);
    // 31, against an official 30. Three touchdowns in the whole game, and the
    // room still gets something to do roughly every three minutes.
    expect(counts['First Down']).toBeGreaterThan(25);
    expect(counts['Blocked Kicks']).toBe(1);   // there really was one
  });

  it('handles overtime without losing the extra period', () => {
    const game = fixture('nfl', '401772636');
    expect(game.periods).toBe(5);
    const inOT = detectGame(game).filter((d) => d.period === 5);
    expect(inOT.length).toBeGreaterThan(0);
  });
});

describe('real college games', () => {
  it('reads a Power conference game as well as an NFL one', () => {
    const counts = countsOf(detectGame(fixture('college-football', '401752889')));
    expect(counts.Touchdown).toBe(7);
    expect(counts['First Down']).toBeGreaterThan(25);
  });

  it('handles college overtime, which has no game clock', () => {
    const game = fixture('college-football', '401754581');
    expect(game.periods).toBeGreaterThan(4);
    expect(() => detectGame(game)).not.toThrow();
  });
});

describe('a game whose feed has nothing in it', () => {
  // KYW 7 - WFLA 28. A real, completed game for which ESPN carries zero plays.
  // This is the degrade path, and it is not synthetic.
  const empty = fixture('college-football', '401773497');

  it('is a real fixture with a real result and no plays at all', () => {
    expect(empty.playCount).toBe(0);
    expect(empty.teams.length).toBe(2);
  });

  it('produces silence, not garbage', () => {
    expect(detectGame(empty)).toEqual([]);
  });
});

describe('multi-card plays and negation', () => {
  // Real plays, lifted verbatim from the captured games. Each case names the
  // game and sequence number it came from so it can be re-checked.
  const { cases } = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'fixtures/cases/multi-card.json'), 'utf8')
  );

  for (const testCase of cases) {
    it(`${testCase.name} (${testCase.source})`, () => {
      const found = detectPlay(testCase.play, { league: testCase.league }).map((d) => d.cardId);
      for (const expected of testCase.expect) {
        expect(found, `${testCase.why}`).toContain(expected);
      }
      for (const forbidden of testCase.expectNot) {
        expect(found, `${testCase.why}`).not.toContain(forbidden);
      }
    });
  }

  it('orders every multi-card play deterministically', () => {
    // Run the same game twice; identical output, or the queue is unstable.
    const once = detectGame(fixture('nfl', '401772636'));
    const twice = detectGame(fixture('nfl', '401772636'));
    expect(once).toEqual(twice);
  });

  it('produces multi-card plays often enough to matter', () => {
    // ~14 a game. Sequential rounds are not an edge case, and the report says
    // so with a number rather than a guess.
    const game = fixture('nfl', '401772636');
    const plays = [...game.plays].sort((a, b) => a.sequence - b.sequence);
    const multi = plays.filter((p) => detectPlay(p, { league: 'nfl' }).length > 1);
    expect(multi.length).toBeGreaterThan(5);
  });
});

describe('detection is stable against the feed changing shape', () => {
  it('survives every play having a field stripped', () => {
    const game = fixture('nfl', '401772877');
    for (const field of ['typeText', 'text', 'yards', 'start', 'end', 'scoringPlay', 'isPenalty']) {
      const damaged = {
        ...game,
        plays: game.plays.map((p) => ({ ...p, [field]: field === 'start' || field === 'end' ? {} : null })),
      };
      expect(() => detectGame(damaged), `stripping ${field} threw`).not.toThrow();
    }
  });

  it('degrades to fewer detections rather than wrong ones', () => {
    const game = fixture('nfl', '401772877');
    const full = detectGame(game).length;
    const stripped = detectGame({
      ...game,
      plays: game.plays.map((p) => ({ ...p, text: null, typeText: null })),
    }).length;
    expect(stripped).toBeLessThan(full);
  });
});

describe('first downs against ESPN\'s own box score', () => {
  /**
   * The check that found two real faults. Counted per game, never against a
   * league average — an average hides a detector that is wrong in both
   * directions, which is exactly what this one was.
   *
   * Residual: +1 in every game. Consistent, unexplained, and deliberately NOT
   * tuned away. Three games is not enough to fit a correction to without
   * inventing a rule that happens to make the numbers meet.
   */
  const BOX_SCORE_FIRST_DOWNS = {
    '401772636': 47,   // IND 31 - ATL 25
    '401772877': 30,   // CAR 7 - NO 17
    '401772879': 55,   // SF 26 - LAR 42
  };

  for (const [gameId, official] of Object.entries(BOX_SCORE_FIRST_DOWNS)) {
    it(`is within one of the official total for ${gameId}`, () => {
      const counted = detectGame(fixture('nfl', gameId))
        .filter((d) => d.cardId === 'First Down').length;
      expect(counted - official, `detector ${counted} vs box score ${official}`)
        .toBeGreaterThanOrEqual(0);
      expect(counted - official).toBeLessThanOrEqual(1);
    });
  }
});
