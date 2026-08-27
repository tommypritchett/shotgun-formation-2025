/**
 * Item 2 / FOLLOW_UPS F1 — `gameStarted` shipped every room's stats to every
 * client.
 *
 * Four sites sent the module-global `playerStats` map verbatim. Two costs:
 *
 *  - Another game's players land inside your client's state. `App.js` writes
 *    the `gameStarted` payload straight into its own `playerStats` with no name
 *    filter, and the scoreboard's name resolution then reads them.
 *  - The payload grows with every game the server has ever hosted. Outside
 *    teardown, `playerStats` has no per-room deletion, so on a long-lived
 *    instance this is what eventually makes joining hang on a phone — and it
 *    would be diagnosed as a network problem.
 *
 * `buildRoomStats(room)` already existed, was already tested, and is already
 * the shape the client expects; it is what `updatePlayerStats` uses. This just
 * points the four `gameStarted` sites at it too.
 *
 * Open since Session 8 and deferred each time, correctly — it is the last thing
 * making another game's data visible inside a client, and this is the last
 * session before the deploy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The ids a `gameStarted` payload claims to know about. */
const statsIds = (payload) => Object.keys(payload?.playerStats || {});

describe('gameStarted carries one room', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('does not put room B in room A\'s kickoff payload', async () => {
    // B first, so its players are already sitting in the global map when A
    // starts. That ordering is the whole test.
    const roomB = await h.newGame(['Bo', 'Dee', 'Eli']);
    const roomA = await h.newRoom(['Ava', 'Ben', 'Cy']);

    const since = roomA.host.mark();
    roomA.host.emit('startGame', roomA.code);
    const started = await roomA.host.waitFor('gameStarted', { since });

    const idsInA = new Set(roomA.all.map((p) => p.id));
    const idsInB = new Set(roomB.all.map((p) => p.id));

    expect(statsIds(started).filter((id) => idsInB.has(id)),
      "room B's players are in room A's gameStarted payload").toEqual([]);
    expect(statsIds(started).every((id) => idsInA.has(id)),
      'the payload contains ids from neither room').toBe(true);
  });

  it('keeps a reconnecting player\'s payload to their own room', async () => {
    const roomB = await h.newGame(['Bo', 'Dee', 'Eli']);
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = roomA.guests;

    await ben.disconnect();
    await sleep(400);

    const back = await h.connect('Ben');
    const since = back.mark();
    back.emit('joinRoom', roomA.code, 'Ben');
    const started = await back.waitFor('gameStarted', { since });

    const idsInB = new Set(roomB.all.map((p) => p.id));
    expect(statsIds(started).filter((id) => idsInB.has(id))).toEqual([]);
  });

  it('keeps the requestGameState wake-up to their own room too', async () => {
    const roomB = await h.newGame(['Bo', 'Dee', 'Eli']);
    const roomA = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = roomA.guests;

    const since = ben.mark();
    ben.emit('requestGameState', { roomCode: roomA.code, playerName: 'Ben' });
    const started = await ben.waitFor('gameStarted', { since });

    const idsInB = new Set(roomB.all.map((p) => p.id));
    expect(statsIds(started).filter((id) => idsInB.has(id))).toEqual([]);
  });

  it('still tells a player about everyone in their OWN room', async () => {
    // The assertion that stops the leak being "fixed" by sending nothing.
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);

    const since = room.host.mark();
    room.host.emit('startGame', room.code);
    const started = await room.host.waitFor('gameStarted', { since });

    const ids = statsIds(started).sort();
    expect(ids).toEqual(room.all.map((p) => p.id).sort());
    for (const player of room.all) {
      expect(started.playerStats[player.id].name).toBe(player.name);
      expect(started.playerStats[player.id].totalDrinks).toBe(0);
    }
  });

  it('does not grow with rooms the server has hosted since', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    for (let i = 0; i < 3; i += 1) await h.newGame([`H${i}`, `I${i}`, `J${i}`]);

    const since = room.host.mark();
    room.host.emit('startGame', room.code);
    const started = await room.host.waitFor('gameStarted', { since });

    expect(statsIds(started)).toHaveLength(3);
  }, 60_000);
});
