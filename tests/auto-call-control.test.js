/**
 * The controls that matter when it goes wrong in front of people.
 *
 * The feature now affects live play, so these are the paths worth testing hard:
 * turning a card down, pausing everything instantly, and the feed dying without
 * taking the game with it.
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
const slice = (game, n) =>
  ({ ...game, plays: [...game.plays].sort((a, b) => a.sequence - b.sequence).slice(0, n) });

const DELAY_MS = 3_000;

describe('turning a card down', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('stops calling a card set to off, without a code change', async () => {
    // This is the dial's whole point: tuned after a real game night, on a
    // phone, without anyone touching the source.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('setCardMode', { roomCode: room.code, cardId: 'First Down', mode: 'off' });
    await ben.waitFor('cardModes', { timeout: 6000 });

    const since = ben.mark();
    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 40), speed: 100000,
    });
    await sleep(DELAY_MS + 4_000);

    const called = ben.received('playAutoCalled', since).map((p) => p.cardId);
    expect(called, 'First Down was turned off and still fired').not.toContain('First Down');
  }, 45_000);

  it('refuses a mode change from anyone but the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    ben.emit('setCardMode', { roomCode: room.code, cardId: 'Touchdown', mode: 'off' });
    await sleep(600);
    expect(ben.saw('cardModes', since), 'a non-Ref changed the dial').toBe(false);
  });

  it('will not turn on a card that has no signal', async () => {
    // Fake Punt/FG cannot fire from this feed. The dial must not imply it can.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const since = room.host.mark();

    room.host.emit('setCardMode', { roomCode: room.code, cardId: 'Fake Punt/FG', mode: 'auto' });
    await sleep(600);
    expect(room.host.saw('cardModes', since)).toBe(false);
  });
});

describe('the pause control', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('keeps the game attached, so the score header survives', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 30), speed: 200,
    });
    await ben.waitFor('gameAttached', { timeout: 6000 });

    const since = ben.mark();
    room.host.emit('pauseAutoCall', { roomCode: room.code, paused: true });
    const paused = await ben.waitFor('autoCallPaused', { since, timeout: 6000 });

    expect(paused.paused).toBe(true);
    expect(ben.saw('gameDetached', since), 'pausing detached the game').toBe(false);
    // The feed keeps running, so the header keeps updating.
    await ben.waitFor('gameFeedUpdate', { since, timeout: 8000 });
  }, 45_000);

  it('leaves the Ref able to declare by hand while paused', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 20), speed: 200,
    });
    await ben.waitFor('gameAttached', { timeout: 6000 });
    room.host.emit('pauseAutoCall', { roomCode: room.code, paused: true });
    await ben.waitFor('autoCallPaused', { timeout: 6000 });

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(1);
  }, 60_000);

  it('is refused to anyone but the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();
    ben.emit('pauseAutoCall', { roomCode: room.code, paused: true });
    await sleep(600);
    expect(ben.saw('autoCallPaused', since)).toBe(false);
  });
});

describe('when the feed dies', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('says so, and drains rather than firing late', async () => {
    // Going silently quiet is indistinguishable from a dull patch of football,
    // which is the one thing this must not do.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 12), speed: 100000,
    });

    const ended = await ben.waitFor('gameFeedEnded', { since, timeout: 10_000 });
    expect(ended).toHaveProperty('reason');
    expect(ended).toHaveProperty('dropped');
  }, 30_000);

  it('leaves an ordinary game of Shotgun Formation behind', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: slice(fixture('nfl', '401772877'), 8), speed: 100000,
    });
    await ben.waitFor('gameFeedEnded', { timeout: 10_000 });

    // A round the feed started may still be running — that is the single-round
    // guard working, not a failure. Wait it out, then take over by hand.
    await sleep(DELAY_MS + 2_000);
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, 0).catch(() => {});

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    for (const player of room.all) {
      expect(h.totalsFor(room.host, player.id).totalDrinks).toBeGreaterThan(0);
    }
  }, 60_000);
});
