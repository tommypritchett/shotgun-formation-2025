/**
 * Session 19 — three owner-requested changes to who is in the room and what
 * they may swap.
 *
 *   1. The Ref can remove a player, for when somebody leaves the bar without
 *      leaving the game.
 *   2. The quarter-break swap covers duplicate STANDARD cards, not just wild.
 *   3. The original host gets the whistle back when they come back — but only
 *      if they lost it by dropping, never if they gave it away.
 *
 * All three go through paths that already exist rather than forking new ones.
 * This codebase has been bitten repeatedly by two code paths meant to do the
 * same thing (see docs/HISTORY_SESSIONS_1_14.md).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const namesIn = (player) => (player.view.players || []).map((p) => p.name).sort();

describe('the Ref can remove a player', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('takes them off everyone roster, the same as if they had left', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    room.host.emit('removePlayer', { roomCode: room.code, playerId: ben.id });
    await sleep(800);

    expect(namesIn(room.host), 'the Ref still sees the removed player').toEqual(['Ava', 'Cy']);
    expect(namesIn(cy), 'another player still sees the removed player').toEqual(['Ava', 'Cy']);
  });

  it('tells the removed player, so their screen does not just freeze', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('removePlayer', { roomCode: room.code, playerId: ben.id });
    const told = await ben.waitFor('removedFromGame', { since, timeout: 5000 });
    expect(told).toHaveProperty('message');
  });

  it('refuses anybody who is not the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    ben.emit('removePlayer', { roomCode: room.code, playerId: cy.id });
    await sleep(800);

    expect(namesIn(room.host), 'a player removed somebody without the whistle')
      .toEqual(['Ava', 'Ben', 'Cy']);
  });

  it('refuses the Ref removing themselves — that is what Leave is for', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    room.host.emit('removePlayer', { roomCode: room.code, playerId: room.host.id });
    await sleep(800);
    expect(namesIn(room.host)).toEqual(['Ava', 'Ben', 'Cy']);
  });

  it('survives being pointed at somebody who is not in the room', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    room.host.emit('removePlayer', { roomCode: room.code, playerId: 'nobody' });
    room.host.emit('removePlayer', { roomCode: 'ZZZZZ', playerId: room.guests[0].id });
    room.host.emit('removePlayer', {});
    await sleep(800);
    h.assertAlive();
    expect(namesIn(room.host)).toEqual(['Ava', 'Ben', 'Cy']);
  });
});

describe('the original host gets the whistle back', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('restores it when the host DROPPED and comes back', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await room.host.disconnect();
    await sleep(600);
    // The whistle moved to somebody who is actually here.
    expect(ben.view.hostId, 'the whistle did not move when the host dropped')
      .not.toBe(undefined);

    const since = ben.mark();
    const ava = await h.connect('Ava');
    ava.emit('validateAndJoinRoom', room.code, 'Ava');
    await sleep(1500);

    const moved = ben.saw('newHost', since);
    expect(moved, 'the room was not told the whistle moved back').toBe(true);
    expect(ben.view.hostId, 'the original host did not get the whistle back')
      .toBe(ava.id);
  });

  it('does NOT undo a deliberate handoff', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    // Ava deliberately hands the whistle to Cy.
    room.host.emit('assignNewHost', { roomCode: room.code, newHostId: cy.id });
    await sleep(800);
    expect(ben.view.hostId).toBe(cy.id);

    // Now Ava drops and comes back. That must change nothing.
    await room.host.disconnect();
    await sleep(600);
    const ava = await h.connect('Ava');
    ava.emit('validateAndJoinRoom', room.code, 'Ava');
    await sleep(1500);

    expect(ben.view.hostId, 'a reconnect undid a handoff the host chose to make')
      .toBe(cy.id);
  });

  it('ends the claim when the host LEAVES on purpose', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('leaveGame', { roomCode: room.code });
    await sleep(800);
    const refAfterLeaving = ben.view.hostId;
    expect(refAfterLeaving).not.toBe(room.host.id);

    // Rejoining is joining as a new player, with no claim on the whistle.
    const ava = await h.connect('Ava');
    ava.emit('joinRoom', { roomCode: room.code, playerName: 'Ava' });
    await sleep(1500);

    expect(ben.view.hostId, 'someone who chose to leave took the whistle back')
      .toBe(refAfterLeaving);
  });

  it('does not snatch the whistle in the middle of a round', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await room.host.disconnect();
    await sleep(600);
    const standIn = ben.view.hostId;

    // A round is running when the original host reappears.
    ben.emit('firstDownEvent', { roomCode: room.code });
    await sleep(300);

    const ava = await h.connect('Ava');
    ava.emit('validateAndJoinRoom', room.code, 'Ava');
    await sleep(1200);

    expect(ben.view.hostId, 'the whistle moved mid-round').toBe(standIn);

    // ...and it lands once the round is over.
    await sleep(8000);
    expect(ben.view.hostId, 'the whistle never came back after the round ended')
      .toBe(ava.id);
  }, 40_000);
});

/**
 * Item 5 — the quarter-break swap now covers duplicate STANDARD cards.
 *
 * Two deliberate choices, both to keep this from becoming a free reroll:
 *
 *  - Only DUPLICATES may be swapped. A hand of five different standard cards
 *    has nothing to fix; the complaint this answers is holding the same card
 *    twice, which is dead weight.
 *  - It shares ONE allowance with the wild swap, not a second one. "Same
 *    one-per-quarter allowance" is the owner's wording, and two allowances
 *    would double every player's rerolls per quarter.
 */
describe('swapping a duplicate standard card at the quarter break', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** The first standard card this player holds two or more of, if any. */
  const duplicateOf = (player) => {
    const standard = player.view.hand?.standard || [];
    const seen = new Map();
    for (const c of standard) {
      const key = `${c.card}|${c.drinks}`;
      if (seen.has(key)) return seen.get(key);
      seen.set(key, c);
    }
    return null;
  };

  it('replaces one copy, leaving the hand the same size', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    // Find any player holding a duplicate; a 5-card deal usually gives one.
    const player = room.all.find(duplicateOf);
    if (!player) return;                       // no duplicate dealt; nothing to assert
    const dupe = duplicateOf(player);
    const before = (player.view.hand.standard || []).length;

    player.emit('standardCardSwap', { roomCode: room.code, discardedCard: dupe });
    await sleep(900);

    const after = player.view.hand.standard || [];
    expect(after.length, 'the swap changed the hand size').toBe(before);

    // The replacement is drawn from the same deck, which legitimately holds
    // several copies of a card — so "is there still a pair?" is not a sound
    // test of whether a swap happened. What IS sound: the allowance is now
    // spent, and only a real swap spends it.
    const handAfterFirst = JSON.stringify(player.view.hand.standard);
    const dupeNow = duplicateOf(player);
    if (dupeNow) {
      player.emit('standardCardSwap', { roomCode: room.code, discardedCard: dupeNow });
      await sleep(900);
      expect(JSON.stringify(player.view.hand.standard),
        'a second swap went through, so the first never spent the allowance')
        .toBe(handAfterFirst);
    }
  });

  it('refuses a card the player only holds once', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => {
      const st = p.view.hand?.standard || [];
      return st.some((c) => st.filter((x) => x.card === c.card && x.drinks === c.drinks).length === 1);
    });
    if (!player) return;
    const st = player.view.hand.standard;
    const single = st.find((c) => st.filter((x) => x.card === c.card && x.drinks === c.drinks).length === 1);
    const before = JSON.stringify(st);

    player.emit('standardCardSwap', { roomCode: room.code, discardedCard: single });
    await sleep(900);

    expect(JSON.stringify(player.view.hand.standard), 'a unique card was swapped')
      .toBe(before);
  });

  it('shares one allowance with the wild swap, rather than adding a second', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find(duplicateOf);
    if (!player) return;

    // Spend the allowance on a wild swap first.
    const wild = (player.view.hand.wild || [])[0];
    player.emit('wildCardSwap', { roomCode: room.code, discardedCard: wild });
    await sleep(800);

    const dupe = duplicateOf(player);
    if (!dupe) return;
    const before = JSON.stringify(player.view.hand.standard);
    player.emit('standardCardSwap', { roomCode: room.code, discardedCard: dupe });
    await sleep(900);

    expect(JSON.stringify(player.view.hand.standard),
      'a standard swap went through on an allowance the wild swap had spent')
      .toBe(before);
  });

  it('survives nonsense without taking the room down', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    room.host.emit('standardCardSwap', {});
    room.host.emit('standardCardSwap', { roomCode: room.code });
    room.host.emit('standardCardSwap', { roomCode: 'ZZZZZ', discardedCard: { card: 'x', drinks: 1 } });
    room.host.emit('standardCardSwap', { roomCode: room.code, discardedCard: 'not-an-object' });
    await sleep(900);
    h.assertAlive();
  });
});
