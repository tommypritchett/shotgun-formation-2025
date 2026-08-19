/**
 * T1 — the room-code allocator must be bounded.
 *
 * `createRoom` used to do `while (rooms[roomCode]) roomCode = generateRoomCode()`
 * with no cap. That is not a slow failure on a single-threaded server: measured
 * on this machine it spun 45,592,070 times in 3 seconds and never returned, so
 * the event loop is pinned and EVERY game on the box stops. Same blast radius
 * as the crash bug this branch started out fixing.
 *
 * The collision itself still cannot be provoked through a socket — it needs on
 * the order of 1,200 simultaneously-open rooms to be likely, and `Math.random`
 * has no seam the harness can control. So this test lifts the allocator out of
 * `server.js` source and drives it directly, which is the one way to reach the
 * exhaustion branch honestly. See BLOCKED.md B2.
 */
import { describe, expect, it } from 'vitest';
import { liftFromServer } from './helpers/lift-from-server.js';

const THIS_FILE = 'tests/room-code.test.js';

const generateRoomCode = liftFromServer(
  /const generateRoomCode = \(\) => \{[\s\S]*?\n\};/,
  'generateRoomCode',
  THIS_FILE
);

const ROOM_CODE_ATTEMPTS = liftFromServer(
  /const ROOM_CODE_ATTEMPTS = \d+;/,
  'ROOM_CODE_ATTEMPTS',
  THIS_FILE
);

// `allocateRoomCode` closes over `generateRoomCode` and `ROOM_CODE_ATTEMPTS`,
// so all three are evaluated together.
const allocateRoomCode = liftFromServer(
  /const generateRoomCode = \(\) => \{[\s\S]*?const allocateRoomCode = \(rooms\) => \{[\s\S]*?\n\};/,
  'allocateRoomCode',
  THIS_FILE
);

/** Every code in the 5-digit space, i.e. a server with nothing left to give. */
const everyCodeTaken = () => {
  const rooms = {};
  for (let code = 10000; code <= 99999; code += 1) rooms[String(code)] = { players: [] };
  return rooms;
};

describe('room code allocation', () => {
  it('gives up instead of spinning when every code is taken', () => {
    const rooms = everyCodeTaken();

    const started = Date.now();
    const result = allocateRoomCode(rooms);
    const elapsed = Date.now() - started;

    // The assertion that matters is that it RETURNS. Before the cap this line
    // was never reached.
    expect(result).toBeNull();
    expect(elapsed, 'allocator should give up immediately, not grind').toBeLessThan(1000);
  });

  it('returns a free code when the space is essentially empty', () => {
    expect(allocateRoomCode({})).toMatch(/^\d{5}$/);
  });

  it('skips codes that are already in use', () => {
    const rooms = everyCodeTaken();
    // Leave exactly one code free. A bounded allocator can miss it by chance,
    // so this asserts the only two honest outcomes: that code, or a clean null.
    delete rooms['54321'];

    const result = allocateRoomCode(rooms);
    if (result !== null) expect(result).toBe('54321');
  });

  it('never hands out a code that is taken, across many allocations', () => {
    const rooms = {};
    for (let i = 0; i < 300; i += 1) {
      const code = allocateRoomCode(rooms);
      expect(code, `ran out of codes after ${i} rooms`).not.toBeNull();
      expect(rooms[code], 'allocated a code that was already in use').toBeUndefined();
      rooms[code] = { players: [] };
    }
    expect(Object.keys(rooms)).toHaveLength(300);
  });

  it('caps attempts at a value that cannot trigger by accident', () => {
    // With half the space in use the odds of exhausting the cap are (1/2)^50.
    // If someone lowers this to a handful, collisions start failing real games.
    expect(ROOM_CODE_ATTEMPTS).toBeGreaterThanOrEqual(20);
    expect(generateRoomCode()).toMatch(/^\d{5}$/);
  });
});
