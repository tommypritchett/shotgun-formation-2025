/**
 * "Suggest" has to actually ask.
 *
 * The dial offers three settings per card, and the middle one is the whole
 * point of the feature: let the feed spot it, but let the Ref decide. This was
 * silently broken — suggestions were gated on the card's GLOBAL DEFAULT mode
 * rather than the room's, so moving a card whose default is auto onto suggest
 * meant it was skipped at release time and never suggested either. "Suggest"
 * meant "off", and most of Tier A defaults to auto.
 *
 * Found by recording a walkthrough: three cards were put on suggest and not one
 * suggestion appeared in twelve minutes.
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

describe('a card set to suggest', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { BROADCAST_DELAY_MS: String(DELAY_MS) } });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  const attach = (room) => room.host.emit('attachGame', {
    roomCode: room.code, league: 'nfl', gameId: '401772877',
    replayFixture: slice(fixture('nfl', '401772877'), 40), speed: 100000,
  });

  it('asks the Ref instead of calling it', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('setCardMode', { roomCode: room.code, cardId: 'First Down', mode: 'suggest' });
    await ben.waitFor('cardModes', { timeout: 6000 });

    const since = room.host.mark();
    const benSince = ben.mark();
    attach(room);
    await sleep(DELAY_MS + 4_000);

    const suggested = room.host.received('playSuggested', since).map((p) => p.cardId);
    expect(suggested, 'First Down was set to suggest and never asked').toContain('First Down');

    // And it must not have been called anyway — asking and calling are exclusive.
    const called = ben.received('playAutoCalled', benSince).map((p) => p.cardId);
    expect(called, 'a suggested card was auto-called as well').not.toContain('First Down');
  }, 45_000);

  it('asks the Ref alone, not the room', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('setCardMode', { roomCode: room.code, cardId: 'First Down', mode: 'suggest' });
    await ben.waitFor('cardModes', { timeout: 6000 });

    const since = ben.mark();
    attach(room);
    await sleep(DELAY_MS + 4_000);

    expect(ben.saw('playSuggested', since), 'a player saw the Ref\'s suggestion').toBe(false);
  }, 45_000);

  it('stays silent when the card is off, rather than suggesting it', async () => {
    // The obvious wrong fix is "anything not auto gets suggested", which turns
    // every card the Ref switched OFF into a prompt — the opposite of what they
    // asked for.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('setCardMode', { roomCode: room.code, cardId: 'First Down', mode: 'off' });
    await ben.waitFor('cardModes', { timeout: 6000 });

    const since = room.host.mark();
    attach(room);
    await sleep(DELAY_MS + 4_000);

    const suggested = room.host.received('playSuggested', since).map((p) => p.cardId);
    expect(suggested, 'a card switched off still prompted the Ref').not.toContain('First Down');
  }, 45_000);
});
