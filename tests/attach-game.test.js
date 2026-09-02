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

describe('the feed declaring', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  // The real 45 seconds, on a short clock. Same code path, same queue, same
  // release tick — just not a 45-second wait inside a test suite.
  const DELAY_MS = 4_000;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('starts a real round, through the same path the Ref uses', async () => {
    // Session 16 deliberately declared nothing; Session 17 is where it starts.
    // What matters is that the round is indistinguishable from a Ref's: the
    // same declaredCard broadcast and the same countdown.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 100000,
    });

    const declared = await ben.waitFor('declaredCard', { since, timeout: DELAY_MS + 15_000 });
    expect(declared, 'the feed never declared a card').toBeTruthy();
    // The countdown ticks once a second, so wait for the first one rather than
    // racing it.
    await ben.waitFor('updateTimer', { since, timeout: 6000 });

    const called = ben.received('playAutoCalled', since);
    expect(called.length).toBeGreaterThan(0);
    expect(called[0].declared).toBe(true);
  }, 60_000);

  it('tells the room once that the feed is calling', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 6), speed: 100000,
    });

    const attached = await ben.waitFor('gameAttached', { since, timeout: 6000 });
    expect(attached.announce, 'nobody was told rounds would start on their own')
      .toMatch(/calling this game/i);
  });

  it('holds everything for the broadcast delay before declaring', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 40), speed: 100000,
    });

    // Well after every play has been detected, but inside the delay window.
    await sleep(Math.floor(DELAY_MS / 2));
    expect(ben.saw('declaredCard', since),
      'a call escaped before the broadcast delay — this spoils the play').toBe(false);
  }, 40_000);

  it('declares nothing at all while auto-calling is paused', async () => {
    // The escape hatch: one tap, no detach, score header intact.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 100000,
    });
    await ben.waitFor('gameAttached', { timeout: 6000 });

    const since = ben.mark();
    room.host.emit('pauseAutoCall', { roomCode: room.code, paused: true });
    await ben.waitFor('autoCallPaused', { since, timeout: 6000 });

    await sleep(DELAY_MS + 3_000);
    expect(ben.saw('declaredCard', since), 'a paused room still had a round started')
      .toBe(false);
    // The game is still attached: the header keeps working.
    expect(ben.saw('gameDetached', since)).toBe(false);
  }, 60_000);

  it('lets a manual declaration win and clears what was queued', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    // Slow enough that detections are still WAITING out the delay when the Ref
    // steps in. At full speed the feed finishes and drains before anyone could.
    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 40,
    });
    await ben.waitFor('gameAttached', { timeout: 6000 });
    await sleep(2_000);                      // let a few detections queue up

    const since = ben.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await sleep(500);
    const cleared = ben.received('queueCleared', since);
    expect(cleared.length, 'the Ref declared but the queue was not cleared')
      .toBeGreaterThan(0);
  }, 60_000);
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
