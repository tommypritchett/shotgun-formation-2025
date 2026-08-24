/**
 * One malformed message must not end everybody's night.
 *
 * A single process hosts every concurrent game, and there was no
 * `uncaughtException` handler, no `unhandledRejection` handler, and no
 * try/catch in any socket handler — so any throw in any handler killed every
 * game on the box. That is the same blast radius as the `startGame` crash this
 * whole branch exists to fix.
 *
 * These are not security tests. It is a party game among friends; the goal is
 * that a bad payload fails ONE ACTION instead of ending the night.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('surviving malformed messages', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); });

  /** After the abuse, can an untouched room still finish a round? */
  const stillPlayable = async (room) => {
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    for (const p of room.all) {
      expect(h.totalsFor(room.host, p.id).totalDrinks).toBeGreaterThanOrEqual(1);
    }
  };

  it('survives assignDrinks with no selectedPlayerIds', async () => {
    const victim = await h.newGame(['Ava', 'Ben', 'Cy']);
    const bystander = await h.newGame(['Dee', 'Eli', 'Fay']);

    victim.host.emit('assignDrinks', { roomCode: victim.code });
    victim.host.emit('assignDrinks', { roomCode: victim.code, selectedPlayerIds: null });
    victim.host.emit('assignDrinks', { roomCode: victim.code, selectedPlayerIds: [42, null] });
    await sleep(500);

    expect(h.crashed(), 'the server died on a malformed assignDrinks').toBeNull();
    await stillPlayable(bystander);
  });

  it('survives wildCardSwap with no discardedCard', async () => {
    const victim = await h.newGame(['Ava', 'Ben', 'Cy']);
    const bystander = await h.newGame(['Dee', 'Eli', 'Fay']);

    victim.guests[0].emit('wildCardSwap', { roomCode: victim.code });
    victim.guests[0].emit('wildCardSwap', { roomCode: victim.code, discardedCard: null });
    victim.guests[0].emit('wildCardSwap', { roomCode: victim.code, discardedCard: 'nonsense' });
    await sleep(500);

    expect(h.crashed(), 'the server died on a malformed wildCardSwap').toBeNull();
    await stillPlayable(bystander);
  });

  it('survives every destructuring handler being sent no payload at all', async () => {
    const victim = await h.newGame(['Ava', 'Ben', 'Cy']);
    const bystander = await h.newGame(['Dee', 'Eli', 'Fay']);

    for (const event of [
      'assignNewHost', 'nextQuarter', 'wildCardSwap', 'firstDownEvent',
      'playStandardCard', 'wildCardSelected', 'wildCardConfirmed',
      'assignDrinks', 'leaveGame', 'requestGameState', 'requestRefresh',
    ]) {
      victim.host.emit(event);
      victim.host.emit(event, undefined);
      victim.host.emit(event, null);
    }
    await sleep(800);

    expect(h.crashed(), 'the server died on an empty payload').toBeNull();
    await stillPlayable(bystander);
  });

  it('survives a malformed payload that only detonates on the round timer', async () => {
    // Several of these blow up seconds later inside startTimer's interval,
    // where nothing in the log connects them to the emit that caused them.
    const victim = await h.newGame(['Ava', 'Ben', 'Cy']);
    const bystander = await h.newGame(['Dee', 'Eli', 'Fay']);

    const since = victim.host.mark();
    expect(await victim.declareFirstDown()).toBe('declared');
    victim.host.emit('assignDrinks', {
      roomCode: victim.code,
      selectedPlayerIds: [victim.guests[0].id],
      drinksToGive: 'not an object',
      shotgunsToGive: 7,
    });

    await victim.waitForFinalize(victim.host, h.ROUND_SECONDS.firstDown, since)
      .catch(() => { /* the round may not finalize; the point is the process */ });
    await sleep(500);

    expect(h.crashed(), 'the server died inside the round timer').toBeNull();
    await stillPlayable(bystander);
  }, 60_000);
});
