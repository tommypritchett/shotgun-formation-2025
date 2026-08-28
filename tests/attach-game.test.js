/**
 * Attaching a room to a live game.
 *
 * Everything here is additive. The assertions that matter most are the ones
 * about what did NOT change: a room that never attaches plays exactly as it
 * always has, and detaching leaves a perfectly normal game of Shotgun
 * Formation.
 *
 * The fixture is replayed through the real server, so this exercises the whole
 * path — feed, detector, queue, socket events — without a live game, on any day.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './helpers/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fixture = (league, id) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));

/** A short slice of a real game, so a test finishes in seconds. */
const slice = (game, count) => ({ ...game, plays: [...game.plays].sort((a, b) => a.sequence - b.sequence).slice(0, count) });

describe('attaching a game', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('lets the Ref attach and tells the whole room', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 8), speed: 100000,
    });

    const attached = await ben.waitFor('gameAttached', { since, timeout: 6000 });
    expect(attached.gameId).toBe('401772877');
    expect(attached.league).toBe('nfl');
  });

  it('refuses a player who is not the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    ben.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 4), speed: 100000,
    });
    await sleep(700);

    expect(ben.saw('gameAttached', since), 'a non-Ref attached a game').toBe(false);
  });

  it('sends the header its score, period and clock', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 12), speed: 100000,
    });

    const update = await ben.waitFor('gameFeedUpdate', { since, timeout: 8000 });
    expect(update).toHaveProperty('period');
    expect(update).toHaveProperty('clock');
    expect(update).toHaveProperty('homeScore');
  });

  it('detaches on the Ref\'s word and leaves an ordinary game behind', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 30), speed: 50,
    });
    await ben.waitFor('gameAttached', { timeout: 6000 });

    const since = ben.mark();
    room.host.emit('detachGame', { roomCode: room.code });
    await ben.waitFor('gameDetached', { since, timeout: 6000 });

    // The game itself is untouched: a round still runs exactly as before.
    const roundSince = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, roundSince);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(1);
  }, 60_000);
});

describe('what the feed would have called', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  // The real 45 seconds, on a short clock. Same code path, same queue, same
  // release tick — just not a 45-second wait inside a test suite.
  const DELAY_MS = 4_000;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('reports its calls without declaring anything', async () => {
    // The sequencing rule for this session: the queue fills, the delay applies,
    // everything is visible — and nothing declares a card. Wiring the
    // declaration in now would destroy the ability to run this repeatedly
    // against recorded games before it can affect anyone's night.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 100000,
    });

    // Long enough for the broadcast delay plus a release tick.
    await sleep(DELAY_MS + 2_500);

    const called = ben.received('playAutoCalled', since);
    expect(called.length, 'nothing was released after the delay').toBeGreaterThan(0);
    for (const payload of called) {
      expect(payload.wouldHaveCalled).toBe(true);
      expect(payload.cardId).toBeTruthy();
      expect(payload.playId).toBeTruthy();
    }

    // And the actual game never moved: no card was declared, no round ran.
    expect(ben.saw('declaredCard', since), 'the feed declared a card').toBe(false);
    expect(ben.saw('updateTimer', since), 'the feed started a round').toBe(false);
  }, 60_000);

  it('holds everything for the broadcast delay before saying anything', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 40), speed: 100000,
    });

    // Well after every play has been detected, but inside the delay window.
    await sleep(Math.floor(DELAY_MS / 2));
    expect(ben.received('playAutoCalled', since),
      'a call escaped before the broadcast delay — this spoils the play').toEqual([]);
  }, 40_000);
});

describe('a room with no game attached', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('plays exactly as it always has', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    for (const player of room.all) {
      expect(h.totalsFor(room.host, player.id).totalDrinks).toBe(1);
    }
  });

  it('never hears a feed event', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const since = room.host.mark();
    await sleep(1500);
    for (const event of ['gameAttached', 'gameFeedUpdate', 'playAutoCalled', 'playSuggested']) {
      expect(room.host.saw(event, since), `an unattached room heard ${event}`).toBe(false);
    }
  });
});
