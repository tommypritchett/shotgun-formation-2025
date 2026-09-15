/**
 * What the Ref can see when the feed loses a call.
 *
 * A Penalty went missing in a real game and left no trace anywhere: Penalty is
 * auto, so there was no prompt; it was dropped for being late, so there was no
 * feed line; and the three drop counters the queue has kept since Session 15
 * were never read by the server or the client.
 *
 * Session 15 explicitly required surfacing those counters. That requirement was
 * never met — checked before this was written, and `droppedStale`,
 * `droppedFull` and `droppedLate` appeared nowhere outside queue.js.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DetectionQueue, MAX_LATE_MS } = require(path.join(ROOT, 'server/feed/queue.js'));
const { runPipeline } = require(path.join(ROOT, 'server/feed/pipeline.js'));
const { EventEmitter } = require('node:events');

describe('a call that is given up on says so', () => {
  /** A feed that emits nothing; the queue is driven directly. */
  const fakeFeed = () => {
    const f = new EventEmitter();
    f.start = () => {};
    f.stop = () => {};
    return f;
  };

  it('calls onGiveUp once the grace window has closed, not before', () => {
    let now = 0;
    const clock = () => now;
    const timers = [];
    const onGiveUp = vi.fn();
    // Every release is refused, as though the room were permanently mid-round.
    const onRelease = () => false;

    const feed = fakeFeed();
    runPipeline(feed, { onRelease, onGiveUp }, {
      queue: { now: clock, delayMs: 0 },
      setInterval: (fn) => { timers.push(fn); return { unref() {} }; },
      clearInterval: () => {},
    });
    expect(timers.length, 'the pipeline did not start a tick').toBeGreaterThan(0);
    const tick = timers[0];

    // A detection arrives, becomes due immediately (delayMs 0), and every
    // release is refused — the room is permanently mid-round.
    feed.emit('play', {
      id: 'p1', sequence: 1, typeText: 'Penalty', text: 'PENALTY on IND, Holding, 10 yards, enforced.',
      period: { number: 1 },
    });

    tick();
    // Still inside the grace window: it is re-offered, and NOT announced —
    // a "lost" line followed by the round itself would read as a bug.
    expect(onGiveUp, 'announced a loss while it could still fire').not.toHaveBeenCalled();

    now += MAX_LATE_MS + 1;
    tick();
    expect(onGiveUp, 'the detection was dropped silently').toHaveBeenCalled();
    expect(onGiveUp.mock.calls[0][1]).toMatch(/busy/i);
  });

  it('retry refuses once the item is past its grace window', () => {
    let now = 0;
    const q = new DetectionQueue({ now: () => now, delayMs: 0 });
    q.push([{ cardId: 'Penalty', playId: 'p1', reason: 'penalty' }]);
    const [item] = q.release().due;

    now += MAX_LATE_MS - 1;
    expect(q.retry(item, now), 'gave up while still inside the window').toBe(true);

    const [again] = q.release(now).due;
    now += 2;
    expect(q.retry(again, now), 'held on past the window').toBe(false);
    expect(q.snapshot().droppedLate).toBe(1);
  });

  it('counts the drop so a backed-up room is measurable', () => {
    let now = 0;
    const q = new DetectionQueue({ now: () => now, delayMs: 0 });
    q.push([{ cardId: 'First Down', playId: 'p1', reason: 'x' }]);
    const [item] = q.release().due;
    now += MAX_LATE_MS + 1;
    q.retry(item, now);
    const snap = q.snapshot();
    expect(snap.droppedLate).toBe(1);
    // The counters the Ref is now shown.
    expect(snap).toHaveProperty('droppedStale');
    expect(snap).toHaveProperty('droppedFull');
  });
});

describe('the measured busy windows are what the grace window is judged against', () => {
  // Measured in tests/round-duration-probe.test.js against a real server.
  const MEASURED = { firstDown: 7014, standard: 22037 };

  it('covers a First Down round', () => {
    expect(MAX_LATE_MS).toBeGreaterThan(MEASURED.firstDown);
  });

  it('does NOT cover a Standard round, and that is deliberate', () => {
    // A call held through a 22s round lands ~54s after its play once the 10s
    // broadcast delay is added — past cable entirely. It is dropped on purpose;
    // what changed in Session 20 is that the drop is now announced.
    expect(MAX_LATE_MS).toBeLessThan(MEASURED.standard);
  });
});
