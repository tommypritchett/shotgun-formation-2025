/**
 * The live path must never take its timing from the feed's own timestamps.
 *
 * ESPN's play `wallclock` is not monotonic — SMU 26 - MIA 20 jumps BACKWARDS by
 * 3h11m at play 40, in a fixture captured straight from their API. A live game
 * can deliver the same defect.
 *
 * If the 45-second delay, the 90-second stale drop, the dedupe or the poll
 * schedule were derived from those timestamps, a backwards jump in production
 * would release a burst of queued calls at once — a room suddenly drinking to
 * five plays that happened minutes ago. It is worth a standing guard rather
 * than a comment, because the fix looks harmless when you are writing it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DetectionQueue } = require(path.join(ROOT, 'server/feed/queue.js'));
const { ReplayFeed } = require(path.join(ROOT, 'server/feed/replay-feed.js'));

/** Code only — the comments explaining this rule mention wallclock by name. */
const codeOf = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('the live path takes its timing from the clock, not the feed', () => {
  const LIVE_PATH = [
    'server/feed/queue.js',
    'server/feed/pipeline.js',
    'server/feed/live-feed.js',
    'server/feed/watchers.js',
    'server/feed/detect.js',
  ];

  for (const file of LIVE_PATH) {
    it(`${file} never schedules off a play timestamp`, () => {
      const code = codeOf(file);
      expect(code, `${file} reads wallclock`).not.toMatch(/\bwallclock\b/);
      expect(code, `${file} parses a feed date`).not.toMatch(/Date\.parse/);
    });
  }

  it('ReplayFeed is the only place that reads wallclock', () => {
    // And that is correct: it is reproducing a recorded game's spacing.
    expect(codeOf('server/feed/replay-feed.js')).toMatch(/\bwallclock\b/);
  });

  it('the queue measures the delay from when it was told, not from the play', () => {
    // Injectable clock, so a test can drive it — but it is a CLOCK, never a
    // field off the play.
    const clock = { t: 1_000_000 };
    const queue = new DetectionQueue({ now: () => clock.t });
    queue.push([{ cardId: 'Touchdown', playId: 'p1', reason: 'x' }]);

    clock.t += 44_000;
    expect(queue.release().due).toEqual([]);
    clock.t += 2_000;
    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Touchdown']);
  });

  it('dedupe is on the play id, so a repeated timestamp changes nothing', () => {
    const game = {
      league: 'nfl', gameId: 'x', drives: [],
      plays: [
        { id: 'same', sequence: 1, wallclock: '2025-11-09T18:00:00Z', start: {}, end: {} },
        { id: 'same', sequence: 2, wallclock: '2025-11-09T18:00:00Z', start: {}, end: {} },
        { id: 'other', sequence: 3, wallclock: '2025-11-09T18:00:00Z', start: {}, end: {} },
      ],
    };
    const seen = [];
    const feed = new ReplayFeed(game, { speed: 100_000 });
    feed.on('play', (p) => seen.push(p.id));
    return new Promise((resolve) => {
      feed.on('end', () => {
        expect(seen).toEqual(['same', 'other']);
        resolve();
      });
      feed.start();
    });
  });

  it('survives a fixture whose timestamps run backwards', async () => {
    // The real defect, from the real fixture, rather than a synthetic one.
    const game = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'fixtures/college-football/401754581.json'), 'utf8'));
    const plays = [...game.plays].sort((a, b) => a.sequence - b.sequence);

    const backwards = plays.findIndex((p, i) =>
      i > 0 && Date.parse(p.wallclock) < Date.parse(plays[i - 1].wallclock));
    expect(backwards, 'the fixture no longer contains the jump this guards').toBeGreaterThan(0);

    const emitted = [];
    const feed = new ReplayFeed(game, { speed: 100_000 });
    feed.on('play', (p) => emitted.push(p.id));
    await new Promise((resolve) => { feed.on('end', resolve); feed.start(); });

    // Clamped, not crashed, and nothing lost or repeated.
    expect(emitted).toHaveLength(plays.length);
    expect(new Set(emitted).size).toBe(plays.length);
  });
});
