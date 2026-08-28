/**
 * A socket that reconnects while the page survives must rejoin the room.
 *
 * There are two reconnect paths and only one of them worked:
 *
 *   page RELOAD          -> validateAndJoinRoom -> handleJoinRoom -> socket.join  ✅
 *   socket reconnects,
 *   page still in memory -> requestGameState    -> never joined the room          ❌
 *
 * Every reconnect test to date used refresh, which takes the healthy path. A
 * phone locked briefly, a laptop sleeping, or wifi dropping with the screen on
 * takes the other one — and that is the single most common thing that happens
 * to a phone at a party.
 *
 * Socket.IO room membership belongs to a CONNECTION. A reconnect is a new
 * socket with a new id and zero rooms, so it has to be re-joined explicitly.
 *
 * The player still gets direct emits (a socket always belongs to a room named
 * after its own id), so `roundState` and the pour replay arrive and the screen
 * looks right for a moment. Then every `io.to(roomCode)` broadcast stops: no
 * timer, no declaredCard, no updatePlayerStats, no roundFinalized. Their clock
 * freezes and, because `assignerOpen` never goes false, their assigner stays
 * open for the rest of the game.
 *
 * These assert on THE BROADCAST BEING RECEIVED, not on a line existing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('reconnecting without reloading the page', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** The path a phone takes when it wakes up: new socket, same page. */
  const wakeUp = async (room, name) => {
    const fresh = await h.connect(name);
    const since = fresh.mark();
    fresh.emit('requestGameState', { roomCode: room.code, playerName: name });
    await sleep(800);
    return { fresh, since };
  };

  it('receives the room broadcasts again afterwards', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await ben.disconnect();
    await sleep(300);
    const { fresh, since } = await wakeUp(room, 'Ben');

    // The whole point: a broadcast, not a direct emit.
    const roundSince = fresh.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    await fresh.waitFor('declaredCard', {
      since: roundSince,
      where: (c) => c === 'First Down',
      timeout: 6000,
    });
    await fresh.waitFor('updateTimer', { since: roundSince, timeout: 6000 });
    await room.waitForFinalize(fresh, h.ROUND_SECONDS.firstDown, roundSince);

    expect(fresh.saw('updatePlayerStats', since), 'never saw a room broadcast').toBe(true);
  });

  it('does not freeze the clock for a woken phone', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await ben.disconnect();
    await sleep(300);
    const { fresh } = await wakeUp(room, 'Ben');

    // The round must visibly end for them, which is what stops the assigner
    // hanging open for the rest of the game.
    await room.waitForFinalize(fresh, h.ROUND_SECONDS.firstDown, since);
    // Their seat is keyed by the NEW socket id now; `ben.id` is the dead one.
    expect(h.totalsFor(fresh, fresh.id).totalDrinks).toBe(1);
  });

  it('gives each sleeping phone back its OWN seat, not the first one listed', async () => {
    // Two players let their phones lock during the same round. Whichever wakes
    // first used to be handed possibleFormerPlayers[0] — somebody else's name,
    // hand and totals — and the second was refused with "name already taken".
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    // Give them different totals so a swap is unmistakable.
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    room.assignDrinks(room.host, [{ player: ben, drinks: 5 }]);
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(6);
    expect(h.totalsFor(room.host, cy.id).totalDrinks).toBe(1);

    await ben.disconnect();
    await cy.disconnect();
    await sleep(500);

    // Cy wakes first, then Ben.
    const cyBack = await wakeUp(room, 'Cy');
    const benBack = await wakeUp(room, 'Ben');

    expect(cyBack.fresh.saw('error', cyBack.since), 'Cy was refused').toBe(false);
    expect(benBack.fresh.saw('error', benBack.since), 'Ben was locked out of his own game').toBe(false);

    // Each got their own totals back, not the other's.
    await sleep(400);
    expect(h.totalsFor(cyBack.fresh, cyBack.fresh.id).totalDrinks, 'Cy was given the wrong seat')
      .toBe(1);
    expect(h.totalsFor(benBack.fresh, benBack.fresh.id).totalDrinks, 'Ben was given the wrong seat')
      .toBe(6);
  });

  it('still works through the page-reload path (regression guard)', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await ben.disconnect();
    await sleep(300);
    const fresh = await h.connect('Ben');
    const since = fresh.mark();
    expect(await h.validateAndJoinRoom(fresh, room.code)).toBe('game');

    const roundSince = fresh.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(fresh, h.ROUND_SECONDS.firstDown, roundSince);
    expect(fresh.saw('updatePlayerStats', since)).toBe(true);
  });
});
