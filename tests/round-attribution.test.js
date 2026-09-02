/**
 * WHO called this round.
 *
 * An auto-called round rendered "THE REF DECLARED — TURNOVER". The feed called
 * it, not the Ref. That misattributes every automatic call and hides the whole
 * feature from everyone who is not holding the whistle.
 *
 * The suite had missed this class four times — off-screen sheets, "Away @ Home",
 * a dial that drew everything as "off", and this — because every test asserted
 * that a round STARTED and none asserted what it SAID. So these assert the
 * attribution itself, over real sockets.
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
const slice = (g, n) =>
  ({ ...g, plays: [...g.plays].sort((a, b) => a.sequence - b.sequence).slice(0, n) });

describe('who called the round', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: '3000' } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('says the GAME called a round the feed started', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: 'attribution-feed',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 100000,
    });

    const source = await ben.waitFor('roundSource', { since, timeout: 25_000 });
    expect(source.by, 'an auto-called round was attributed to the Ref').toBe('feed');
    expect(source.cardId).toBeTruthy();
    // The reason is what turns "Turnover" into "Turnover, and here is why".
    expect(source.reason, 'no reason carried through for the room to read')
      .toBeTruthy();
    // And it should read like football, not like a type name: ESPN's own
    // one-line summary names the players.
    expect(source.reason, `"${source.reason}" reads like a play type, not a play`)
      .toMatch(/[a-z]\s[A-Z]/);
  }, 60_000);

  it('says the REF called a round the Ref declared by hand', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    expect(await room.declareFirstDown()).toBe('declared');
    const source = await ben.waitFor('roundSource', { since, timeout: 8000 });
    expect(source.by).toBe('ref');
    expect(source.cardId).toBe('First Down');
  });

  it('treats an accepted suggestion as the Ref calling it', async () => {
    // The feed offered it; the Ref chose it. That is a Ref declaration.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('acceptSuggestion', { roomCode: room.code, cardId: 'First Down' });
    const source = await ben.waitFor('roundSource', { since, timeout: 8000 });
    expect(source.by, 'an accepted suggestion should read as the Ref calling it').toBe('ref');
  });

  it('reaches every player, not just the Ref', async () => {
    // The point of the change: a player who is not holding the whistle can see
    // that the game called this.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;
    const since = cy.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: 'attribution-all',
      replayFixture: slice(fixture('nfl', '401772877'), 60), speed: 100000,
    });
    const forCy = await cy.waitFor('roundSource', { since, timeout: 25_000 });
    expect(forCy.by).toBe('feed');
    expect(ben.saw('roundSource'), 'the other player never heard it').toBe(true);
  }, 60_000);

  it('does not attribute a round that never started', async () => {
    // A busy room refuses the declaration; nothing should claim to have called it.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    expect(await room.declareFirstDown()).toBe('declared');
    await sleep(300);

    const since = ben.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });   // busy
    await sleep(800);
    expect(ben.received('roundSource', since), 'a refused declaration was attributed')
      .toEqual([]);
  });
});

describe('the wording the room actually reads', () => {
  it('never credits the Ref for the feed, and always credits the Ref for the Ref', async () => {
    const { sourceLine } = await import('../client/src/lib/round-source.js');

    expect(sourceLine({ by: 'feed', cardId: 'Turnover', reason: 'Pass Interception Return' }))
      .toBe('The game called it · Pass Interception Return');
    expect(sourceLine({ by: 'feed', cardId: 'Turnover' })).toBe('The game called it');

    expect(sourceLine({ by: 'ref', cardId: 'Turnover' })).toBe('The Ref declared');
    expect(sourceLine({ by: 'ref', cardId: 'Safety' }, true)).toBe('Called · Ref confirmed');

    // A compound play runs long. It must not push the card name off the banner.
    const long = 'Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt '
      + '8 Yd Fumble Recovery by Cam Bynum For 8 Yd Loss';
    const line = sourceLine({ by: 'feed', cardId: 'Turnover', reason: long });
    expect(line.length).toBeLessThan(85);
    expect(line).toMatch(/^The game called it · /);
    expect(line).toMatch(/…$/);
    // Trimmed on a word boundary: what is left must be a real prefix of the
    // original, not a string cut through the middle of a name.
    const kept = line.replace('The game called it · ', '').replace('…', '');
    expect(long.startsWith(kept), `"${kept}" is not a clean prefix`).toBe(true);
    expect(kept.endsWith(' '), 'left a trailing space before the ellipsis').toBe(false);

    // Unknown source must never invent an attribution. Before the server has
    // said, the safe reading is the Ref — but it must not say "the game" .
    expect(sourceLine(null)).toBe('The Ref declared');
    expect(sourceLine(null)).not.toMatch(/game called/);
  });
});
