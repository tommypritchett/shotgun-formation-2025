/**
 * The game ends somewhere.
 *
 * ── What was actually there ──────────────────────────────────────────────
 *
 * Every `gameOver` emit in server.js is an ABANDONMENT path: everyone left,
 * or everyone disconnected. There was no way for a table to deliberately
 * finish a game, so the most postable moment in the product could only be
 * reached by the last person still holding a phone — and the brief's "everyone
 * sees it, not just the Ref" was not achievable at all.
 *
 * So this adds `endGame` / `gameEnded`. Additive only: no existing event is
 * renamed and no existing payload changes (CLAUDE.md rule 2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('ending a game on purpose', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('tells EVERY player, not just the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const s1 = ben.mark();
    const s2 = cy.mark();

    room.host.emit('endGame', { roomCode: room.code });

    const a = await ben.waitFor('gameEnded', { since: s1, timeout: 6000 });
    const b = await cy.waitFor('gameEnded', { since: s2, timeout: 6000 });
    expect(a).toHaveProperty('standings');
    expect(b).toHaveProperty('standings');
  }, 30_000);

  it('carries the final standings, with both totals for everyone', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    // Put something on the board so "final" means something.
    const rs = room.host.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await room.host.waitFor('updatePlayerStats', {
      since: rs, timeout: 20_000, where: (p) => p && p.roundFinalized,
    });

    const since = ben.mark();
    room.host.emit('endGame', { roomCode: room.code });
    const ended = await ben.waitFor('gameEnded', { since, timeout: 6000 });

    expect(ended.standings).toHaveLength(3);
    for (const row of ended.standings) {
      expect(row).toHaveProperty('name');
      expect(Number.isFinite(row.totalDrinks)).toBe(true);
      expect(Number.isFinite(row.totalShotguns)).toBe(true);
    }
    expect(ended.standings.some((r) => r.totalDrinks > 0), 'nobody drank anything')
      .toBe(true);
  }, 60_000);

  it('is Ref-only, like every other room-wide action', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = cy.mark();
    ben.emit('endGame', { roomCode: room.code });
    await sleep(1200);
    expect(cy.saw('gameEnded', since), 'a player without the whistle ended the game')
      .toBe(false);
  }, 30_000);

  it('lands a RECONNECTING player on the finished game, not an empty join form', async () => {
    // Someone whose phone died in the fourth quarter should still see how it
    // ended — and still be able to share it.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('endGame', { roomCode: room.code });
    await ben.waitFor('gameEnded', { since: ben.mark(), timeout: 6000 });

    await ben.disconnect();
    await sleep(400);
    const back = await h.connect('Ben');
    const since = back.mark();
    back.emit('validateAndJoinRoom', room.code, 'Ben');

    const ended = await back.waitFor('gameEnded', { since, timeout: 8000 });
    expect(ended.standings, 'a returning player got no final standings').toBeTruthy();
  }, 30_000);

  it('play again puts the same people back in the same room', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    room.host.emit('endGame', { roomCode: room.code });
    await ben.waitFor('gameEnded', { since: ben.mark(), timeout: 6000 });

    const since = ben.mark();
    room.host.emit('playAgain', { roomCode: room.code });
    const roster = await ben.waitFor('returnedToLobby', { since, timeout: 6000 });

    expect(roster.roomCode, 'the room code changed').toBe(room.code);
    expect((roster.players || []).map((p) => p.name).sort())
      .toEqual(['Ava', 'Ben', 'Cy']);
  }, 30_000);

  it('play again clears the previous scores', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const rs = room.host.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await room.host.waitFor('updatePlayerStats', {
      since: rs, timeout: 20_000, where: (p) => p && p.roundFinalized,
    });

    room.host.emit('endGame', { roomCode: room.code });
    await ben.waitFor('gameEnded', { since: ben.mark(), timeout: 6000 });

    const since = ben.mark();
    room.host.emit('playAgain', { roomCode: room.code });
    await ben.waitFor('returnedToLobby', { since, timeout: 6000 });

    // A fresh game: start it and check nobody carries a score over.
    const s2 = ben.mark();
    room.host.emit('startGame', room.code);
    const started = await ben.waitFor('gameStarted', { since: s2, timeout: 8000 });
    const stats = Object.values(started.playerStats || {});
    expect(stats.length).toBeGreaterThan(0);
    for (const st of stats) {
      expect(st.totalDrinks || 0, `${st.name} carried a score into the new game`).toBe(0);
      expect(st.totalShotguns || 0).toBe(0);
    }
  }, 60_000);

  it('play again is Ref-only too', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    room.host.emit('endGame', { roomCode: room.code });
    await cy.waitFor('gameEnded', { since: cy.mark(), timeout: 6000 });

    const since = cy.mark();
    ben.emit('playAgain', { roomCode: room.code });
    await sleep(1200);
    expect(cy.saw('returnedToLobby', since), 'a player restarted the room').toBe(false);
  }, 30_000);

  it('survives nonsense without taking the server down', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    room.host.emit('endGame', {});
    room.host.emit('endGame', { roomCode: 'ZZZZZ' });
    room.host.emit('playAgain', {});
    room.host.emit('playAgain', { roomCode: 'ZZZZZ' });
    await sleep(900);
    h.assertAlive();
  }, 30_000);
});
