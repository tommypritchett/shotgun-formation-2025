/**
 * Phase 7c.1 — pours must count without anyone confirming anything.
 *
 * The client used to hold every assignment in local state for the whole round
 * and send one batch when the timer hit zero. Anything tapped was therefore
 * still on the phone, and a refresh, a background-kill or a closed tab threw it
 * away. Pours are now flushed to the server as they happen.
 *
 * That only works if the server accumulates across calls rather than replacing.
 * These tests pin that, because it is the assumption the whole change rests on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('incremental pours', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** One tap: a single drink to one player, as the client now sends it. */
  const tap = (from, roomCode, targetId) =>
    from.emit('assignDrinks', {
      roomCode,
      selectedPlayerIds: [targetId],
      drinksToGive: { [targetId]: 1 },
      shotgunsToGive: {},
    });

  it('lands one-at-a-time taps when the timer expires and nobody confirms', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // Four separate emits, exactly like four separate finger-presses.
    for (let i = 0; i < 4; i += 1) {
      tap(room.host, room.code, ben.id);
      await sleep(60);
    }

    // Nothing else is sent. The round simply ends.
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    // 1 from First Down + 4 tapped.
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(5);
  });

  it('accumulates across calls rather than replacing the previous one', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // Two calls of 2 must be 4, not 2.
    room.host.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [ben.id],
      drinksToGive: { [ben.id]: 2 },
      shotgunsToGive: {},
    });
    await sleep(120);
    room.host.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [ben.id],
      drinksToGive: { [ben.id]: 2 },
      shotgunsToGive: {},
    });

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(5); // 1 + 2 + 2
  });

  it('folds every tenth drink into a shotgun as the taps arrive', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // 10 single taps into one player. Tap-at-a-time re-checks the running
    // total every call, so the tenth folds. (A single batch of 10 folds too;
    // a single batch of 20 would only fold ONE ten — see O2 in the overnight
    // report. Tapping is the more correct of the two.)
    for (let i = 0; i < 10; i += 1) {
      tap(room.host, room.code, ben.id);
      await sleep(40);
    }
    tap(cy, room.code, ben.id); // and one from someone else, for good measure

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    const totals = h.totalsFor(room.host, ben.id);
    // 1 (First Down) + 10 tapped = 11 -> folds at 10 -> 1 shotgun + 1 left,
    // plus Cy's 1 = 2 drinks showing.
    expect(totals.totalShotguns).toBe(1);
    expect(totals.totalDrinks).toBe(2);
  });

  it('keeps taps from two different givers separate and correct', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    tap(room.host, room.code, ben.id);
    tap(cy, room.code, ben.id);
    tap(ben, room.code, cy.id);
    await sleep(150);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(3); // 1 + 2 tapped
    expect(h.totalsFor(room.host, cy.id).totalDrinks).toBe(2);  // 1 + 1 tapped
  });
});
