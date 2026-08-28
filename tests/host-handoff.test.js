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

/**
 * The roster every other client holds must track who is actually here.
 *
 * The handoff guards were never the problem — `assignNewHost` refuses a
 * disconnected target and the picker filters on `!p.disconnected`. The DATA
 * reaching them was stale: when a non-host dropped mid-game the server set
 * `disconnected = true` in its own memory and broadcast nothing, on the
 * reasoning that a roster update would cause "UI churn". So every other client
 * kept a roster where that player was `disconnected: undefined` for the rest of
 * the game, and `!p.disconnected` passed on a player who had left.
 *
 * The tell the owner gave: the sheet FILTERS away players out entirely, and he
 * still saw the phone listed. That is only possible if the laptop never learned
 * it had gone.
 */
describe('the roster tracks who is actually here', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** How a given watcher currently sees somebody. */
  const rowFor = (watcher, name) =>
    (watcher.view.players || []).find((p) => p.name === name);

  it('tells everyone else when a non-host drops mid-game', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await ben.disconnect();
    await sleep(900);

    for (const watcher of [room.host, cy]) {
      const benRow = rowFor(watcher, 'Ben');
      expect(benRow, `${watcher.name} lost Ben from the roster entirely`).toBeTruthy();
      expect(
        benRow.disconnected,
        `${watcher.name} still thinks Ben is here — this is what let the Ref hand `
          + 'the whistle to a player who had left'
      ).toBe(true);
    }
  });

  it('tells everyone else when they come back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await ben.disconnect();
    await sleep(700);
    const fresh = await h.connect('Ben');
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Ben');
    await fresh.waitFor('gameStarted', { since });
    await sleep(900);

    for (const watcher of [room.host, cy]) {
      const benRow = rowFor(watcher, 'Ben');
      expect(benRow, `${watcher.name} lost Ben`).toBeTruthy();
      expect(
        benRow.disconnected,
        `${watcher.name} still shows Ben as away after he came back — the row stays `
          + 'greyed forever, which is the same bug wearing a different hat'
      ).toBeFalsy();
    }
  });
});
