/**
 * Phase 2b — players leaving and coming back.
 *
 * This is how the game actually gets played: on phones, in a loud room, with
 * people wandering off. Every assertion here is on an OBSERVABLE outcome — what
 * the remaining players are told, and whether the score is right — never on
 * server internals.
 *
 * Tests marked `it.fails` document behaviour I believe is wrong but did not
 * change, because "correct" is your call. They assert the behaviour I think you
 * want, and they are expected to fail today. See OVERNIGHT_REPORT.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('leaving and rejoining', () => {
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

  /** Cheapest complete round: First Down is 6s and gives everyone exactly 1 drink. */
  const playFirstDown = async (room, extraAssignments = []) => {
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    if (extraAssignments.length) room.assignDrinks(room.host, extraAssignments);
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
  };

  /** Drop a player's transport and bring them back on a brand-new socket. */
  const dropAndRejoin = async (room, player, { via = 'joinRoom' } = {}) => {
    await player.disconnect();
    await sleep(250);
    const fresh = await h.connect(player.name);
    const since = fresh.mark();
    if (via === 'validateAndJoinRoom') {
      fresh.emit('validateAndJoinRoom', room.code, player.name);
    } else {
      fresh.emit('joinRoom', room.code, player.name);
    }
    await fresh.waitFor('gameStarted', { since });
    return { fresh, since };
  };

  // ── 1 ────────────────────────────────────────────────────────────────────
  it('1. a player who leaves the lobby disappears from everyone else\'s list', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = room.host.mark();
    ben.emit('leaveRoom', room.code);

    const roster = await h.waitForPlayerCount(room.host, 2, { since });
    expect(roster.map((p) => p.name).sort()).toEqual(['Ava', 'Cy']);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  it('2. a player who uses Leave Game mid-game is removed and the others are told', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    ben.emit('leaveGame', { roomCode: room.code });

    const left = await room.host.waitFor('playerLeft', { since });
    expect(left.remainingPlayers.map((p) => p.name).sort()).toEqual(['Ava', 'Cy']);

    // The game keeps working for everyone still in it.
    await playFirstDown(room);
    expect(h.totalsFor(room.host, cy.id).totalDrinks).toBe(1);
  });

  // ── 3 ────────────────────────────────────────────────────────────────────
  it('3. when the host drops mid-game a new host is assigned and the game continues', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = ben.mark();
    await room.host.disconnect();

    const handover = await ben.waitFor('newHost', { since });
    expect(handover.newHostId).toBeTruthy();

    // The new host can actually run a round.
    const newHost = [ben, cy].find((p) => p.id === handover.newHostId);
    expect(newHost).toBeTruthy();

    const sinceRound = newHost.mark();
    newHost.emit('firstDownEvent', { roomCode: room.code });
    await newHost.waitFor('declaredCard', {
      since: sinceRound,
      where: (c) => c === 'First Down',
    });
    await h.waitForRoundFinalized(newHost, h.ROUND_SECONDS.firstDown, sinceRound);

    expect(h.totalsFor(newHost, newHost.id).totalDrinks).toBe(1);
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  it('4. drinks assigned to a player survive that player dropping before the round ends', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const benId = ben.id;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    // Host pours 4 into Ben, then Ben's phone dies mid-window.
    room.assignDrinks(room.host, [{ player: ben, drinks: 4 }]);
    await sleep(300);
    await ben.disconnect();

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    // 1 from First Down + 4 assigned. The score must be right for the people
    // still in the room, whether or not Ben is there to see it.
    expect(h.totalsFor(room.host, benId).totalDrinks).toBe(5);
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  it('5. a player who reconnects with the same name gets their totals back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await playFirstDown(room, [{ player: ben, drinks: 6 }]);
    const before = h.totalsFor(room.host, ben.id);
    expect(before.totalDrinks).toBe(7); // 1 First Down + 6 assigned

    const { fresh } = await dropAndRejoin(room, ben);

    expect(fresh.view.stats[fresh.id]).toBeTruthy();
    expect(fresh.view.stats[fresh.id].totalDrinks).toBe(7);
    expect(fresh.view.hand.standard).toHaveLength(5);
    expect(fresh.view.hand.wild).toHaveLength(2);
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  it('6. a player who reconnects mid-round sees the declared card and a truthful timer', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const cardType = room.host.view.hand.standard[0].card;
    const sinceHost = room.host.mark();
    expect(await room.declareStandard(cardType)).toBe('declared');

    await sleep(4000); // four seconds into a 21-second window
    const { fresh, since } = await dropAndRejoin(room, ben);

    expect(await fresh.waitFor('declaredCard', { since })).toBe(cardType);

    const roundState = await fresh.waitFor('roundState', { since, timeout: 2000 });
    expect(roundState.roundInProgress).toBe(true);
    expect(roundState.declaredCard).toBe(cardType);

    // Before the Phase 1 duration fix this said ~25s of a 21s round.
    expect(roundState.timeRemaining).toBeGreaterThan(12);
    expect(roundState.timeRemaining).toBeLessThanOrEqual(h.ROUND_SECONDS.standard - 4);

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, sinceHost);
  });

  // ── 7 ────────────────────────────────────────────────────────────────────
  it('7. a browser refresh mid-round rejoins through the URL-param path', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const sinceHost = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await sleep(500);

    const { fresh, since } = await dropAndRejoin(room, ben, { via: 'validateAndJoinRoom' });

    expect(fresh.view.hand.standard).toHaveLength(5);
    expect(fresh.received('roomNotFound', since)).toEqual([]);

    const roster = await h.waitForPlayerCount(fresh, 3, { since });
    expect(roster.map((p) => p.name).sort()).toEqual(['Ava', 'Ben', 'Cy']);

    // The refresh path itself works: right hand, right roster, no roomNotFound.
    // Their First Down drink is nevertheless lost, because it was recorded
    // against the pre-refresh socket id — same root cause as 9a. Not asserted
    // here so this test stays about the rejoin path.
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, sinceHost);
  });

  // ── 8 ────────────────────────────────────────────────────────────────────
  it('8. a second player cannot take a name that is already active in the room', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);

    const impostor = await h.connect('Ben');
    const since = impostor.mark();
    impostor.emit('joinRoom', room.code, 'Ben');

    const message = await impostor.waitFor('error', { since });
    expect(String(message)).toMatch(/already taken/i);
    expect(room.host.view.players).toHaveLength(3);
  });

  // ── 9a ───────────────────────────────────────────────────────────────────
  it.fails(
    '9a. TIER B: drinks assigned before a mid-round reconnect still count (single hop)',
    async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const sinceHost = room.host.mark();
      expect(await room.declareFirstDown()).toBe('declared');

      // Host pours 3 into Ben's ORIGINAL socket id, then Ben's phone reconnects.
      room.assignDrinks(room.host, [{ player: ben, drinks: 3 }]);
      await sleep(200);
      const { fresh } = await dropAndRejoin(room, ben);

      await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, sinceHost);

      // 1 from First Down + 3 assigned. Today this is 0: finalizeRound sums the
      // totals at server.js:128 and broadcasts them at :142, but the socket-id
      // merge that would move Ben's drinks onto his new id does not run until
      // :159 — and its result is thrown away at :219.
      expect(h.totalsFor(room.host, fresh.id).totalDrinks).toBe(4);
    }
  );

  // ── 9b ───────────────────────────────────────────────────────────────────
  it.fails(
    '9b. TIER B: drinks follow a player through two reconnects in one round (A to B to C)',
    async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const sinceHost = room.host.mark();
      expect(await room.declareFirstDown()).toBe('declared');

      room.assignDrinks(room.host, [{ player: ben, drinks: 3 }]);
      await sleep(200);

      const first = await dropAndRejoin(room, ben);
      const second = await dropAndRejoin(room, first.fresh);

      await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, sinceHost);

      expect(h.totalsFor(room.host, second.fresh.id).totalDrinks).toBe(4);
    }
  );

  // ── 10 ───────────────────────────────────────────────────────────────────
  it('10. the room survives everyone disconnecting and they can all come back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const names = room.all.map((p) => p.name);

    await playFirstDown(room);
    for (const player of room.all) await player.disconnect();
    await sleep(500);

    const returned = [];
    for (const name of names) {
      const fresh = await h.connect(name);
      const since = fresh.mark();
      fresh.emit('joinRoom', room.code, name);
      await fresh.waitFor('gameStarted', { since });
      returned.push(fresh);
    }

    await sleep(500);
    const roster = returned[0].view.players.filter((p) => !p.disconnected);
    expect(roster.map((p) => p.name).sort()).toEqual(['Ava', 'Ben', 'Cy']);
    for (const player of returned) {
      expect(player.view.hand.standard).toHaveLength(5);
      expect(player.view.stats[player.id].totalDrinks).toBe(1);
    }
  });

  // ── 11 ───────────────────────────────────────────────────────────────────
  it.fails(
    '11. TIER B: a player who was away when the quarter advanced still gets their wild-card swap',
    async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      await ben.disconnect();
      await sleep(250);
      await room.nextQuarter();

      const fresh = await h.connect('Ben');
      const since = fresh.mark();
      fresh.emit('joinRoom', room.code, 'Ben');
      await fresh.waitFor('gameStarted', { since });
      await sleep(600);

      // The client opens the swap modal off `quarterUpdated`, and a reconnecting
      // player is never sent one, so they silently lose their swap for that
      // quarter. Asserting the behaviour I think you want; expected to fail.
      expect(fresh.saw('quarterUpdated', since) || fresh.saw('wildCardSelection', since)).toBe(true);
    }
  );

  // ── 12 ───────────────────────────────────────────────────────────────────
  it('12. a game in progress keeps running when the room drops below 3 players', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    ben.emit('leaveGame', { roomCode: room.code });
    await room.host.waitFor('playerLeft', { where: (p) => p.remainingPlayers.length === 2 });

    // Two players left. The minimum of 3 is only enforced at startGame, so the
    // round machinery must still work for the people who stayed.
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    expect(h.totalsFor(room.host, cy.id).totalDrinks).toBe(1);
    expect(h.totalsFor(room.host, room.host.id).totalDrinks).toBe(1);
  });
});
