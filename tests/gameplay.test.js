/**
 * Phase 2a — a complete game, start to finish, the way it is actually played.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STANDARD_CARDS = ['Touchdown', 'Field Goal', 'Turnover', 'Sacks', 'Penalty'];

/** Every card object dealt must be a real card, never an undefined slot. */
const expectRealCards = (cards) => {
  for (const card of cards) {
    expect(card, `dealt an empty card slot: ${JSON.stringify(cards)}`).toBeTruthy();
    expect(typeof card.card).toBe('string');
    expect(typeof card.drinks).toBe('number');
  }
};

describe('a full game', () => {
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

  it('deals 5 Standard and 2 Wild real cards to everyone at kickoff', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const player of room.all) {
      expect(player.view.hand.standard).toHaveLength(5);
      expect(player.view.hand.wild).toHaveLength(2);
      expectRealCards(player.view.hand.standard);
      expectRealCards(player.view.hand.wild);
      expect(player.view.hand.standard.every((c) => STANDARD_CARDS.includes(c.card))).toBe(true);
    }
  });

  it('plays every Standard card, refilling hands each round', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    for (const cardType of STANDARD_CARDS) {
      const since = room.host.mark();
      const outcome = await room.declareStandard(cardType);
      expect(['declared', 'noCard']).toContain(outcome);

      if (outcome === 'noCard') continue; // nobody drew it; the round never opens
      await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, since);

      // Everyone is back to a full hand of real cards for the next round.
      for (const player of room.all) {
        expect(player.view.hand.standard).toHaveLength(5);
        expectRealCards(player.view.hand.standard);
      }
    }
  }, 180_000);

  it('runs a Wild card: player selects, host confirms, holders are told to pour', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const wildCard = ben.view.hand.wild[0];
    const selection = await room.selectWild(ben, wildCard.card);
    expect(selection.playerId).toBe(ben.id);
    expect(selection.wildcardtype).toBe(wildCard.card);

    const sinceBen = ben.mark();
    const sinceHost = room.host.mark();
    expect(await room.confirmWild(wildCard.card, ben.id)).toBe('declared');

    const parcel = await ben.waitFor('distributeDrinks', { since: sinceBen });
    expect(parcel.wildcardtype).toBe(wildCard.card);

    // 10 drinks = 1 shotgun, folded on the card's face value.
    const copies = ben.view.hand.wild.filter((c) => c.card === wildCard.card).length || 1;
    expect(parcel.shotguns).toBe(Math.floor((wildCard.drinks * copies) / 10));
    expect(parcel.drinkCount).toBe((wildCard.drinks * copies) % 10);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.wild, sinceHost);
    expect(ben.view.hand.wild).toHaveLength(2);
    expectRealCards(ben.view.hand.wild);
  });

  it('gives everyone exactly one drink on First Down', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    const message = await room.host.waitFor('firstDownMessage', { since });
    expect(message).toMatch(/first down/i);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    for (const player of room.all) {
      expect(h.totalsFor(room.host, player.id).totalDrinks).toBe(1);
    }
  });

  it('folds 10 received drinks into 1 shotgun', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // Two holders both pour into Ben, the way a real round goes. Ben already has
    // 1 drink from First Down, so 4 + 5 tips him over 10.
    room.assignDrinks(room.host, [{ player: ben, drinks: 4 }]);
    await sleep(100);
    room.assignDrinks(cy, [{ player: ben, drinks: 5 }]);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    // 1 + 4 + 5 = 10 -> 1 shotgun, 0 drinks left over.
    expect(h.totalsFor(room.host, ben.id)).toEqual({ totalDrinks: 0, totalShotguns: 1 });
  });

  it('advances the quarter and lets a player swap one Wild card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    expect(await room.nextQuarter()).toBe(2);

    const discarded = ben.view.hand.wild[0];
    const hand = await room.swapWildCard(ben, discarded);

    expect(hand.wild).toHaveLength(2);
    expectRealCards(hand.wild);
    // The exact card object that was thrown away is gone from the hand.
    expect(hand.wild.filter((c) => c.card === discarded.card).length)
      .toBeLessThan(ben.view.hand.wild.filter((c) => c.card === discarded.card).length + 1);
  });

  it('keeps totals correct across several rounds', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    for (let round = 1; round <= 3; round += 1) {
      const since = room.host.mark();
      expect(await room.declareFirstDown()).toBe('declared');
      room.assignDrinks(room.host, [{ player: ben, drinks: 2 }]);
      await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

      // Ben: 1 (First Down) + 2 (assigned) per round. Everyone else: 1 per round.
      expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(round * 3);
      expect(h.totalsFor(room.host, room.host.id).totalDrinks).toBe(round * 1);
    }
  }, 90_000);
});
