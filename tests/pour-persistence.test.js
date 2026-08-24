/**
 * What you still owe has to survive a reconnect.
 *
 * `activeRounds[roomCode].pending[name]` was written once, when the card was
 * played, and never touched again — while the running count of what had
 * actually been poured lived only in the browser. Refresh, and the two
 * disagree: the server replays the ORIGINAL amount, so a 4-drink card can be
 * poured six times.
 *
 * Measured before the fix (browser, twice): owed 4, poured 2, refreshed, and
 * the assigner went back to "4 left to assign" with the tile tallies reset to
 * zero. The two already poured were NOT lost from the score — they were in
 * roundResults the whole time — but the client's memory of them was, and the
 * server asked for the full amount again.
 *
 * `pending` now means WHAT YOU STILL OWE: it goes down as pours land and back
 * up on undo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('what you still owe', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /**
   * Declare a card the HOST holds and return what they were told to pour.
   * Retries across cards so the test never depends on a particular deal.
   */
  const declareSomethingTheHostHolds = async (room) => {
    const seen = new Set();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const card = room.host.view.hand.standard
        .map((c) => c.card)
        .find((c) => !seen.has(c));
      if (!card) break;
      seen.add(card);
      const since = room.host.mark();
      const outcome = await room.declareStandard(card);
      if (outcome !== 'declared') continue;
      const owed = await room.host.waitFor('distributeDrinks', { since, timeout: 6000 });
      if ((owed.drinkCount || 0) + (owed.shotguns || 0) > 0) return { card, owed, since };
    }
    throw new Error('could not get the host a pour prompt');
  };

  /** Drop and rejoin, returning the replayed prompt (or null if silent). */
  const refreshAndReadPrompt = async (room, player) => {
    await player.disconnect();
    await sleep(300);
    const fresh = await h.connect(player.name);
    const since = fresh.mark();
    fresh.emit('joinRoom', room.code, player.name);
    await fresh.waitFor('gameStarted', { since });
    await sleep(700);
    const prompts = fresh.received('distributeDrinks', since);
    return { fresh, prompt: prompts.length ? prompts[prompts.length - 1] : null };
  };

  it('asks only for what is left after a partial pour', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const { owed } = await declareSomethingTheHostHolds(room);
    const total = owed.drinkCount;
    expect(total, 'need a card worth at least 2 drinks').toBeGreaterThanOrEqual(2);

    room.assignDrinks(room.host, [{ player: ben, drinks: 2 }]);
    await sleep(400);

    const { prompt } = await refreshAndReadPrompt(room, room.host);
    expect(prompt, 'no prompt at all after refreshing mid-pour').toBeTruthy();
    expect(prompt.drinkCount, 'asked for the original amount, not the remainder')
      .toBe(total - 2);
  });

  it('keeps the pours that already landed', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const { owed, since } = await declareSomethingTheHostHolds(room);

    room.assignDrinks(room.host, [{ player: ben, drinks: 2 }]);
    await sleep(400);
    const { fresh } = await refreshAndReadPrompt(room, room.host);

    // Pour the remainder from the new socket.
    const left = owed.drinkCount - 2;
    if (left > 0) {
      fresh.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [cy.id],
        drinksToGive: { [cy.id]: left },
        shotgunsToGive: {},
      });
    }
    await room.waitForFinalize(ben, h.ROUND_SECONDS.standard, since);

    expect(h.totalsFor(ben, ben.id).totalDrinks, 'the 2 poured before the refresh vanished')
      .toBe(2);
    if (left > 0) expect(h.totalsFor(ben, cy.id).totalDrinks).toBe(left);
  });

  it('still replays everything when nothing was poured (regression guard)', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const { owed } = await declareSomethingTheHostHolds(room);

    const { prompt } = await refreshAndReadPrompt(room, room.host);
    expect(prompt).toBeTruthy();
    expect(prompt.drinkCount).toBe(owed.drinkCount);
    expect(prompt.shotguns).toBe(owed.shotguns);
  });

  it('says nothing when it has all been poured already', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const { owed } = await declareSomethingTheHostHolds(room);

    room.assignDrinks(room.host, [
      { player: ben, drinks: owed.drinkCount, shotguns: owed.shotguns },
    ]);
    await sleep(400);

    const { prompt } = await refreshAndReadPrompt(room, room.host);
    expect(prompt, 'prompted to pour again after settling up in full').toBeNull();
  });

  it('counts an undo back onto what is owed', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const { owed } = await declareSomethingTheHostHolds(room);
    expect(owed.drinkCount).toBeGreaterThanOrEqual(2);

    room.assignDrinks(room.host, [{ player: ben, drinks: 2 }]);
    await sleep(250);
    // Undo one, exactly as the client sends it.
    room.host.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [ben.id],
      drinksToGive: { [ben.id]: -1 },
      shotgunsToGive: {},
    });
    await sleep(300);

    const { prompt } = await refreshAndReadPrompt(room, room.host);
    expect(prompt).toBeTruthy();
    expect(prompt.drinkCount, 'the undone drink was not added back').toBe(owed.drinkCount - 1);
  });

  it('survives a pour that crosses the shotgun fold', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const { owed, since } = await declareSomethingTheHostHolds(room);

    // Drive Ben over ten in one round so the fold fires, then reconnect and
    // finish. Totals must be right and never negative.
    room.assignDrinks(room.host, [{ player: ben, drinks: Math.min(2, owed.drinkCount) }]);
    await sleep(250);
    cy.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [ben.id],
      drinksToGive: { [ben.id]: 9 },
      shotgunsToGive: {},
    });
    await sleep(300);

    const { fresh } = await refreshAndReadPrompt(room, room.host);
    const left = owed.drinkCount - Math.min(2, owed.drinkCount);
    if (left > 0) {
      fresh.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [ben.id],
        drinksToGive: { [ben.id]: left },
        shotgunsToGive: {},
      });
    }
    await room.waitForFinalize(cy, h.ROUND_SECONDS.standard, since);

    const totals = h.totalsFor(cy, ben.id);
    expect(totals.totalDrinks).toBeGreaterThanOrEqual(0);
    expect(totals.totalShotguns).toBeGreaterThanOrEqual(0);
    // Everything Ben was given, counted flat, must add up.
    expect(totals.totalShotguns * 10 + totals.totalDrinks).toBe(9 + owed.drinkCount);
  });
});
