/**
 * Taking a pour back.
 *
 * Reported from play: "unless it is like 1 second after, you can not undo who
 * you click to give a drink to."
 *
 * That was by design and the design was wrong. Undo only reached taps that had
 * not yet been flushed to the server (~700ms), because a compensating negative
 * was judged unsafe: `assignDrinks` folds every ten drinks into a shotgun AS IT
 * ACCUMULATES, so a -1 arriving after a fold left the recipient on 1 shotgun
 * and MINUS ONE drinks.
 *
 * The fix is to make the negative safe rather than to avoid it: borrow back
 * from a shotgun instead of leaving a negative drink count beside one. Then
 * undo can work for the whole round.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('undoing a pour', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** A delta, positive or negative, exactly as the client now sends one. */
  const pour = (from, roomCode, targetId, drinks) =>
    from.emit('assignDrinks', {
      roomCode,
      selectedPlayerIds: [targetId],
      drinksToGive: { [targetId]: drinks },
      shotgunsToGive: {},
    });

  it('takes a plain drink back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    pour(room.host, room.code, ben.id, 3);
    await sleep(120);
    pour(room.host, room.code, ben.id, -1);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    // 1 from First Down + 3 poured - 1 taken back.
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(3);
  });

  it('borrows back from a shotgun instead of going negative', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // Push Ben to exactly the fold: 1 (First Down) + 9 = 10 -> 1 shotgun, 0 drinks.
    pour(room.host, room.code, ben.id, 9);
    await sleep(150);
    // Now take one back. The naive result is 1 shotgun and MINUS ONE drinks.
    pour(room.host, room.code, ben.id, -1);
    await sleep(150);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    const totals = h.totalsFor(room.host, ben.id);
    // 9 drinks total: no shotgun, nine loose.
    expect(totals.totalShotguns, 'kept a shotgun that was undone').toBe(0);
    expect(totals.totalDrinks, 'left a negative drink count').toBe(9);
  });

  it('never drives a player below zero', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    pour(room.host, room.code, ben.id, 2);
    await sleep(120);
    pour(room.host, room.code, ben.id, -5);   // more back than was ever given

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    const totals = h.totalsFor(room.host, ben.id);
    expect(totals.totalDrinks).toBeGreaterThanOrEqual(0);
    expect(totals.totalShotguns).toBeGreaterThanOrEqual(0);
  });

  it('undoing everything leaves only what the round itself gave', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    pour(room.host, room.code, ben.id, 4);
    await sleep(120);
    pour(room.host, room.code, ben.id, -4);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(1); // the First Down only
  });

  it('does not disturb anyone else when one pour is taken back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    pour(room.host, room.code, ben.id, 2);
    pour(room.host, room.code, cy.id, 3);
    await sleep(150);
    pour(room.host, room.code, ben.id, -2);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(1); // 1 + 2 - 2
    expect(h.totalsFor(room.host, cy.id).totalDrinks).toBe(4);  // 1 + 3, untouched
  });
});
