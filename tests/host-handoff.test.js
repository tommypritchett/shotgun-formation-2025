/**
 * Item 4 — there must always be an active Ref.
 *
 * Disconnected players stay in `room.players` with `disconnected: true` so
 * their drinks survive, which means every "pick a player" lookup has to say
 * whether it wants an ACTIVE one. `assignNewHost` did not, so the whistle
 * could be handed to somebody who had left the building — and the game stops,
 * because only the Ref can declare.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('handing over the whistle', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** Who the room currently thinks is Ref, as seen by a watcher. */
  const refSeenBy = (player) => player.view.hostId;

  it('refuses to hand the Ref to a player who has dropped', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    // Capture the id BEFORE dropping: a fake player's `id` reads socket.id,
    // which socket.io clears on disconnect. The room still knows him by the
    // old id, and that is exactly the id a real client would offer.
    const benId = ben.id;
    await ben.disconnect();
    await sleep(400);

    const since = room.host.mark();
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: benId });
    await sleep(700);

    // No handoff happened...
    expect(room.host.saw('newHost', since), 'the whistle went to a player who had left')
      .toBe(false);
    // ...and the host was told why, through the event the client already renders.
    expect(room.host.saw('error', since), 'the refusal was silent').toBe(true);

    // Cy is still able to be given it, so the room is not stuck.
    const since2 = room.host.mark();
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: cy.id });
    const handoff = await room.host.waitFor('newHost', { since: since2, timeout: 5000 });
    expect(handoff.newHostId).toBe(cy.id);
  });

  it('still hands the Ref to a player who is present', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = ben.mark();
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: ben.id });
    const handoff = await ben.waitFor('newHost', { since, timeout: 5000 });

    expect(handoff.newHostId).toBe(ben.id);
    expect(handoff.message).toContain('Ben');
    await sleep(300);
    expect(refSeenBy(ben)).toBe(ben.id);
  });

  it('refuses an id that is not in the room at all', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const since = room.host.mark();
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: 'nobody-at-all' });
    await sleep(600);
    expect(room.host.saw('newHost', since)).toBe(false);
    expect(room.host.saw('error', since)).toBe(true);
  });

  it('ignores a handoff attempted by someone who is not the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    ben.emit('assignNewHost', { roomCode: room.code, newHostId: cy.id });
    await sleep(600);
    expect(room.host.saw('newHost', since)).toBe(false);
  });

  it('picks an ACTIVE player when the Ref leaves the game', async () => {
    // Ava is Ref. Ben drops. Ava leaves. The whistle must go to Cy, not Ben.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await ben.disconnect();
    await sleep(400);

    const since = cy.mark();
    room.host.emit('leaveGame', { roomCode: room.code });

    const handoff = await cy.waitFor('newHost', { since, timeout: 6000 });
    expect(handoff.newHostId, 'the whistle went to the player who had dropped')
      .toBe(cy.id);
  });
});
