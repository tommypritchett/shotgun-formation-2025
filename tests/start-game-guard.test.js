/**
 * `startGame` was the last unguarded room-wide handler, and the worst one.
 *
 * It had no host check and no "already started" check, and its body deletes
 * and re-initialises `playerStats` for every player in the room — so ANY
 * client in a live game could emit it and wipe the whole table's totals,
 * redeal every hand, reset the quarter to 1 and hand out fresh swap
 * allowances. Not a privilege bug that leaks information: a bug that erases
 * the game everyone is playing.
 *
 * Two guards, deliberately, because either alone is not enough:
 *   - Ref-only, matching `nextQuarter` and `removePlayer`.
 *   - Refused outright once `gameStarted` is set. Restarting a live game
 *     should not be reachable BY ACCIDENT, and the Ref is exactly who has a
 *     Start button on screen at the moment a stale render could fire it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everyone's running totals, as the table sees them. */
const totals = (player) => {
  const stats = player.view.stats || {};
  return Object.values(stats)
    .map((s) => `${s.name}:${s.totalDrinks || 0}/${s.totalShotguns || 0}`)
    .sort()
    .join(',');
};

describe('starting a game', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('cannot be re-run by a player mid-game, and totals survive', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    // Put real drinks on the board so a wipe is visible. First Down gives
    // everyone exactly one and needs no assignment step, so the totals are
    // non-zero without depending on who held which card.
    const roundSince = room.host.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await room.host.waitFor('updatePlayerStats', {
      since: roundSince, timeout: 15_000, where: (p) => p && p.roundFinalized,
    });
    await sleep(400);
    const before = totals(room.host);
    expect(before, 'no totals were recorded, so this test proves nothing')
      .toMatch(/[1-9]/);

    const since = ben.mark();
    ben.emit('startGame', room.code);
    await sleep(1200);

    expect(ben.saw('gameStarted', since), 'a player restarted a live game').toBe(false);
    expect(totals(room.host), 'the scoreboard was wiped by a player').toBe(before);
    expect(totals(cy), 'the scoreboard was wiped by a player').toBe(before);
  }, 60_000);

  it('cannot be re-run by the REF mid-game either', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const roundSince = room.host.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await room.host.waitFor('updatePlayerStats', {
      since: roundSince, timeout: 15_000, where: (p) => p && p.roundFinalized,
    });
    await sleep(400);
    const before = totals(room.host);
    expect(before, 'no totals were recorded, so this test proves nothing').toMatch(/[1-9]/);

    const since = ben.mark();
    room.host.emit('startGame', room.code);
    await sleep(1200);

    expect(ben.saw('gameStarted', since), 'the Ref restarted a live game by accident')
      .toBe(false);
    expect(totals(room.host), 'the Ref wiped the scoreboard').toBe(before);
  }, 60_000);

  it('still lets the Ref start a game that has not started', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('startGame', room.code);
    const started = await ben.waitFor('gameStarted', { since, timeout: 8000 });
    expect(started).toHaveProperty('hands');
  }, 30_000);

  it('refuses a player without the whistle starting the game at all', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    ben.emit('startGame', room.code);
    await sleep(1200);
    expect(ben.saw('gameStarted', since), 'a player without the whistle started the game')
      .toBe(false);

    // ...and the Ref can still do it, so the room is not stuck.
    const since2 = ben.mark();
    room.host.emit('startGame', room.code);
    const started = await ben.waitFor('gameStarted', { since: since2, timeout: 8000 });
    expect(started).toHaveProperty('hands');
  }, 30_000);

  it('survives nonsense without taking the server down', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    room.host.emit('startGame');
    room.host.emit('startGame', null);
    room.host.emit('startGame', 'ZZZZZ');
    room.host.emit('startGame', { roomCode: room.code });
    await sleep(900);
    h.assertAlive();
  }, 30_000);
});
