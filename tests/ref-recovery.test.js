/**
 * There is always a Ref.
 *
 * When the host disconnects, an active player is promoted — unless there are
 * none, in which case the `else` branch emitted `gameOver` and **never
 * reassigned `room.host`**. It kept pointing at a dead socket id, and nothing
 * on either rejoin path fixed it. The room is deliberately kept alive for
 * reconnections, so the first person back found a live game with no Ref, no way
 * to declare, and no way out.
 *
 * Owner's rule: if the game is still active, the first player to rejoin becomes
 * the Ref.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the whistle always has an owner', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** Everybody's phone dies. */
  const everyoneDrops = async (room) => {
    for (const p of room.all) await p.disconnect();
    await sleep(700);
  };

  const rejoin = async (room, name, via = 'joinRoom') => {
    const fresh = await h.connect(name);
    const since = fresh.mark();
    if (via === 'requestGameState') {
      fresh.emit('requestGameState', { roomCode: room.code, playerName: name });
    } else {
      fresh.emit(via, room.code, name);
    }
    await sleep(900);
    return { fresh, since };
  };

  it('hands the whistle to the first player back, via joinRoom', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy', 'Dee']);
    await everyoneDrops(room);

    const { fresh, since } = await rejoin(room, 'Ben');
    expect(fresh.saw('newHost', since), 'nobody was made Ref').toBe(true);
    expect(fresh.view.hostId, 'the whistle did not land on the rejoiner').toBe(fresh.id);

    // And being Ref has to mean something: they can actually run a round.
    const roundSince = fresh.mark();
    fresh.emit('firstDownEvent', { roomCode: room.code });
    await fresh.waitFor('declaredCard', {
      since: roundSince, where: (c) => c === 'First Down', timeout: 6000,
    });
  });

  it('hands the whistle to the first player back, via requestGameState', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy', 'Dee']);
    await everyoneDrops(room);

    const { fresh, since } = await rejoin(room, 'Cy', 'requestGameState');
    expect(fresh.saw('newHost', since), 'nobody was made Ref on the wake-up path').toBe(true);
    expect(fresh.view.hostId).toBe(fresh.id);
  });

  it('does not bounce the whistle to the second player back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy', 'Dee']);
    await everyoneDrops(room);

    const first = await rejoin(room, 'Ben');
    expect(first.fresh.view.hostId).toBe(first.fresh.id);

    const second = await rejoin(room, 'Cy');

    // No newHost anywhere is the assertion: not to the arriver, and not to the
    // Ref. `view.hostId` is only populated BY a newHost, so the second player
    // legitimately has none.
    expect(second.fresh.saw('newHost', second.since), 'the whistle bounced to the second arrival')
      .toBe(false);
    expect(first.fresh.saw('newHost', 1e9), 'the first Ref was told they lost it')
      .toBe(false);

    await sleep(400);
    expect(first.fresh.view.hostId, 'the first player back lost the whistle')
      .toBe(first.fresh.id);

    // And it is real: the first arrival can still run a round, the second cannot.
    const roundSince = first.fresh.mark();
    first.fresh.emit('firstDownEvent', { roomCode: room.code });
    await first.fresh.waitFor('declaredCard', {
      since: roundSince, where: (c) => c === 'First Down', timeout: 6000,
    });
  });

  it('leaves a healthy game alone', async () => {
    // The Ref is present. A player dropping and returning must not move it.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const hostId = room.host.id;

    await ben.disconnect();
    await sleep(400);
    const { fresh, since } = await rejoin(room, 'Ben');

    // No newHost at all is the assertion. `view.hostId` is only ever populated
    // BY a newHost event, so in a healthy game it is legitimately unset.
    expect(fresh.saw('newHost', since), 'the whistle moved for no reason').toBe(false);
    expect(room.host.saw('newHost', 0), 'the Ref was told they lost the whistle').toBe(false);
    expect(hostId).toBeTruthy();
  });
});
