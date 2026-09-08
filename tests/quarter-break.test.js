/**
 * Session 20 — the quarter break.
 *
 * Two owner changes that meet in the same moment, so they are tested together:
 *
 *  1. A player sheds ALL their duplicates in one action, not one card. The
 *     one-swap-per-quarter guard stays, but it now guards one CONFIRM rather
 *     than one card — the point is shedding redundancy, not rerolling a hand.
 *  2. The quarter advances on its own: driven by the real game's period when
 *     one is attached, and never in the middle of a round or a break.
 *
 * The guard from Session 3 is deliberately kept. It exists to stop repeated
 * swaps buying a better hand, and a reconnect must not buy a second go, so it
 * is still keyed by player NAME and still stores the quarter it was spent in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How many of this exact card the player holds in a deck. */
const countOf = (hand, deck, card) =>
  (hand?.[deck] || []).filter((c) => c && c.card === card.card && c.drinks === card.drinks).length;

/** Every card the player holds two or more of, with its count. */
const duplicatesIn = (hand, deck) => {
  const counts = new Map();
  for (const c of hand?.[deck] || []) {
    if (!c || !c.card) continue;
    const k = `${c.card}|${c.drinks}`;
    counts.set(k, { card: c, n: (counts.get(k)?.n || 0) + 1 });
  }
  return [...counts.values()].filter((e) => e.n >= 2);
};

describe('shedding every duplicate in one action', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('swaps several duplicates at once and keeps one of each', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => duplicatesIn(p.view.hand, 'standard').length > 0);
    if (!player) return;                       // no duplicate dealt this run

    const dupes = duplicatesIn(player.view.hand, 'standard');
    // Ask for every spare copy: n copies means n-1 may go.
    const cards = dupes.flatMap((e) =>
      Array.from({ length: e.n - 1 }, () => ({ ...e.card, deck: 'standard' })));
    const sizeBefore = (player.view.hand.standard || []).length;
    const since = player.mark();

    player.emit('swapDuplicates', { roomCode: room.code, cards });
    // The server acks with what it actually did. Asserting on the hand alone
    // is not sound: replacements come from the same deck, which holds several
    // copies of a card, so a swap can legitimately deal the same card back.
    const ack = await player.waitFor('swapResult', { since, timeout: 6000 });
    expect(ack.swapped, 'the server did not swap what was asked for')
      .toBe(cards.length);
    expect(ack.swapped, 'this test is asserting nothing — no spare copies were dealt')
      .toBeGreaterThan(0);
    await sleep(400);

    const after = player.view.hand;
    expect((after.standard || []).length, 'the hand changed size').toBe(sizeBefore);
    for (const e of dupes) {
      expect(countOf(after, 'standard', e.card),
        `${e.card.card}: every copy should not have gone — one is always kept`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses to take the last copy of a card', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => duplicatesIn(p.view.hand, 'standard').length > 0);
    if (!player) return;

    const e = duplicatesIn(player.view.hand, 'standard')[0];
    // Ask for ALL n copies — one more than allowed.
    const cards = Array.from({ length: e.n }, () => ({ ...e.card, deck: 'standard' }));
    const before = JSON.stringify(player.view.hand.standard);

    const since = player.mark();
    player.emit('swapDuplicates', { roomCode: room.code, cards });
    const ack = await player.waitFor('swapResult', { since, timeout: 6000 });
    expect(ack.swapped, 'taking every copy was allowed').toBe(0);
    expect(ack.refused, 'the refusal was silent').toBeTruthy();
    await sleep(300);

    expect(JSON.stringify(player.view.hand.standard),
      'the swap took every copy, leaving none').toBe(before);
  });

  it('refuses a card the player only holds one of', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => {
      const st = p.view.hand?.standard || [];
      return st.some((c) => countOf(p.view.hand, 'standard', c) === 1);
    });
    if (!player) return;
    const st = player.view.hand.standard;
    const lone = st.find((c) => countOf(player.view.hand, 'standard', c) === 1);
    const before = JSON.stringify(st);

    const since = player.mark();
    player.emit('swapDuplicates', { roomCode: room.code, cards: [{ ...lone, deck: 'standard' }] });
    const ack = await player.waitFor('swapResult', { since, timeout: 6000 });
    expect(ack.swapped, 'a card held once was swapped').toBe(0);
    await sleep(300);

    expect(JSON.stringify(player.view.hand.standard), 'a unique card was swapped').toBe(before);
  });

  it('is still ONE action per player per quarter', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => duplicatesIn(p.view.hand, 'standard').length > 0);
    if (!player) return;

    const first = duplicatesIn(player.view.hand, 'standard')[0];
    const since = player.mark();
    player.emit('swapDuplicates', {
      roomCode: room.code, cards: [{ ...first.card, deck: 'standard' }],
    });
    const ok = await player.waitFor('swapResult', { since, timeout: 6000 });
    expect(ok.swapped, 'the first swap did not go through, so this proves nothing').toBe(1);
    await sleep(400);
    const afterFirst = JSON.stringify(player.view.hand.standard);

    const again = duplicatesIn(player.view.hand, 'standard')[0];
    if (!again) return;
    const since2 = player.mark();
    player.emit('swapDuplicates', {
      roomCode: room.code, cards: [{ ...again.card, deck: 'standard' }],
    });
    const second = await player.waitFor('swapResult', { since: since2, timeout: 6000 });
    expect(second.swapped, 'a second confirm in the same quarter swapped cards').toBe(0);
    expect(second.refused).toBe('already swapped this quarter');
    await sleep(300);

    expect(JSON.stringify(player.view.hand.standard),
      'a second confirm in the same quarter went through').toBe(afterFirst);
  });

  it('covers the wild deck under the same rule', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const player = room.all.find((p) => duplicatesIn(p.view.hand, 'wild').length > 0);
    if (!player) return;
    const e = duplicatesIn(player.view.hand, 'wild')[0];
    const sizeBefore = (player.view.hand.wild || []).length;

    const since = player.mark();
    player.emit('swapDuplicates', {
      roomCode: room.code, cards: [{ ...e.card, deck: 'wild' }],
    });
    const ack = await player.waitFor('swapResult', { since, timeout: 6000 });
    expect(ack.swapped, 'the wild deck was not covered').toBe(1);
    await sleep(400);

    expect((player.view.hand.wild || []).length).toBe(sizeBefore);
    expect(countOf(player.view.hand, 'wild', e.card)).toBeGreaterThanOrEqual(1);
  });

  it('survives rubbish without taking the room down', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    room.host.emit('swapDuplicates', {});
    room.host.emit('swapDuplicates', { roomCode: room.code });
    room.host.emit('swapDuplicates', { roomCode: room.code, cards: 'nope' });
    room.host.emit('swapDuplicates', { roomCode: room.code, cards: [null, {}, 7] });
    room.host.emit('swapDuplicates', { roomCode: 'ZZZZZ', cards: [] });
    await sleep(900);
    h.assertAlive();
  });
});

describe('the break, and when the quarter turns over', () => {
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('tells the room a break has started, and that it is over', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('nextQuarter', { roomCode: room.code, force: true });
    const started = await ben.waitFor('quarterBreak', { since, timeout: 5000 });
    expect(started).toMatchObject({ open: true });

    // Everyone answers, so it should close without waiting out the timeout.
    for (const p of room.all) p.emit('swapDone', { roomCode: room.code });
    const ended = await ben.waitFor('quarterBreak', { since: ben.mark(), timeout: 8000 });
    expect(ended).toMatchObject({ open: false });
  }, 30_000);

  it('will not start a round while the break is open', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    room.host.emit('nextQuarter', { roomCode: room.code, force: true });
    await sleep(700);

    const since = ben.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    await sleep(1200);
    expect(ben.saw('declaredCard', since), 'a round started in the middle of the break')
      .toBe(false);

    // Once the break closes, declaring works again.
    for (const p of room.all) p.emit('swapDone', { roomCode: room.code });
    await sleep(1000);
    const since2 = ben.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    const card = await ben.waitFor('declaredCard', { since: since2, timeout: 6000 });
    expect(card).toBe('First Down');
  }, 30_000);

  it('refuses a manual advance mid-round unless the Ref insists', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;

    room.host.emit('firstDownEvent', { roomCode: room.code });
    await sleep(500);

    const since = ben.mark();
    room.host.emit('nextQuarter', { roomCode: room.code });   // no force
    await sleep(1000);
    expect(ben.saw('quarterUpdated', since), 'the quarter turned over mid-round')
      .toBe(false);

    const since2 = ben.mark();
    room.host.emit('nextQuarter', { roomCode: room.code, force: true });
    const q = await ben.waitFor('quarterUpdated', { since: since2, timeout: 6000 });
    expect(q).toBe(2);
  }, 30_000);

  it('only the Ref may turn the quarter over by hand', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();
    ben.emit('nextQuarter', { roomCode: room.code, force: true });
    await sleep(1200);
    expect(ben.saw('quarterUpdated', since), 'a player without the whistle changed the quarter')
      .toBe(false);
  }, 20_000);
});


/**
 * The break must close on its own. Run on a short clock via the same env seam
 * BROADCAST_DELAY_MS uses, so this exercises the real timer rather than a
 * second copy of the number.
 */
describe('a break nobody answers', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness({ env: { QUARTER_BREAK_MS: '4000' } });
  });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  it('closes on the timeout rather than holding the table hostage', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('nextQuarter', { roomCode: room.code, force: true });
    const open = await ben.waitFor('quarterBreak', { since, timeout: 5000 });
    expect(open).toMatchObject({ open: true });

    // Nobody answers.
    const closed = await ben.waitFor('quarterBreak', { since: ben.mark(), timeout: 12_000 });
    expect(closed).toMatchObject({ open: false, reason: 'the break timed out' });
  }, 40_000);

  it('lets play resume once it has closed', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    room.host.emit('nextQuarter', { roomCode: room.code, force: true });
    await ben.waitFor('quarterBreak', { since: ben.mark(), timeout: 5000 });
    await sleep(6000);

    const since = ben.mark();
    room.host.emit('firstDownEvent', { roomCode: room.code });
    const card = await ben.waitFor('declaredCard', { since, timeout: 6000 });
    expect(card).toBe('First Down');
  }, 40_000);
});

/**
 * The feed drives the quarter when a game is attached.
 *
 * "Like other actions" — the real game's period moves the app's quarter the
 * same way the feed's plays move declarations, through the same advance path
 * the Ref uses rather than a parallel one.
 */
describe('the real game drives the quarter', () => {
  let h;
  beforeEach(async () => {
    h = await createHarness({
      env: { BROADCAST_DELAY_MS: '1000', QUARTER_BREAK_MS: '3000' },
    });
  });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  const ROOT = new URL('..', import.meta.url).pathname;
  const fixture = () => JSON.parse(
    require('node:fs').readFileSync(`${ROOT}fixtures/nfl/401772877.json`, 'utf8'));
  /** Plays 30..50 — the fixture crosses from period 1 to period 2 at index 40. */
  const acrossTheQuarter = () => {
    const g = fixture();
    const plays = [...g.plays].sort((a, b) => a.sequence - b.sequence).slice(30, 50);
    return { ...g, plays };
  };

  it('moves the app to Q2 when the real game does', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: acrossTheQuarter(), speed: 200,
    });

    const q = await ben.waitFor('quarterUpdated', { since, timeout: 25_000 });
    expect(q, 'the app did not follow the real game into Q2').toBe(2);
  }, 60_000);

  it('opens the break when the feed turns the quarter, same as the Ref', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben] = room.guests;
    const since = ben.mark();

    room.host.emit('attachGame', {
      roomCode: room.code, league: 'nfl', gameId: '401772877',
      replayFixture: acrossTheQuarter(), speed: 200,
    });

    const brk = await ben.waitFor('quarterBreak', { since, timeout: 25_000 });
    expect(brk).toMatchObject({ open: true });
  }, 60_000);
});
