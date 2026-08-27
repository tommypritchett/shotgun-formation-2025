/**
 * Closing a room must leave nothing behind.
 *
 * The server holds a room's state across seven maps keyed three different
 * ways: by room code (`rooms`, `usedCards`, `roundResults`, `activeRounds`,
 * `socketIdMappings`), by socket id (`playerStats`), and by player NAME
 * (`formerPlayers`). Every teardown in the codebase deleted two of them —
 * `rooms` and `usedCards` — and left the rest. On a server that never
 * restarts, that is a leak with teeth: a stale `formerPlayers` entry hands the
 * next player who uses that name somebody else's drinks and somebody else's
 * hand.
 *
 * `purgeRoomState` takes its maps as an argument precisely so this can be
 * tested directly, on the real function lifted out of `server.js`.
 */
import { describe, expect, it } from 'vitest';
import { liftFromServer, SERVER_SOURCE } from './helpers/lift-from-server.js';

const purgeRoomState = liftFromServer(
  /const purgeRoomState = \(roomCode, state\) => \{[\s\S]*?\n\};/,
  'purgeRoomState',
  'tests/room-teardown.test.js'
);

/** Two rooms' worth of state, so the test can prove the neighbour survives. */
const makeState = () => ({
  rooms: {
    AAA: { players: [{ id: 's1', name: 'Ava' }, { id: 's2', name: 'Ben' }], host: 's1' },
    BBB: { players: [{ id: 's9', name: 'Zed' }], host: 's9' },
  },
  playerStats: {
    s1: { totalDrinks: 4 }, s2: { totalDrinks: 1 },
    old1: { totalDrinks: 4 },        // Ava's socket before she reconnected
    ghost: { totalDrinks: 7 },       // only the round results remember this one
    s9: { totalDrinks: 2 },
  },
  roundResults: { AAA: { s1: 3, ghost: 1 }, BBB: { s9: 2 } },
  formerPlayers: {
    Ava: { name: 'Ava', roomCode: 'AAA', totalDrinks: 4 },
    Zed: { name: 'Zed', roomCode: 'BBB', totalDrinks: 2 },
  },
  usedCards: { AAA: { standard: [], wild: [] }, BBB: { standard: [], wild: [] } },
  activeRounds: { AAA: { declaredCard: 'Touchdown' }, BBB: { declaredCard: 'Sack' } },
  socketIdMappings: { AAA: { old1: 's1' }, BBB: {} },
});

describe('purging a room', () => {
  it('clears every map the room appears in', () => {
    const state = makeState();
    expect(purgeRoomState('AAA', state)).toBe(true);

    expect(state.rooms.AAA).toBeUndefined();
    expect(state.roundResults.AAA).toBeUndefined();
    expect(state.activeRounds.AAA).toBeUndefined();
    expect(state.socketIdMappings.AAA).toBeUndefined();
    expect(state.usedCards.AAA).toBeUndefined();
  });

  it('clears the stats of every socket id the room ever used', () => {
    const state = makeState();
    purgeRoomState('AAA', state);

    // Current players, the id Ava reconnected FROM, and an id only the round
    // results remembered. Any of these left behind is a permanent leak.
    expect(Object.keys(state.playerStats).sort()).toEqual(['s9']);
  });

  it('forgets the players by name, so nobody inherits their drinks', () => {
    const state = makeState();
    purgeRoomState('AAA', state);
    expect(state.formerPlayers.Ava).toBeUndefined();
  });

  it('leaves every other room completely alone', () => {
    const state = makeState();
    purgeRoomState('AAA', state);

    expect(state.rooms.BBB).toBeTruthy();
    expect(state.roundResults.BBB).toEqual({ s9: 2 });
    expect(state.activeRounds.BBB).toEqual({ declaredCard: 'Sack' });
    expect(state.socketIdMappings.BBB).toEqual({});
    expect(state.usedCards.BBB).toBeTruthy();
    expect(state.formerPlayers.Zed).toBeTruthy();
    expect(state.playerStats.s9).toEqual({ totalDrinks: 2 });
  });

  it('reports a room that was not there rather than pretending', () => {
    const state = makeState();
    expect(purgeRoomState('NOPE', state)).toBe(false);
  });

  it('survives a half-built room, because teardown runs on the bad days', () => {
    expect(() => purgeRoomState('AAA', { rooms: { AAA: {} } })).not.toThrow();
    expect(() => purgeRoomState('AAA', {})).not.toThrow();
  });
});

describe('nothing else closes rooms', () => {
  /** Code only — a `delete rooms[...]` inside a comment is not a teardown. */
  const code = SERVER_SOURCE.split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

  it('deletes rooms in exactly one place', () => {
    const deletions = code.match(/delete rooms\[/g) || [];
    expect(
      deletions.length,
      'a second `delete rooms[...]` has appeared. Every teardown must go '
        + 'through destroyRoom/purgeRoomState or it will leak the other six maps.'
    ).toBe(1);
    expect(code).toMatch(/delete rooms\[roomCode\];\n\s*return Boolean\(room\)/);
  });

  it('keeps the idle window as one named constant', () => {
    expect(code).toMatch(/const ROOM_IDLE_TIMEOUT_MS = /);
    // Half an hour, spelled so it reads as half an hour.
    expect(code).toMatch(/ROOM_IDLE_TIMEOUT_MS = Number\(process\.env\.ROOM_IDLE_TIMEOUT_MS\) \|\| 30 \* 60 \* 1000/);
  });

  it('never lets the host closing their app close the room', () => {
    expect(
      code,
      "the lobby still emits `hostLeft`, which tells everyone else the room is "
        + 'closing — it is not, and the client resets to the start screen on it'
    ).not.toMatch(/emit\('hostLeft'/);
  });

  it('reads a leaving player\'s stats defensively', () => {
    // The one path that reads playerStats without having just written it.
    expect(code).not.toMatch(/totalDrinks: playerStats\[socket\.id\]\.totalDrinks/);
    expect(code).toMatch(/const leavingStats = playerStats\[socket\.id\] \|\| \{\};/);
  });
});
