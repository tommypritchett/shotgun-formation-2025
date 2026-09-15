/**
 * How long is a room actually BUSY?
 *
 * Not a guard on behaviour — a measurement, kept as a test so the number is
 * re-derived rather than remembered. `MAX_LATE_MS` is the patience a queued
 * detection gets while a round runs, so whether the feed silently loses calls
 * is entirely a question of "busy window vs 8 seconds", and the busy window
 * had never been measured.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';
import actions from './helpers/game-actions.js';

describe('the real busy window of a round', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  /**
   * Busy is measured to `roundFinalized`, because that is emitted from inside
   * `finalizeRound` at the same moment `isActionInProgress` is cleared — which
   * is the exact instant the room can accept the next detection.
   */
  const measure = async (label, nominal, fire) => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();
    const t0 = Date.now();
    await fire(room);
    await ben.waitFor('updatePlayerStats', {
      since,
      where: (p) => p?.roundFinalized === true,
      timeout: nominal * 1000 + 15000,
    });
    const busyMs = Date.now() - t0;
    console.log(`    ${label.padEnd(11)} nominal ${String(nominal).padStart(2)}s  ->  busy ${busyMs}ms`
      + `  | 8s patience ${busyMs > 8000 ? 'EXCEEDED' : 'survives'}`);
    return busyMs;
  };

  it('measures a First Down round', async () => {
    const ms = await measure('First Down', 6, (room) =>
      room.host.emit('firstDownEvent', { roomCode: room.code }));
    expect(ms).toBeGreaterThan(5000);
  }, 60000);

  it('measures a Standard round — the one that matters', async () => {
    // Uses the harness's own declaration path so this exercises exactly what a
    // Ref tap does, rather than a hand-rolled emit that can silently no-op.
    const ms = await measure('Standard', 21, async (room) => {
      const outcome = await actions.declareStandard(room.host, room.code, 'Touchdown');
      expect(outcome, 'the Standard declaration did not take').toBe('declared');
    });
    expect(ms).toBeGreaterThan(20000);
    // The finding this probe exists for.
    expect(ms, 'a Standard round now fits inside the 8s patience window').toBeGreaterThan(8000);
  }, 90000);
});
