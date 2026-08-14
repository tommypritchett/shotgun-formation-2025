/**
 * Phase 1 — two games must be able to run at the same time.
 *
 * The real usage pattern is a dozen groups all starting at 1pm on a Sunday, so
 * every assertion here is about one room being unable to damage another.
 *
 * These tests were written to FAIL against the pre-fix server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A card that exists in the game but can never be in a Standard hand. */
const NEVER_IN_STANDARD_HAND = 'Safety';

describe('concurrent games', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    // A crashed server makes every socket go quiet; never let that read as a pass.
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('keeps Room A\'s stats and round intact when Room B starts a game', async () => {
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = roomA.guests;

    // Declare a card the host is definitely holding, so the host is a drink-giver.
    const cardType = roomA.host.view.hand.standard[0].card;
    const sinceA = roomA.host.mark();
    expect(await roomA.declareStandard(cardType)).toBe('declared');

    const parcel = await roomA.host.waitFor('distributeDrinks', { since: sinceA });
    const drinks = parcel.drinkCount ?? 0;
    const shotguns = parcel.shotguns ?? 0;
    expect(drinks + shotguns).toBeGreaterThan(0);

    // The host pours everything into Ben.
    roomA.assignDrinks(roomA.host, [{ player: ben, drinks, shotguns }]);

    // ── Meanwhile, an unrelated group starts their own game. ──
    const roomB = await h.newGame(['Dee', 'Eli', 'Fay']);

    // Room A must still be able to finish its round.
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.standard, sinceA);

    const benTotals = h.totalsFor(roomA.host, ben.id);
    expect(benTotals).toEqual({ totalDrinks: drinks, totalShotguns: shotguns });

    // And Room B must be unharmed: everyone still holding a full hand.
    for (const player of roomB.all) {
      expect(player.view.hand.standard).toHaveLength(5);
      expect(player.view.hand.wild).toHaveLength(2);
    }
  });

  it('lets Room B declare while Room A has a round open', async () => {
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const roomB = await h.newGame(['Dee', 'Eli', 'Fay']);

    // First Down needs no card in hand, so this isolates the round lock itself.
    expect(await roomA.declareFirstDown()).toBe('declared');

    const sinceB = roomB.host.mark();
    const sinceGuest = roomB.guests[0].mark();
    const outcome = await roomB.declareFirstDown();

    expect(outcome).toBe('declared');
    expect(roomB.host.saw('actionInProgress', sinceB)).toBe(false);

    // Room B's players must actually be shown the round, not just its host.
    await roomB.guests[0].waitFor('declaredCard', {
      since: sinceGuest,
      where: (c) => c === 'First Down',
    });
  });

  it('leaves no phantom round behind when nobody holds the declared card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    expect(await room.declareStandard(NEVER_IN_STANDARD_HAND)).toBe('noCard');

    // Observable consequence of a stale activeRounds entry: a player who drops
    // and comes back is told a round is live and shown a card that was never played.
    const ben = room.guests[0];
    await ben.disconnect();
    await sleep(200);

    const rejoined = await h.connect('Ben');
    const since = rejoined.mark();
    rejoined.emit('joinRoom', room.code, 'Ben');
    await rejoined.waitFor('gameStarted', { since });
    await sleep(400);

    expect(rejoined.received('declaredCard', since)).toEqual([]);
    expect(rejoined.saw('roundState', since)).toBe(false);

    // And the room lock must be free for the next real declaration.
    const sinceHost = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    expect(room.host.saw('actionInProgress', sinceHost)).toBe(false);
  });

  it('runs six games at once and keeps every scoreboard separate', async () => {
    // The actual usage pattern: a pile of groups all kicking off at 1pm.
    const rooms = await Promise.all(
      Array.from({ length: 6 }, (_, i) => h.newGame([`Host${i}`, `Guest${i}`, `Sub${i}`]))
    );

    const marks = rooms.map((room) => room.host.mark());
    await Promise.all(rooms.map((room) => room.declareFirstDown()));

    // Each room pours a different amount, so a leak would be unmistakable.
    rooms.forEach((room, i) => {
      room.assignDrinks(room.host, [{ player: room.guests[0], drinks: i + 1 }]);
    });

    await Promise.all(
      rooms.map((room, i) => room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, marks[i]))
    );

    rooms.forEach((room, i) => {
      // 1 from First Down + the (i+1) this room poured.
      expect(h.totalsFor(room.host, room.guests[0].id).totalDrinks).toBe(1 + i + 1);
      expect(h.totalsFor(room.host, room.host.id).totalDrinks).toBe(1);

      const ownIds = new Set(room.all.map((p) => p.id));
      const strangers = Object.keys(room.host.view.stats).filter((id) => !ownIds.has(id));
      expect(strangers, `room ${i} sees players from another game`).toEqual([]);
    });
  }, 120_000);

  it('does not disturb another room\'s open round when a player drops', async () => {
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const roomB = await h.newGame(['Dee', 'Eli', 'Fay']);

    const sinceB = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');

    // The disconnect handler walks every room on the server, so a drop in one
    // game is a plausible way to corrupt another game's round.
    await roomA.host.disconnect();
    await roomA.guests[0].disconnect();

    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB);
    for (const player of roomB.all) {
      expect(h.totalsFor(roomB.host, player.id).totalDrinks).toBe(1);
    }
  });

  it('does not leak one room\'s players into another room\'s scoreboard', async () => {
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const roomB = await h.newGame(['Dee', 'Eli', 'Fay']);

    const sinceA = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA);

    const idsInRoomA = new Set(roomA.all.map((p) => p.id));
    const idsInScoreboard = Object.keys(roomA.host.view.stats);
    const strangers = idsInScoreboard.filter((id) => !idsInRoomA.has(id));

    expect(strangers).toEqual([]);
    expect(roomB.all.every((p) => !idsInScoreboard.includes(p.id))).toBe(true);
  });
});
