/**
 * Item 1 — `formerPlayers` belongs to a room, not to the server.
 *
 * The owner's rule: *"Former players should only be relevant if referencing an
 * active game code, and each room should only look at former players of their
 * game room number."*
 *
 * `formerPlayers` was keyed by player NAME, globally. One slot per name across
 * the whole server. Two concurrent games each with a Mike share that slot, so
 * the second Mike to drop overwrites the first Mike's drinks, shotguns and
 * hand. The first Mike then comes back to a `formerPlayers` entry stamped with
 * the OTHER room's code, fails the room check, and is admitted as a brand-new
 * player on zero — while the other Mike can be handed cards that were never
 * drawn from his own room's deck.
 *
 * This is the last member of the cross-room name-collision family that
 * `roomEntriesForName` was written to kill.
 *
 * The tests below are deliberately run in BOTH disconnect orders: with one
 * global slot, exactly one order looks fine, which is how this survived.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drop a player and bring them back on a fresh socket, as a phone would. */
const bounce = async (h, player, roomCode) => {
  await player.disconnect();
  await sleep(400);
  const fresh = await h.connect(player.name);
  const since = fresh.mark();
  fresh.emit('joinRoom', roomCode, player.name);
  await fresh.waitFor('gameStarted', { since });
  await sleep(500);
  return fresh;
};

/** Card names only — the identity of a hand, without object noise. */
const handNames = (hand) => ({
  standard: (hand?.standard || []).map((c) => c.card),
  wild: (hand?.wild || []).map((c) => c.card),
});

describe('former players are scoped to their room', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('gives each room\'s Mike back his own drinks and his own hand (A drops first)', async () => {
    const roomA = await h.newGame(['Ava', 'Mike', 'Cy']);
    const roomB = await h.newGame(['Bo', 'Mike', 'Dee']);
    const mikeA = roomA.guests[0];
    const mikeB = roomB.guests[0];

    const sinceA = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    roomA.assignDrinks(roomA.host, [{ player: mikeA, drinks: 3 }]);
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA);

    const sinceB = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    roomB.assignDrinks(roomB.host, [{ player: mikeB, drinks: 8 }]);
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB);

    const handA = handNames(mikeA.view.hand);
    const handB = handNames(mikeB.view.hand);

    await mikeA.disconnect();
    await sleep(300);
    await mikeB.disconnect();
    await sleep(400);

    const backA = await h.connect('Mike');
    let since = backA.mark();
    backA.emit('joinRoom', roomA.code, 'Mike');
    await backA.waitFor('gameStarted', { since });
    await sleep(400);

    const backB = await h.connect('Mike');
    since = backB.mark();
    backB.emit('joinRoom', roomB.code, 'Mike');
    await backB.waitFor('gameStarted', { since });
    await sleep(400);

    expect(handNames(backA.view.hand), 'room A\'s Mike came back with the wrong hand')
      .toEqual(handA);
    expect(handNames(backB.view.hand), 'room B\'s Mike came back with the wrong hand')
      .toEqual(handB);

    // And the totals survive on both sides.
    const sinceA2 = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA2);
    expect(h.totalsFor(roomA.host, backA.id).totalDrinks).toBe(5);

    const sinceB2 = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB2);
    expect(h.totalsFor(roomB.host, backB.id).totalDrinks).toBe(10);
  }, 90_000);

  it('gives each room\'s Mike back his own drinks and his own hand (B drops first)', async () => {
    const roomA = await h.newGame(['Ava', 'Mike', 'Cy']);
    const roomB = await h.newGame(['Bo', 'Mike', 'Dee']);
    const mikeA = roomA.guests[0];
    const mikeB = roomB.guests[0];

    const sinceA = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    roomA.assignDrinks(roomA.host, [{ player: mikeA, drinks: 3 }]);
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA);

    const sinceB = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    roomB.assignDrinks(roomB.host, [{ player: mikeB, drinks: 8 }]);
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB);

    const handA = handNames(mikeA.view.hand);
    const handB = handNames(mikeB.view.hand);

    await mikeB.disconnect();
    await sleep(300);
    await mikeA.disconnect();
    await sleep(400);

    const backB = await h.connect('Mike');
    let since = backB.mark();
    backB.emit('joinRoom', roomB.code, 'Mike');
    await backB.waitFor('gameStarted', { since });
    await sleep(400);

    const backA = await h.connect('Mike');
    since = backA.mark();
    backA.emit('joinRoom', roomA.code, 'Mike');
    await backA.waitFor('gameStarted', { since });
    await sleep(400);

    expect(handNames(backB.view.hand)).toEqual(handB);
    expect(handNames(backA.view.hand)).toEqual(handA);

    const sinceB2 = roomB.host.mark();
    expect(await roomB.declareFirstDown()).toBe('declared');
    await roomB.waitForFinalize(roomB.host, h.ROUND_SECONDS.firstDown, sinceB2);
    expect(h.totalsFor(roomB.host, backB.id).totalDrinks).toBe(10);

    const sinceA2 = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA2);
    expect(h.totalsFor(roomA.host, backA.id).totalDrinks).toBe(5);
  }, 90_000);

  it('leaves the connected Mike alone when the other room\'s Mike drops', async () => {
    const roomA = await h.newGame(['Ava', 'Mike', 'Cy']);
    const roomB = await h.newGame(['Bo', 'Mike', 'Dee']);
    const mikeA = roomA.guests[0];
    const mikeB = roomB.guests[0];

    const sinceA = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    roomA.assignDrinks(roomA.host, [{ player: mikeA, drinks: 3 }]);
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA);

    const handBefore = handNames(mikeA.view.hand);

    await mikeB.disconnect();
    await sleep(600);

    // Room A's Mike never went anywhere: same socket, same hand, same score.
    expect(handNames(mikeA.view.hand)).toEqual(handBefore);
    const sinceA2 = roomA.host.mark();
    expect(await roomA.declareFirstDown()).toBe('declared');
    await roomA.waitForFinalize(roomA.host, h.ROUND_SECONDS.firstDown, sinceA2);
    expect(h.totalsFor(roomA.host, mikeA.id).totalDrinks).toBe(5);
  }, 60_000);

  it('still restores a single room\'s player exactly as before', async () => {
    // The regression guard. Scoping the map must not cost the ordinary case.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    room.assignDrinks(room.host, [{ player: ben, drinks: 6 }]);
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    expect(h.totalsFor(room.host, ben.id).totalDrinks).toBe(7);

    const hand = handNames(ben.view.hand);
    const back = await bounce(h, ben, room.code);
    expect(handNames(back.view.hand)).toEqual(hand);

    const since2 = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since2);
    expect(h.totalsFor(room.host, back.id).totalDrinks).toBe(8);
  }, 60_000);
});

describe('a closed room cannot resurrect anybody', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => {
    h = await createHarness({
      env: { ROOM_IDLE_TIMEOUT_MS: '2500', ROOM_REAP_INTERVAL_MS: '300' },
    });
  });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('treats a player from a reaped room as brand new, not as a returning one', async () => {
    const dead = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = dead.guests;

    const since = dead.host.mark();
    expect(await dead.declareFirstDown()).toBe('declared');
    dead.assignDrinks(dead.host, [{ player: ben, drinks: 6 }]);
    await dead.waitForFinalize(dead.host, h.ROUND_SECONDS.firstDown, since);

    // Everyone goes home and the reaper closes the room.
    for (const p of dead.all) await p.disconnect();
    await sleep(3500);

    // The room really is gone.
    const stray = await h.connect('Ben');
    expect(await h.validateAndJoinRoom(stray, dead.code)).toBe('notFound');

    // A brand-new game with the same name starts from zero and a fresh hand.
    const fresh = await h.newGame(['Zoe', 'Ben', 'Kit']);
    const newBen = fresh.guests[0];
    expect(h.totalsFor(fresh.host, newBen.id).totalDrinks).toBe(0);

    const since2 = fresh.host.mark();
    expect(await fresh.declareFirstDown()).toBe('declared');
    await fresh.waitForFinalize(fresh.host, h.ROUND_SECONDS.firstDown, since2);
    expect(h.totalsFor(fresh.host, newBen.id).totalDrinks, 'the reaped room\'s '
      + 'drinks followed the name into a completely new game').toBe(1);
  }, 90_000);
});

/**
 * The legacy `requestGameState` fallback.
 *
 * Session 12 made the server match a returning socket to a seat by the NAME the
 * client sends, keeping index-0 selection only for a client that sends none.
 * The fallback was written as `claimed || (claimedName ? null : returning)` —
 * a self-reference inside its own initializer, which is a TDZ error, not a
 * fallback. A no-name request threw `Cannot access 'returning' before
 * initialization` and the client received nothing at all.
 *
 * Every current client sends a name (five emit sites in App.js, all with
 * `playerName`), so this only ever fired for a stale cached bundle — which is
 * exactly who is left holding it after a deploy.
 */
describe('a client that sends no name', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('still gets its seat back instead of silence', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    await ben.disconnect();
    await sleep(400);

    const fresh = await h.connect('Ben');
    const since = fresh.mark();
    fresh.emit('requestGameState', { roomCode: room.code });   // legacy payload

    const started = await fresh.waitFor('gameStarted', { since, timeout: 6000 });
    expect(started.hands[fresh.id], 'no hand came back').toBeTruthy();
    expect(h.logs()).not.toMatch(/Cannot access 'returning' before initialization/);
  });

  it('is still only a fallback — a name always wins', async () => {
    // Two players asleep in the same room. The one who names itself must get
    // its own seat, not whichever the map happens to list first.
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    room.assignDrinks(room.host, [{ player: cy, drinks: 5 }]);
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);

    await ben.disconnect();
    await sleep(200);
    await cy.disconnect();
    await sleep(400);

    const backCy = await h.connect('Cy');
    const s2 = backCy.mark();
    backCy.emit('requestGameState', { roomCode: room.code, playerName: 'Cy' });
    await backCy.waitFor('gameStarted', { since: s2, timeout: 6000 });
    await sleep(400);

    const s3 = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, s3);
    expect(h.totalsFor(room.host, backCy.id).totalDrinks, 'Cy was handed the '
      + 'wrong seat').toBe(7);
  }, 60_000);
});
