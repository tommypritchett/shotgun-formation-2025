/**
 * Smoke tests for the harness itself. If these fail, nothing else means anything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

describe('harness', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    await h.teardown();
  });

  it('boots the real server on an isolated port', () => {
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('creates a room with a 5-digit code and a host', async () => {
    const room = await h.newRoom(['Ava']);
    expect(room.code).toMatch(/^\d{5}$/);
    expect(room.host.view.roomCode).toBe(room.code);
  });

  it('joins players into a lobby and tells everyone who is there', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    const names = room.host.view.players.map((p) => p.name).sort();
    expect(names).toEqual(['Ava', 'Ben', 'Cy']);
    expect(room.guests[0].view.players).toHaveLength(3);
  });

  it('refuses to start a game with fewer than 3 players', async () => {
    const room = await h.newRoom(['Ava', 'Ben']);
    const since = room.host.mark();
    room.host.emit('startGame', room.code);
    await new Promise((r) => setTimeout(r, 500));
    expect(room.host.saw('gameStarted', since)).toBe(false);
  });

  it('starts a game and deals 5 standard + 2 wild to every player', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    for (const player of room.all) {
      expect(player.view.gameStarted).toBe(true);
      expect(player.view.hand.standard).toHaveLength(5);
      expect(player.view.hand.wild).toHaveLength(2);
    }
  });

  it('reports a room code that does not exist', async () => {
    const stray = await h.connect('Stray');
    const result = await h.validateAndJoinRoom(stray, '00000');
    expect(result).toBe('notFound');
  });
});
