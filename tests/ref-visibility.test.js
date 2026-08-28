/**
 * Everyone must be able to see who the Ref is.
 *
 * Reported as a rejoin bug. It is not. `App.js` had:
 *
 *     isRef: player.id === socket.id && isHost
 *
 * `isHost` is a boolean about YOU and `player.id === socket.id` is only true
 * for your OWN row — so the REF badge could only ever render on your own row,
 * and only when you were the Ref. No player has ever been able to see who the
 * Ref is. Rejoining is simply when you go looking.
 *
 * The client had no `hostId` state at all, and NO payload carried the host's
 * id. The only thing that ever told a client who the Ref was, was `newHost` —
 * so anyone who joined or reconnected after the last handoff had no way to
 * know, and a Ref who reloaded came back as `isHost: false`.
 *
 * These pin the wire half: the host's id has to be in the payloads a client
 * uses to build its picture of the room.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the wire says who the Ref is', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** The last gameStarted payload a player received. */
  const lastGameStarted = (player, since = 0) => {
    const seen = player.received('gameStarted', since);
    return seen.length ? seen[seen.length - 1] : null;
  };

  it('tells every player at kickoff, not just the Ref', async () => {
    const marks = [];
    const room = await h.newRoom(['Ava', 'Ben', 'Cy', 'Dee']);
    room.all.forEach((p) => marks.push([p, p.mark()]));
    await room.start();
    await sleep(400);

    for (const [player, since] of marks) {
      const payload = lastGameStarted(player, since);
      expect(payload, `${player.name} got no gameStarted`).toBeTruthy();
      expect(payload.hostId, `${player.name} was not told who the Ref is`).toBe(room.host.id);
    }
  });

  it('tells a player who reconnects, with no newHost needed', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await ben.disconnect();
    await sleep(300);
    const fresh = await h.connect('Ben');
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Ben');
    await fresh.waitFor('gameStarted', { since });
    await sleep(300);

    expect(fresh.saw('newHost', since), 'this test is meaningless if newHost fired').toBe(false);
    expect(lastGameStarted(fresh, since).hostId, 'a reconnecting player cannot tell who the Ref is')
      .toBe(room.host.id);
  });

  it('tells a Ref who reloads who the Ref is now — even if it moved', async () => {
    // NOTE, correcting the run sheet: a Ref who drops mid-game does NOT come
    // back with the whistle when other players are connected. The disconnect
    // handler promotes an active player, which is correct and long-standing.
    // What matters is that the returning player is told who holds it now, and
    // that everyone agrees.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await room.host.disconnect();
    await sleep(500);
    const fresh = await h.connect('Ava');
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Ava');
    await fresh.waitFor('gameStarted', { since });
    await sleep(400);

    const reported = lastGameStarted(fresh, since).hostId;
    expect(reported, 'the returning player was told nothing about the Ref').toBeTruthy();
    expect(reported, 'the whistle should have gone to a player who was still here')
      .not.toBe(room.host.id);

    // And it is somebody who is actually in the room right now.
    const names = [ben, room.guests[1], fresh].map((p) => p.id);
    expect(names, 'the Ref is nobody who is here').toContain(reported);
  });

  it('gives the whistle back to a lone Ref who reloads', async () => {
    // With nobody else connected there is nobody to promote, so Session 12's
    // ref-recovery hands it to whoever comes back first — which is her.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const p of room.all) await p.disconnect();
    await sleep(600);

    const fresh = await h.connect('Ava');
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Ava');
    await fresh.waitFor('gameStarted', { since });
    await sleep(400);

    expect(lastGameStarted(fresh, since).hostId).toBe(fresh.id);
  });

  it('reports the new Ref after a handoff', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = ben.mark();
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: ben.id });
    await ben.waitFor('newHost', { since, timeout: 5000 });
    await sleep(300);

    // Somebody arriving now must learn the CURRENT Ref, not the original one.
    await cy.disconnect();
    await sleep(300);
    const fresh = await h.connect('Cy');
    const freshSince = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Cy');
    await fresh.waitFor('gameStarted', { since: freshSince });
    await sleep(300);

    expect(lastGameStarted(fresh, freshSince).hostId, 'reported the old Ref').toBe(ben.id);
  });
});
