/**
 * Phase 2 (extra) — the socket events the other suites don't reach.
 *
 * These are the parts of the client/server contract the UI rebuild must not
 * break. Locking them down now means Phase 3 can move code around freely and
 * find out immediately if it changes what goes over the wire.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('socket contract', () => {
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

  describe('host handover', () => {
    it('lets the Ref hand the whistle to a named player', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const since = ben.mark();
      room.host.emit('assignNewHost', { roomCode: room.code, newHostId: ben.id });

      const handover = await ben.waitFor('newHost', { since });
      expect(handover.newHostId).toBe(ben.id);
      expect(handover.message).toMatch(/Ben/);

      // The new host can run a round; that is what being host means.
      const sinceRound = ben.mark();
      ben.emit('firstDownEvent', { roomCode: room.code });
      await ben.waitFor('declaredCard', { since: sinceRound, where: (c) => c === 'First Down' });
    });

    it('ignores a non-host trying to reassign the host', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben, cy] = room.guests;

      const since = room.host.mark();
      ben.emit('assignNewHost', { roomCode: room.code, newHostId: cy.id });
      await sleep(500);

      expect(room.host.saw('newHost', since)).toBe(false);
    });

    it('keeps the lobby open when the host leaves before kickoff', async () => {
      // This used to emit `hostLeft` and delete the room. See
      // tests/room-lifecycle.test.js for why that was the wrong rule: the room
      // belongs to the table, and only the idle reaper closes it.
      const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const since = ben.mark();
      room.host.emit('leaveRoom', room.code);

      expect(String((await ben.waitFor('newHost', { since })).message))
        .toMatch(/host has left/i);
      expect(ben.saw('hostLeft', since), 'still telling the room it is closing')
        .toBe(false);

      const latecomer = await h.connect('Dee');
      expect(await h.validateAndJoinRoom(latecomer, room.code)).toBe('lobby');
    });
  });

  describe('round locking', () => {
    it('turns away a wild card selection while a round is open', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      expect(await room.declareFirstDown()).toBe('declared');

      const sinceBen = ben.mark();
      const sinceHost = room.host.mark();
      ben.emit('wildCardSelected', {
        roomCode: room.code,
        playerId: ben.id,
        wildcardtype: ben.view.hand.wild[0].card,
      });

      expect(String(await ben.waitFor('actionInProgress', { since: sinceBen })))
        .toMatch(/in progress/i);
      // Critically, the Host is never prompted to confirm it.
      expect(room.host.saw('wildCardSelected', sinceHost)).toBe(false);
    });

    it('counts the timer down from one below the round length', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);

      const since = room.host.mark();
      expect(await room.declareFirstDown()).toBe('declared');
      await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

      const ticks = room.host.received('updateTimer', since);
      // A 6-second round shows 5..0 — the client never sees "6".
      expect(ticks[0]).toBe(h.ROUND_SECONDS.firstDown - 1);
      expect(ticks[ticks.length - 1]).toBe(0);
      expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
    });
  });

  describe('drink parcels are private', () => {
    it('tells only the holders to pour', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);

      const cardType = room.host.view.hand.standard[0].card;
      const marks = room.all.map((p) => [p, p.mark()]);
      const since = room.host.mark();
      expect(await room.declareStandard(cardType)).toBe('declared');
      await sleep(500);

      for (const [player, mark] of marks) {
        const holdsIt = player.view.hand.standard.some((c) => c.card === cardType);
        const gotParcel = player.saw('distributeDrinks', mark);
        // A player is told to pour if and only if they were holding the card.
        expect(gotParcel, `${player.name} holds=${holdsIt} parcel=${gotParcel}`).toBe(holdsIt);
      }

      await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, since);
    });
  });

  describe('resync and refresh', () => {
    it('replays the game state on request without disturbing anyone else', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben, cy] = room.guests;

      const sinceBen = ben.mark();
      const sinceCy = cy.mark();
      ben.emit('requestGameState', { roomCode: room.code });

      const state = await ben.waitFor('gameStarted', { since: sinceBen });
      expect(state.hands[ben.id].standard).toHaveLength(5);
      expect(state.hands[ben.id].wild).toHaveLength(2);

      const roster = await h.waitForPlayerCount(ben, 3, { since: sinceBen });
      expect(roster.map((p) => p.name).sort()).toEqual(['Ava', 'Ben', 'Cy']);

      await sleep(300);
      expect(cy.saw('gameStarted', sinceCy)).toBe(false);
    });

    it('sends the lobby state on request before kickoff', async () => {
      const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const since = ben.mark();
      ben.emit('requestGameState', { roomCode: room.code });
      expect(await ben.waitFor('joinedRoom', { since })).toBe(room.code);
    });

    it('honours the 5-second cooldown on forced refreshes', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben] = room.guests;

      const since = ben.mark();
      const ask = () =>
        ben.emit('requestRefresh', { roomCode: room.code, playerName: 'Ben', reason: 'test' });

      ask();
      const refresh = await ben.waitFor('forceRefresh', { since });
      expect(refresh.playerName).toBe('Ben');

      // A client stuck in a reload loop must not be able to hammer itself.
      ask();
      ask();
      await sleep(600);
      expect(ben.received('forceRefresh', since)).toHaveLength(1);
    });
  });

  describe('keepalive', () => {
    it('sends a heartbeat the client can acknowledge', async () => {
      const player = await h.connect('Ava');
      const beat = await player.waitFor('heartbeat', { timeout: 15_000 });
      expect(typeof beat.timestamp).toBe('number');

      player.emit('heartbeat-ack', { timestamp: beat.timestamp });
      await sleep(300);
      expect(h.crashed()).toBeNull();
    }, 20_000);
  });

  describe('ending a game', () => {
    it('holds the room open after the last player has left', async () => {
      const room = await h.newGame(['Ava', 'Ben', 'Cy']);
      const [ben, cy] = room.guests;

      ben.emit('leaveGame', { roomCode: room.code });
      await room.host.waitFor('playerLeft', { where: (p) => p.remainingPlayers.length === 2 });
      cy.emit('leaveGame', { roomCode: room.code });
      await room.host.waitFor('playerLeft', { where: (p) => p.remainingPlayers.length === 1 });

      const since = room.host.mark();
      room.host.emit('leaveGame', { roomCode: room.code });
      expect(String(await room.host.waitFor('gameOver', { since }))).toMatch(/ending/i);

      // The last one out is told the game is over — but the room is kept, in
      // case any of them left by accident. The reaper closes it later.
      const latecomer = await h.connect('Dee');
      expect(await h.validateAndJoinRoom(latecomer, room.code)).not.toBe('notFound');
    });
  });
});
