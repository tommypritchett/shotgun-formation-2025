/**
 * Phase B — the wild-card swap allowance.
 *
 * The rule is ONE swap per player per quarter. Before Session 3 the server
 * enforced nothing: only the client's modal stopped you, so a replayed or
 * hand-crafted `wildCardSwap` could reroll a whole hand and farm the deck for
 * a 40-drink Doink.
 *
 * The refusal is deliberately SILENT — no new socket event. The real client
 * closes its own modal the moment it emits (`App.js:461`), so it never waits
 * for a reply; a second swap can only be a replayed or malformed message, and
 * inventing an error event would be surface the client does not listen for.
 *
 * Every assertion here is on observable socket behaviour: the hand the server
 * sends back, and the events it does or does not emit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long to wait before concluding the server sent nothing back. */
const SILENCE_MS = 800;

/**
 * Emit a swap and assert the server ignored it completely: no new hand, and
 * no error/`actionInProgress` consolation event either.
 */
const expectSwapRefused = async (player, roomCode, discardedCard) => {
  const since = player.mark();
  const handBefore = player.view.hand.wild;

  player.emit('wildCardSwap', { roomCode, discardedCard });
  await sleep(SILENCE_MS);

  expect(player.saw('updatePlayerHand', since), 'server sent a new hand for a refused swap')
    .toBe(false);
  expect(player.saw('error', since), 'refusal must be silent, not an error event').toBe(false);
  expect(player.saw('actionInProgress', since), 'refusal must not reuse actionInProgress')
    .toBe(false);
  expect(player.view.hand.wild, 'hand changed on a refused swap').toEqual(handBefore);
};

describe('wild-card swap allowance', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await h.teardown();
    h.assertAlive();
  });

  it('refuses a second swap in the same quarter, silently', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    expect(await room.nextQuarter()).toBe(2);

    // First swap: allowed, and the server sends the new hand back.
    const afterFirst = await room.swapWildCard(ben, ben.view.hand.wild[0]);
    expect(afterFirst.wild).toHaveLength(2);

    // Second swap, same quarter, same player: ignored.
    await expectSwapRefused(ben, room.code, ben.view.hand.wild[0]);
  });

  it('gives the allowance back when the quarter advances', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    expect(await room.nextQuarter()).toBe(2);
    await room.swapWildCard(ben, ben.view.hand.wild[0]);
    await expectSwapRefused(ben, room.code, ben.view.hand.wild[0]);

    // A new quarter is a new allowance.
    expect(await room.nextQuarter()).toBe(3);
    const afterQ3 = await room.swapWildCard(ben, ben.view.hand.wild[0]);
    expect(afterQ3.wild).toHaveLength(2);

    // ...but still only one.
    await expectSwapRefused(ben, room.code, ben.view.hand.wild[0]);
  });

  it('tracks the allowance per player, not per room', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    expect(await room.nextQuarter()).toBe(2);

    // Ben using his swap must not consume anyone else's.
    await room.swapWildCard(ben, ben.view.hand.wild[0]);
    const cyHand = await room.swapWildCard(cy, cy.view.hand.wild[0]);
    expect(cyHand.wild).toHaveLength(2);
    const hostHand = await room.swapWildCard(room.host, room.host.view.hand.wild[0]);
    expect(hostHand.wild).toHaveLength(2);

    // ...and each of them is now spent.
    await expectSwapRefused(cy, room.code, cy.view.hand.wild[0]);
  });

  it('does not hand out a fresh swap to a player who reconnects', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    expect(await room.nextQuarter()).toBe(2);
    await room.swapWildCard(ben, ben.view.hand.wild[0]);

    // Drop and come back on a brand new socket id, same quarter. If the
    // allowance were keyed by socket id this would be a free reroll — which is
    // precisely the exploit the guard exists to close, since a client can
    // reconnect at will.
    await ben.disconnect();
    await sleep(400);
    const fresh = await h.connect('Ben');
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, 'Ben');
    await fresh.waitFor('gameStarted', { since });
    await sleep(400);

    await expectSwapRefused(fresh, room.code, fresh.view.hand.wild[0]);

    // And the next quarter still works for them, so the guard is not a ban.
    expect(await room.nextQuarter()).toBe(3);
    const afterQ3 = await h.swapWildCard(fresh, room.code, fresh.view.hand.wild[0]);
    expect(afterQ3.wild).toHaveLength(2);
  });
});

/**
 * Declining the quarter-break swap.
 *
 * Reported from live play as "Keep my hand does nothing". The run sheet
 * wondered whether a decline that never reaches the server leaves the
 * one-swap-per-quarter allowance in a state the player cannot escape.
 *
 * It does not, and these tests pin that: the allowance is consumed by an ACTUAL
 * swap and by nothing else, so keeping your hand is free and costs you nothing
 * next quarter. The bug was entirely client-side — `closeModal` had no case for
 * the swap modal, so the button was wired to a function that did nothing.
 */
describe('keeping your hand', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('costs nothing — the player can still swap in the same quarter', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    expect(await room.nextQuarter()).toBe(2);

    // Ben declines. A decline sends nothing at all, so simply wait.
    const handBefore = ben.view.hand.wild;
    await sleep(600);
    expect(ben.view.hand.wild, 'a decline changed the hand').toEqual(handBefore);

    // He changes his mind in the same quarter: still allowed.
    const after = await room.swapWildCard(ben, ben.view.hand.wild[0]);
    expect(after.wild).toHaveLength(2);
  });

  it('leaves next quarter untouched', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    expect(await room.nextQuarter()).toBe(2);
    await sleep(400);                       // declined — nothing emitted

    expect(await room.nextQuarter()).toBe(3);
    const after = await room.swapWildCard(ben, ben.view.hand.wild[0]);
    expect(after.wild).toHaveLength(2);
  });
});
