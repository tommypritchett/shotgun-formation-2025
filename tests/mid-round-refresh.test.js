/**
 * Phase 7a — refreshing mid-round must not cost you your drink prompt.
 *
 * Reproduced by the owner on two phones: hold the declared card, get the
 * prompt to pour, refresh while the timer is still running, and you rejoin the
 * game but can no longer give your drinks out.
 *
 * Cause: `playStandardCard` emits `distributeDrinks` and then REMOVES those
 * cards from the hand and draws replacements (server.js, the `playerHand
 * .standard.filter(...)` + `splice` pair). The reconnect path then tries to
 * re-derive what you owe from your CURRENT hand — which no longer contains the
 * card — so it finds nothing and stays silent.
 *
 * Worse than silent, occasionally: if the replacement draw happens to redeal
 * the same card type, the reconnecting player is prompted for an amount that
 * has nothing to do with what they actually played.
 *
 * The fix records the pending distribution on `activeRounds[roomCode]` when the
 * card is played, and replays that. These tests assert the observable contract:
 * what the reconnecting socket is told.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('refreshing mid-round', () => {
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

  /** Rejoin as a brand new socket, the way a browser refresh does. */
  const refresh = async (room, player, { via = 'joinRoom' } = {}) => {
    await player.disconnect();
    await sleep(250);
    const fresh = await h.connect(player.name);
    const since = fresh.mark();
    fresh.emit(via, room.code, player.name);
    await fresh.waitFor('gameStarted', { since });
    return { fresh, since };
  };

  it('re-sends the drink prompt, with the amount actually played', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    // Declare a card the HOST holds, so the host is a giver with a known amount.
    const cardType = room.host.view.hand.standard[0].card;
    const since = room.host.mark();
    expect(await room.declareStandard(cardType)).toBe('declared');

    const original = await room.host.waitFor('distributeDrinks', { since });
    expect(original.drinkCount + original.shotguns).toBeGreaterThan(0);

    // The phone refreshes while the timer is still running.
    const { fresh, since: sinceFresh } = await refresh(room, room.host);

    // It must be told again what it owes — and the SAME thing, not a fresh
    // reading of a hand that has since been dealt different cards.
    const replayed = await fresh.waitFor('distributeDrinks', {
      since: sinceFresh,
      timeout: 8000,
    });

    expect(replayed.cardType).toBe(cardType);
    expect(replayed.drinkCount).toBe(original.drinkCount);
    expect(replayed.shotguns).toBe(original.shotguns);
    expect(replayed.playerId).toBe(fresh.id);
  });

  it('lets the refreshed player actually pour, and the drinks land', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const cardType = room.host.view.hand.standard[0].card;
    const sinceHost = room.host.mark();
    expect(await room.declareStandard(cardType)).toBe('declared');
    const original = await room.host.waitFor('distributeDrinks', { since: sinceHost });

    const { fresh, since: sinceFresh } = await refresh(room, room.host);

    // Pour exactly what the REPLAYED prompt says, from the new socket. This is
    // what the real client does, so if no prompt arrives the player has nothing
    // to act on and this test fails the same way the phone does.
    const replayed = await fresh.waitFor('distributeDrinks', {
      since: sinceFresh,
      timeout: 8000,
    });
    const drinks = replayed.drinkCount;
    const shotguns = replayed.shotguns;
    expect({ drinks, shotguns }).toEqual({
      drinks: original.drinkCount,
      shotguns: original.shotguns,
    });
    fresh.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [ben.id],
      drinksToGive: { [ben.id]: drinks },
      shotgunsToGive: { [ben.id]: shotguns },
    });

    const watcher = room.guests[1];
    await watcher.waitFor('updatePlayerStats', {
      since: watcher.mark(),
      where: (p) => p?.roundFinalized === true,
      timeout: 30000,
    });

    expect(h.totalsFor(watcher, ben.id)).toEqual({
      totalDrinks: drinks,
      totalShotguns: shotguns,
    });
  });

  it('does the same through the URL-param rejoin path a real refresh uses', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    const cardType = room.host.view.hand.standard[0].card;
    const since = room.host.mark();
    expect(await room.declareStandard(cardType)).toBe('declared');
    const original = await room.host.waitFor('distributeDrinks', { since });

    const { fresh, since: sinceFresh } = await refresh(room, room.host, {
      via: 'validateAndJoinRoom',
    });

    const replayed = await fresh.waitFor('distributeDrinks', {
      since: sinceFresh,
      timeout: 8000,
    });
    expect(replayed.drinkCount).toBe(original.drinkCount);
    expect(replayed.shotguns).toBe(original.shotguns);
  });

  it('says nothing to a player who was never holding the declared card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    // A card that exists but can never be in a Standard hand, so nobody holds
    // it... but that path aborts the round. Instead: declare a real card and
    // find a player who did NOT get a prompt.
    const cardType = room.host.view.hand.standard[0].card;
    const since = room.host.mark();
    expect(await room.declareStandard(cardType)).toBe('declared');
    await sleep(600);

    const nonHolder = room.guests.find(
      (g) => !g.saw('distributeDrinks', 0)
    );
    if (!nonHolder) return; // both guests held it; nothing to assert this run

    const { fresh, since: sinceFresh } = await refresh(room, nonHolder);
    await sleep(1200);
    expect(fresh.saw('distributeDrinks', sinceFresh)).toBe(false);
  });
});
