/**
 * Phase 2c — the awkward cases.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A real card that lives in the Wild deck, so it can never be in a Standard hand. */
const NEVER_IN_STANDARD_HAND = 'Safety';

describe('edge cases', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => {
    h = await createHarness();
  });

  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('reports "no card" and frees the room when nobody holds the declared card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    const since = room.host.mark();
    expect(await room.declareStandard(NEVER_IN_STANDARD_HAND)).toBe('noCard');
    expect(await room.host.waitFor('noCard', { since, where: (m) => !!m })).toMatch(/no one/i);

    // The message clears itself and the room is immediately usable again.
    expect(await room.declareFirstDown()).toBe('declared');
    expect(room.host.saw('actionInProgress', since)).toBe(false);
  });

  it('rejects a second declaration while a round is already open', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    expect(await room.declareFirstDown()).toBe('busy');

    const message = await room.host.waitFor('actionInProgress', { since });
    expect(String(message)).toMatch(/in progress/i);

    // The rejection is clean: the first round still finalizes normally and the
    // double declaration did not double anyone's drinks.
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    for (const player of room.all) {
      expect(h.totalsFor(room.host, player.id).totalDrinks).toBe(1);
    }
  });

  it('runs a 13-player room', async () => {
    const names = Array.from({ length: 13 }, (_, i) => `P${i + 1}`);
    const room = await h.newGame(names);

    expect(room.all).toHaveLength(13);
    for (const player of room.all) {
      expect(player.view.hand.standard).toHaveLength(5);
      expect(player.view.hand.wild).toHaveLength(2);
    }

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    for (const player of room.all) {
      expect(h.totalsFor(room.host, player.id).totalDrinks).toBe(1);
    }
  }, 120_000);

  it('never deals an empty card under sustained play', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    // 3 players => a 129-card Wild deck, 6 dealt, 123 left. Replenishment kicks
    // in at <=12, so 200 swaps forces at least one full recycle of the discard
    // pile (verified: "Wild deck low (12 cards). Shuffling 111 used cards back
    // in."). Swapping has no round timer, which is the only way to drive this
    // many draws in seconds rather than an hour of 21-second rounds.
    for (let i = 0; i < 200; i += 1) {
      const hand = await room.swapWildCard(ben, ben.view.hand.wild[0]);
      expect(hand.wild, `hand emptied on swap ${i + 1}`).toHaveLength(2);
      for (const card of hand.wild) {
        expect(card, `swap ${i + 1} dealt an empty slot`).toBeTruthy();
        expect(typeof card.card, `swap ${i + 1} dealt a malformed card`).toBe('string');
        expect(typeof card.drinks).toBe('number');
      }
    }
  }, 120_000);

  it('tells a player the room does not exist rather than hanging', async () => {
    const stray = await h.connect('Stray');
    expect(await h.validateAndJoinRoom(stray, '00000')).toBe('notFound');

    // The plain joinRoom path reports it as an error instead.
    const other = await h.connect('Wanderer');
    const since = other.mark();
    other.emit('joinRoom', '00001', 'Wanderer');
    expect(String(await other.waitFor('error', { since }))).toMatch(/not found/i);
  });

  it('issues distinct 5-digit room codes', async () => {
    // NOTE: generateRoomCode picks at random with NO collision check, so this
    // asserts the format and that small batches are distinct in practice. The
    // collision risk itself is a Tier B finding — see OVERNIGHT_REPORT.md.
    const codes = [];
    for (let i = 0; i < 25; i += 1) {
      const host = await h.connect(`Host${i}`);
      const code = await h.createRoom(host);
      expect(code).toMatch(/^\d{5}$/);
      codes.push(code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  }, 60_000);

  it('ignores game actions aimed at a room that does not exist', async () => {
    const stray = await h.connect('Stray');
    const since = stray.mark();

    stray.emit('firstDownEvent', { roomCode: '00000' });
    stray.emit('playStandardCard', { roomCode: '00000', cardType: 'Touchdown' });
    stray.emit('assignDrinks', {
      roomCode: '00000',
      selectedPlayerIds: [stray.id],
      drinksToGive: { [stray.id]: 3 },
      shotgunsToGive: {},
    });
    stray.emit('nextQuarter', { roomCode: '00000' });
    await sleep(500);

    // No response, and critically no crash.
    expect(stray.saw('declaredCard', since)).toBe(false);
    expect(h.crashed()).toBeNull();
  });
});
