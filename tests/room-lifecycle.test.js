/**
 * Items 1 & 2 — a room belongs to the table, not to the host.
 *
 * THE OLD RULE, in four places: the host leaving closes the room. In the lobby
 * `leaveRoom` emitted `hostLeft` and deleted it outright; on disconnect the
 * same; `leaveGame` deleted it as soon as the last player walked. In a bar that
 * is exactly wrong. The person who made the room is the person most likely to
 * put their phone down, hand it to someone, or walk outside — and when they do,
 * nine other people lose a game in progress with no way back.
 *
 * THE NEW RULE, one sentence: a room closes when NOBODY has been active in it
 * for `ROOM_IDLE_TIMEOUT_MS`. Not when the host leaves. Not when the last
 * player leaves. Only when the whole table has been gone for half an hour.
 *
 * The idle window is read from the environment so these tests can run against
 * the real reaper on a short clock instead of keeping a second copy of the
 * production number.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Short enough for a test, long enough not to race a normal handshake. */
const IDLE_MS = 3000;
const REAP_MS = 300;

describe('a room outlives its host', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('keeps the lobby open when the host walks out before kickoff', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = ben.mark();
    room.host.emit('leaveRoom', room.code);

    // The whistle moves to somebody who is actually here...
    const { newHostId } = await ben.waitFor('newHost', { since });
    expect([ben.id, room.guests[1].id]).toContain(newHostId);

    // ...and the room is still real: a latecomer can walk in.
    const dee = await h.connect('Dee');
    expect(await h.validateAndJoinRoom(dee, room.code)).toBe('lobby');
  });

  it('keeps a game in progress running when the host leaves', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = ben.mark();
    room.host.emit('leaveGame', { roomCode: room.code });
    const { newHostId } = await ben.waitFor('newHost', { since });

    // Whoever holds it now can still run a round, which is the only proof that
    // matters — the game did not just survive, it still works.
    const newRef = [ben, cy].find((p) => p.id === newHostId);
    expect(newRef, 'the whistle went to a player who is not here').toBeTruthy();

    const roundSince = newRef.mark();
    expect(await h.declareFirstDown(newRef, room.code)).toBe('declared');
    await h.waitForRoundFinalized(newRef, h.ROUND_SECONDS.firstDown, roundSince);
    expect(h.totalsFor(newRef, ben.id).totalDrinks).toBe(1);
  });

  it('stays open after the last player leaves, so they can come back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const p of room.all) p.emit('leaveGame', { roomCode: room.code });
    await sleep(600);

    const ava = await h.connect('Ava');
    expect(await h.validateAndJoinRoom(ava, room.code)).not.toBe('notFound');
  });

  it('survives every player dropping their connection', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const p of room.all) await p.disconnect();
    await sleep(600);

    const ava = await h.connect('Ava');
    expect(await h.validateAndJoinRoom(ava, room.code)).not.toBe('notFound');
  });
});

describe('the idle reaper', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({
      env: { ROOM_IDLE_TIMEOUT_MS: String(IDLE_MS), ROOM_REAP_INTERVAL_MS: String(REAP_MS) },
    });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('closes a room nobody has touched for the whole window', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const p of room.all) await p.disconnect();

    await sleep(IDLE_MS + REAP_MS * 3);

    const ava = await h.connect('Ava');
    expect(await h.validateAndJoinRoom(ava, room.code)).toBe('notFound');
  }, 30_000);

  it('leaves a room alone while anyone is still connected', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    await ben.disconnect();
    await cy.disconnect();

    // Only the host is left, sitting idle. Long past the window, the room is
    // still theirs: "active" means connected, not busy.
    await sleep(IDLE_MS * 2);

    const dee = await h.connect('Dee');
    expect(await h.validateAndJoinRoom(dee, room.code)).not.toBe('notFound');
  }, 30_000);

  it('restarts the clock when somebody comes back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const p of room.all) await p.disconnect();

    await sleep(IDLE_MS * 0.6);
    const ava = await h.connect('Ava');
    expect(await h.validateAndJoinRoom(ava, room.code)).not.toBe('notFound');

    // Past the ORIGINAL deadline, with Ava present. The room must not be reaped
    // on a clock that started before she returned.
    await sleep(IDLE_MS * 0.7);
    const ben = await h.connect('Ben');
    expect(await h.validateAndJoinRoom(ben, room.code)).not.toBe('notFound');
  }, 30_000);
});
