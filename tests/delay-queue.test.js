/**
 * The broadcast delay and the queue.
 *
 * The delay is the single most important number in the feature: fire early and
 * you announce the touchdown before anybody in the room has seen it, which
 * inverts the game. These tests pin the constant, the asymmetry it encodes, and
 * the fact that it is NOT configurable — a Ref who has to set it up before
 * kickoff is being handed back the work this feature exists to remove.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  DetectionQueue, BROADCAST_DELAY_MS, STALE_AFTER_MS, MAX_QUEUE_DEPTH, MAX_LATE_MS,
} = require(path.join(ROOT, 'server/feed/queue.js'));

const card = (cardId, over = {}) => ({ cardId, playId: `p-${cardId}`, reason: 'test', ...over });

/** A queue on a clock the test drives by hand. */
const makeQueue = (options = {}) => {
  const clock = { t: 1_000_000 };
  const queue = new DetectionQueue({ now: () => clock.t, ...options });
  return { queue, clock, advance: (ms) => { clock.t += ms; } };
};

describe('the delay is a constant, not a setting', () => {
  /**
   * Session 19. Was 45s. Dropped to 30s after the first real game: the felt
   * delay is the constant PLUS however long the play took to reach the poller,
   * and 45 + poll read as "over a minute" at the table.
   *
   * 30s is the floor and the owner set it explicitly. Cable is ~38s behind and
   * an early call spoils the play, so the base sits under cable on purpose and
   * the poll lag on top is what carries it back into the safe range.
   */
  it('adds nothing, because the feed already supplies the lag', () => {
    // Measured against three live college games on 2026-09-03: a play becomes
    // visible in ESPN's API a median of 28.5s after it happens (min 14.1s).
    // Adding 45s on top made the real end-to-end delay ~78s, which is what the
    // owner felt at the table. Owner's decision to take it to zero.
    expect(process.env.BROADCAST_DELAY_MS).toBeUndefined();
    expect(BROADCAST_DELAY_MS).toBe(0);
  });

  it('still lets the tests drive it, so the delay path stays exercised', () => {
    // Zero is the shipped value, not a removal of the mechanism. The queue must
    // still hold a detection when it is given a delay.
    const { queue, advance } = makeQueue({ delayMs: 30_000 });
    queue.push([card('Touchdown')]);
    advance(29_000);
    expect(queue.release().due).toEqual([]);
    advance(2_000);
    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Touchdown']);
  });

  it('is not exposed as a per-room or per-Ref option anywhere', () => {
    // If this ever fails, someone has built the settings screen the owner
    // explicitly ruled out. The whole point is that the Ref configures nothing.
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const client = fs.readFileSync(path.join(ROOT, 'client/src/App.js'), 'utf8');
    expect(server).not.toMatch(/setDelay|delaySetting|perRoomDelay/i);
    expect(client).not.toMatch(/broadcastDelay|delayOffset|setDelay/i);
  });
});

describe('holding a detection for the delay', () => {
  it('does not release before the delay has passed', () => {
    const { queue, advance } = makeQueue();
    queue.push([card('Touchdown')]);

    advance(BROADCAST_DELAY_MS - 1);
    expect(queue.release().due).toEqual([]);

    advance(1);
    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Touchdown']);
  });

  it('releases in the order the plays happened', () => {
    const { queue, advance } = makeQueue();
    queue.push([card('Touchdown')]);
    advance(10_000);
    queue.push([card('Sacks')]);
    advance(BROADCAST_DELAY_MS);

    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Touchdown', 'Sacks']);
  });

  it('empties as it releases, so nothing fires twice', () => {
    const { queue, advance } = makeQueue();
    queue.push([card('Field Goal')]);
    advance(BROADCAST_DELAY_MS);
    expect(queue.release().due).toHaveLength(1);
    expect(queue.release().due).toHaveLength(0);
    expect(queue.depth).toBe(0);
  });
});

describe('a detection that went stale', () => {
  it('is dropped rather than fired late', () => {
    // Calling a first down that happened two minutes ago is just confusing.
    const { queue, advance } = makeQueue();
    queue.push([card('First Down')]);
    advance(STALE_AFTER_MS + 1_000);

    const { due, stale } = queue.release();
    expect(due).toEqual([]);
    expect(stale.map((d) => d.cardId)).toEqual(['First Down']);
    expect(queue.snapshot().droppedStale).toBe(1);
  });

  it('does not take the fresh ones with it', () => {
    const { queue, advance } = makeQueue();
    queue.push([card('Touchdown')]);
    advance(STALE_AFTER_MS + 1_000);
    queue.push([card('Sacks')]);
    advance(BROADCAST_DELAY_MS);

    const { due, stale } = queue.release();
    expect(stale.map((d) => d.cardId)).toEqual(['Touchdown']);
    expect(due.map((d) => d.cardId)).toEqual(['Sacks']);
  });
});

describe('a room that is backed up', () => {
  it('stops accepting past the depth limit and counts what it turned away', () => {
    const { queue } = makeQueue();
    for (let i = 0; i < MAX_QUEUE_DEPTH + 5; i += 1) queue.push([card(`Sacks`, { playId: `p${i}` })]);

    expect(queue.depth).toBe(MAX_QUEUE_DEPTH);
    expect(queue.snapshot().droppedFull).toBe(5);
  });

  it('reports both drop counts, so a backed-up room is visible not silent', () => {
    const { queue, advance } = makeQueue({ maxDepth: 2 });
    queue.push([card('Touchdown'), card('Sacks'), card('First Down')]);   // one too many
    // Past the stale window, not merely level with it — the check is a strict
    // `>`. This used to lean on the 45s delay to carry it over the line.
    advance(BROADCAST_DELAY_MS + STALE_AFTER_MS + 1_000);
    queue.release();

    const snap = queue.snapshot();
    expect(snap.droppedFull).toBe(1);
    expect(snap.droppedStale).toBe(2);
    expect(snap).toHaveProperty('depth');
    expect(snap).toHaveProperty('released');
  });
});

describe('a play that produced more than one card', () => {
  it('queues them bigger event first, so a drop loses the small one', () => {
    const { queue, advance } = makeQueue();
    // Deliberately pushed in the wrong order.
    queue.push([card('First Down'), card('Touchdown')]);
    advance(BROADCAST_DELAY_MS);

    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Touchdown', 'First Down']);
  });

  it('drops the First Down rather than the Touchdown when full', () => {
    const { queue } = makeQueue({ maxDepth: 1 });
    const { queued, droppedFull } = queue.push([card('First Down'), card('Touchdown')]);

    expect(queued.map((d) => d.cardId)).toEqual(['Touchdown']);
    expect(droppedFull.map((d) => d.cardId)).toEqual(['First Down']);
  });

  it('releases them to run one after another, not as one round', () => {
    // Two cards, two entries, in order. The caller fires them sequentially
    // through the existing declaration path; there is no multi-card round.
    const { queue, advance } = makeQueue();
    queue.push([card('Penalty'), card('First Down')]);
    advance(BROADCAST_DELAY_MS);

    const { due } = queue.release();
    expect(due).toHaveLength(2);
    expect(due.map((d) => d.cardId)).toEqual(['Penalty', 'First Down']);
  });
});

describe('the Ref taking over', () => {
  it('clears what was waiting, so the table is not told about an old play', () => {
    const { queue } = makeQueue();
    queue.push([card('Touchdown'), card('First Down')]);
    const { dropped } = queue.clear();

    expect(dropped).toBe(2);
    expect(queue.depth).toBe(0);
    expect(queue.release().due).toEqual([]);
  });
});

describe('malformed input', () => {
  it('ignores rubbish rather than queueing it', () => {
    const { queue } = makeQueue();
    queue.push([null, undefined, {}, { noCardId: true }, 'nonsense']);
    expect(queue.depth).toBe(0);
  });

  it('accepts a single detection as well as a list', () => {
    const { queue, advance } = makeQueue();
    queue.push(card('Safety'));
    advance(BROADCAST_DELAY_MS);
    expect(queue.release().due.map((d) => d.cardId)).toEqual(['Safety']);
  });
});


/**
 * Session 19 — why a busy room no longer loses the call outright.
 *
 * A detection that came due while a round was running used to be dropped on
 * the spot. First Down is ~40 of the ~70 calls in a game and a First Down
 * round is only 6 seconds, so in any busy stretch it was the card most often
 * thrown away — measured at 82% fire rate under hurry-up pacing, against 100%
 * at a normal snap pace.
 *
 * It now gets a short grace window and is re-offered on the next tick. The
 * window is deliberately small: the point of the delay is that a call lands
 * when the play appears on television, and something that cannot fire within a
 * few seconds of its moment is still better lost than fired a minute late.
 */
describe('a busy room gets a short grace window, not an instant drop', () => {
  it('re-offers a detection the room could not take yet', () => {
    const { queue, clock, advance } = makeQueue();
    queue.push([card('First Down')]);
    advance(BROADCAST_DELAY_MS);

    const first = queue.release();
    expect(first.due).toHaveLength(1);

    // The room was busy. Hand it back.
    const held = queue.retry(first.due[0], clock.t);
    expect(held).toBe(true);
    expect(queue.depth).toBe(1);

    advance(2_000);
    expect(queue.release().due.map((d) => d.cardId)).toEqual(['First Down']);
  });

  it('gives up once the grace window has passed, rather than firing late', () => {
    const { queue, clock, advance } = makeQueue();
    queue.push([card('First Down')]);
    advance(BROADCAST_DELAY_MS);
    const [item] = queue.release().due;

    advance(MAX_LATE_MS + 1);
    expect(queue.retry(item, clock.t)).toBe(false);
    expect(queue.depth).toBe(0);
    expect(queue.snapshot().droppedLate).toBe(1);
  });

  it('never lets the grace window push a call far past its moment', () => {
    // The whole feature rests on a call landing when the play reaches the TV.
    expect(MAX_LATE_MS).toBeLessThanOrEqual(10_000);
  });

  it('counts a late drop separately, so a backed-up room is visible', () => {
    const { queue, clock, advance } = makeQueue();
    queue.push([card('Penalty')]);
    advance(BROADCAST_DELAY_MS);
    const [item] = queue.release().due;
    advance(MAX_LATE_MS + 1);
    queue.retry(item, clock.t);

    const snap = queue.snapshot();
    expect(snap.droppedLate).toBe(1);
    expect(snap.droppedStale).toBe(0);
  });
});
