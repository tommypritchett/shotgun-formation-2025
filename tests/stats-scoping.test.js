/**
 * Phase C — who is allowed into a room's `updatePlayerStats.players` payload.
 *
 * `playerStats` is one global map keyed by socket id across every room on the
 * server. `buildRoomStats` scopes the broadcast to one room, but its fallback
 * for stale entries matched on NAME ALONE:
 *
 *     const belongsToRoom = player || memberNames.has(playerStats[playerId].name);
 *
 * Two different Sunday parties both having a Mike is not exotic. When room B's
 * Mike disconnects the server stamps his name onto his `playerStats` entry
 * (server.js:1742) — and from that moment room A's scoreboard carries him too,
 * because A also has a Mike. The client then resolves players by name and takes
 * the highest `totalDrinks`, so the wrong Mike's score can win.
 *
 * The second test here is the one that matters. Scoping the payload is easy;
 * scoping it WITHOUT breaking the reconnect merge is the actual requirement,
 * and a fix that loses a returning player's totals would be worse than the leak.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('scoreboard scoping', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('keeps another room\'s disconnected same-name player out of this room\'s payload', async () => {
    const roomA = await h.newGame(['Ava', 'Mike', 'Cy']);
    const roomB = await h.newGame(['Bo', 'Mike', 'Dee']);
    const mikeA = roomA.guests[0];
    const mikeB = roomB.guests[0];

    expect(mikeA.name).toBe('Mike');
    expect(mikeB.name).toBe('Mike');

    // Give room B's Mike a score that is impossible to confuse with room A's,
    // then drop him. Disconnecting is what stamps his name onto playerStats.
    const sinceB = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    roomB.assignDrinks(roomB.host, [{ player: mikeB, drinks: 8 }]);
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB);
    expect(h.totalsFor(roomB.host, mikeB.id).totalDrinks).toBe(9);

    await mikeB.disconnect();
    await sleep(400);

    // Now room A finishes a round of its own.
    const sinceA = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA);

    const payload = roomA.host.view.stats;
    expect(payload[mikeB.id], 'room B\'s Mike appears in room A\'s scoreboard')
      .toBeUndefined();

    // Nobody from room B at all, by id or by score.
    const idsInRoomA = new Set(roomA.all.map((p) => p.id));
    expect(Object.keys(payload).filter((id) => !idsInRoomA.has(id))).toEqual([]);
    expect(Object.values(payload).map((s) => s.totalDrinks)).not.toContain(9);

    // Room A's own Mike is present and correct: 1 from his own First Down.
    expect(h.totalsFor(roomA.host, mikeA.id).totalDrinks).toBe(1);
  });

  it('still lets this room\'s own Mike reconnect with his totals intact', async () => {
    // The assertion that stops the leak being "fixed" by breaking reconnection.
    const roomA = await h.newGame(['Ava', 'Mike', 'Cy']);
    const roomB = await h.newGame(['Bo', 'Mike', 'Dee']);
    const mikeA = roomA.guests[0];
    const mikeB = roomB.guests[0];

    // Both Mikes build up a score, deliberately different ones.
    const sinceB = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    roomB.assignDrinks(roomB.host, [{ player: mikeB, drinks: 8 }]);
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB);

    const sinceA1 = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    roomA.assignDrinks(roomA.host, [{ player: mikeA, drinks: 3 }]);
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA1);
    expect(h.totalsFor(roomA.host, mikeA.id).totalDrinks).toBe(4);

    // Room B's Mike drops, so his stale entry is sitting in the global map with
    // the name "Mike" on it while room A's Mike does his own reconnect.
    await mikeB.disconnect();
    await sleep(300);

    await mikeA.disconnect();
    await sleep(400);
    const freshMike = await h.connect('Mike');
    const since = freshMike.mark();
    freshMike.emit('joinRoom', roomA.code, 'Mike');
    await freshMike.waitFor('gameStarted', { since });
    await sleep(500);

    // One more round, so the room broadcasts a scoreboard he is part of.
    const sinceA2 = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA2);

    // 4 from before the drop + 1 for this First Down. Nothing lost.
    expect(h.totalsFor(roomA.host, freshMike.id).totalDrinks).toBe(5);

    // And room B's Mike still is not here — including under his old score.
    const payload = roomA.host.view.stats;
    expect(payload[mikeB.id]).toBeUndefined();
    expect(Object.values(payload).map((s) => s.totalDrinks)).not.toContain(9);
  });
});
