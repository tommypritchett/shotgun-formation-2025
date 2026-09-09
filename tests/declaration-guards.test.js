/**
 * Only the Ref may declare a round.
 *
 * The client gates Declare Action to the Ref and always has. The server did
 * not check at all, so any client in the room could emit `playStandardCard`,
 * `firstDownEvent` or `wildCardConfirmed` and start a round for the whole
 * table — and because `refTookOver()` runs first, a non-Ref declaring also
 * threw away every detection the feed had queued.
 *
 * `wildCardSelected` is deliberately NOT gated. A player tapping one of their
 * own wild cards to ask the Ref for it is the designed flow; gating it would
 * break the feature. It only puts a prompt on the Ref's screen, and the Ref
 * confirming is what declares — and confirming IS now gated.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('declaring a round is Ref-only', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('a player cannot declare a standard card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = cy.mark();

    ben.emit('playStandardCard', { roomCode: room.code, cardType: 'Penalty' });
    await sleep(1200);

    expect(cy.saw('declaredCard', since), 'a player started a round').toBe(false);
  }, 30_000);

  it('a player cannot call First Down', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = cy.mark();

    ben.emit('firstDownEvent', { roomCode: room.code });
    await sleep(1200);

    expect(cy.saw('declaredCard', since), 'a player called First Down').toBe(false);
  }, 30_000);

  it('a player cannot confirm a wild card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = cy.mark();

    ben.emit('wildCardConfirmed', { roomCode: room.code, wildcardtype: 'Doink' });
    await sleep(1200);

    expect(cy.saw('declaredCard', since), 'a player confirmed a wild card').toBe(false);
  }, 30_000);

  it('the Ref can still do all three, so the game is not stuck', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const s1 = ben.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    expect(await ben.waitFor('declaredCard', { since: s1, timeout: 8000 })).toBe('First Down');
    await ben.waitFor('updatePlayerStats', {
      since: s1, timeout: 20_000, where: (p) => p && p.roundFinalized,
    });

    const s2 = ben.mark();
    room.host.emit('playStandardCard', { roomCode: room.code, cardType: 'Penalty' });
    // `where` matters: finalizeRound broadcasts `declaredCard: null` to clear
    // the previous round, and without a filter that reset is what this matches.
    const declared = await ben.waitFor('declaredCard', {
      since: s2, timeout: 8000, where: (card) => Boolean(card),
    });
    expect(declared).toBe('Penalty');
  }, 60_000);

  it('still lets a player OFFER a wild card to the Ref', async () => {
    // The designed flow: player taps their own wild card, Ref confirms.
    // Gating this would break the feature; only the confirm is Ref-only.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = room.host.mark();

    const mine = (ben.view.hand.wild || [])[0];
    ben.emit('wildCardSelected', {
      roomCode: room.code, playerId: ben.id, wildcardtype: mine && mine.card,
    });
    await sleep(1200);

    expect(room.host.saw('wildCardSelected', since)
      || room.host.saw('wildCardSelection', since)
      || room.host.saw('wildCardChosen', since),
    'the Ref was never offered the card').toBe(true);
  }, 30_000);

  it('survives a declaration attempt with nonsense', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    ben.emit('playStandardCard', {});
    ben.emit('firstDownEvent', {});
    ben.emit('wildCardConfirmed', {});
    room.host.emit('playStandardCard', { roomCode: 'ZZZZZ', cardType: 'Penalty' });
    await sleep(900);
    h.assertAlive();
  }, 30_000);
});
