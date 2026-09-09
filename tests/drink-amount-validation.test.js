/**
 * Drink amounts arrive from a client and are added straight to the scoreboard.
 *
 * `roundResults[room][id].drinks += drinksToGive[id]` had no coercion and no
 * bound, so a STRING survived: `0 + "abc"` is `"0abc"`, and every later `+=`
 * concatenates. That does not just let somebody cheat — it breaks the
 * scoreboard for the whole table for the rest of the game, and the comparison
 * that folds 10 drinks into a shotgun stops working too.
 *
 * The cheating half is low stakes and deliberately not chased here. The type
 * safety is the point: whatever arrives, the totals stay numbers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every recorded total, as the table sees it — and whether they are numbers. */
const statsOf = (player) => Object.values(player.view.stats || {});

describe('what a client may add to the scoreboard', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** Run one First Down round, with `assign` fired while it is live. */
  const roundWith = async (room, assign) => {
    const since = room.host.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await room.host.waitFor('declaredCard', { since, timeout: 8000 });
    await sleep(300);
    await assign();
    await room.host.waitFor('updatePlayerStats', {
      since, timeout: 20_000, where: (p) => p && p.roundFinalized,
    });
    await sleep(300);
  };

  it('keeps every total a finite number when sent a string', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await roundWith(room, async () => {
      ben.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [cy.id],
        drinksToGive: { [cy.id]: 'abc' },
        shotgunsToGive: {},
      });
    });

    for (const s of statsOf(room.host)) {
      expect(Number.isFinite(s.totalDrinks), `${s.name}.totalDrinks is not a number: ${JSON.stringify(s.totalDrinks)}`).toBe(true);
      expect(Number.isFinite(s.totalShotguns), `${s.name}.totalShotguns is not a number: ${JSON.stringify(s.totalShotguns)}`).toBe(true);
    }
  }, 60_000);

  it('does not let a negative amount take drinks back off the board', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await roundWith(room, async () => {
      ben.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [cy.id],
        drinksToGive: { [cy.id]: -50 },
        shotgunsToGive: { [cy.id]: -5 },
      });
    });

    for (const s of statsOf(room.host)) {
      expect(s.totalDrinks, `${s.name} went negative`).toBeGreaterThanOrEqual(0);
      expect(s.totalShotguns, `${s.name} went negative`).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('caps an absurd amount rather than accepting it', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await roundWith(room, async () => {
      ben.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [cy.id],
        drinksToGive: { [cy.id]: 1e9 },
        shotgunsToGive: {},
      });
    });

    const worst = Math.max(...statsOf(room.host).map((s) => s.totalDrinks || 0));
    expect(worst, 'an unbounded amount reached the scoreboard').toBeLessThan(1000);
  }, 60_000);

  it('shrugs off NaN, null, objects and Infinity', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await roundWith(room, async () => {
      for (const bad of [NaN, null, undefined, {}, [], Infinity, -Infinity, '7e99']) {
        ben.emit('assignDrinks', {
          roomCode: room.code,
          selectedPlayerIds: [cy.id],
          drinksToGive: { [cy.id]: bad },
          shotgunsToGive: { [cy.id]: bad },
        });
      }
    });

    h.assertAlive();
    for (const s of statsOf(room.host)) {
      expect(Number.isFinite(s.totalDrinks), `${s.name}.totalDrinks broke`).toBe(true);
      expect(Number.isFinite(s.totalShotguns), `${s.name}.totalShotguns broke`).toBe(true);
    }
  }, 60_000);

  it('still records an ordinary pour', async () => {
    // The guard must not break the game it is protecting.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    await roundWith(room, async () => {
      ben.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [cy.id],
        drinksToGive: { [cy.id]: 2 },
        shotgunsToGive: {},
      });
    });

    const cyStats = statsOf(room.host).find((s) => s.name === 'Cy');
    expect(cyStats.totalDrinks, 'a normal pour was lost').toBeGreaterThanOrEqual(2);
  }, 60_000);
});
