/**
 * A round should not wait out the clock when there is nothing left to wait for.
 *
 * `finalizeRound` had exactly one caller — the timer. There was no `lockIn`
 * event at all: the client's Lock In button flushed pours and set a local flag,
 * so an explicit lock-in never reached the server.
 *
 * The rule: the round is over when every player who is HERE either owes nothing
 * or has locked in. Disconnected players are skipped — a dead phone must not
 * hold nine people hostage. First Down is excluded: nobody owes anything on it,
 * so the rule is satisfied instantly and it would finalize before anyone read
 * it. It is a six-second beat whose value is the display time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('ending a round early', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;

  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => {
    const crash = h.crashed();
    await h.teardown();
    if (crash) throw new Error(`server.js crashed (exit ${crash.code}):\n${crash.stack}`);
  });

  /** Declare the host's most valuable card and return what each holder owes. */
  const declareAndCollect = async (room) => {
    const byValue = {};
    room.host.view.hand.standard.forEach((c) => { byValue[c.card] = (byValue[c.card] || 0) + c.drinks; });
    const order = Object.entries(byValue).sort((a, b) => b[1] - a[1]).map(([n]) => n);

    for (const card of order) {
      const marks = room.all.map((p) => [p, p.mark()]);
      const since = room.host.mark();
      if (await room.declareStandard(card) !== 'declared') continue;
      await sleep(500);
      const owed = new Map();
      for (const [p, m] of marks) {
        const got = p.received('distributeDrinks', m);
        if (got.length) owed.set(p, got[got.length - 1]);
      }
      if (owed.size) return { card, owed, since };
    }
    throw new Error('nobody was given a pour prompt');
  };

  /** Pour everything you owe into someone. */
  const pourAll = (from, room, target, prompt) => {
    if (prompt.drinkCount > 0 || prompt.shotguns > 0) {
      from.emit('assignDrinks', {
        roomCode: room.code,
        selectedPlayerIds: [target.id],
        drinksToGive: prompt.drinkCount ? { [target.id]: prompt.drinkCount } : {},
        shotgunsToGive: prompt.shotguns ? { [target.id]: prompt.shotguns } : {},
      });
    }
  };

  it('ends as soon as everyone who owed has poured', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const { owed, since } = await declareAndCollect(room);

    const started = Date.now();
    for (const [player, prompt] of owed) {
      pourAll(player, room, room.guests[1], prompt);
      await sleep(120);
    }

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, since);
    const took = (Date.now() - started) / 1000;
    expect(took, `waited ${took.toFixed(1)}s — the full clock is ${h.ROUND_SECONDS.standard}s`)
      .toBeLessThan(h.ROUND_SECONDS.standard - 4);
  }, 60_000);

  it('is not blocked by a player whose phone died', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const { owed, since } = await declareAndCollect(room);
    if (owed.size < 2) return; // need at least two holders for this to mean anything

    const holders = [...owed.keys()];
    const dropped = holders[holders.length - 1];
    await dropped.disconnect();
    await sleep(400);

    const started = Date.now();
    // Everyone still here settles up — pouring what they owe, then locking in.
    // Which players hold the declared card varies with the deal, so relying on
    // "the holders happen to pour out" made this depend on the shuffle. The
    // claim under test is only that the DEAD PHONE does not block, so remove
    // every other reason the round might wait.
    for (const [player, prompt] of owed) {
      if (player === dropped) continue;
      pourAll(player, room, room.guests[1], prompt);
      await sleep(120);
    }
    for (const p of room.all) {
      if (p === dropped || !p.socket.connected) continue;
      p.emit('lockIn', { roomCode: room.code });
    }

    // `since` is a per-player log index, so the host's index means nothing in
    // another player's log — using it there silently skips past the event.
    const watcher = room.all.find((p) => p !== dropped && p.socket.connected);
    const watchSince = watcher === room.host ? since : 0;
    await room.waitForFinalize(watcher, h.ROUND_SECONDS.standard, watchSince);
    const took = (Date.now() - started) / 1000;
    expect(took, 'a dead phone held the round open for the full clock')
      .toBeLessThan(h.ROUND_SECONDS.standard - 4);
  }, 60_000);

  it('ends when a player locks in with drinks outstanding, and forfeits them', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const { owed, since } = await declareAndCollect(room);
    const [holder, prompt] = [...owed.entries()][0];
    expect(prompt.drinkCount, 'need something to forfeit').toBeGreaterThanOrEqual(1);

    const target = room.all.find((p) => p !== holder);
    // Pour ONE, keep the rest, then lock in.
    holder.emit('assignDrinks', {
      roomCode: room.code,
      selectedPlayerIds: [target.id],
      drinksToGive: { [target.id]: 1 },
      shotgunsToGive: {},
    });
    await sleep(200);
    for (const [other] of owed) if (other !== holder) other.emit('lockIn', { roomCode: room.code });
    holder.emit('lockIn', { roomCode: room.code });

    const started = Date.now();
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, since);
    expect((Date.now() - started) / 1000).toBeLessThan(h.ROUND_SECONDS.standard - 4);

    // Exactly the one poured landed. The rest lapsed; nobody else was charged.
    expect(h.totalsFor(room.host, target.id).totalDrinks).toBe(1);
  }, 60_000);

  it('still gives First Down its full six seconds', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const since = room.host.mark();
    const started = Date.now();
    expect(await room.declareFirstDown()).toBe('declared');

    // Nobody owes anything on a First Down, so a naive rule ends it instantly.
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    const took = (Date.now() - started) / 1000;
    expect(took, `First Down finished in ${took.toFixed(1)}s — it needs its display time`)
      .toBeGreaterThanOrEqual(h.ROUND_SECONDS.firstDown - 1.5);
  }, 30_000);

  it('does not leave an orphaned timer firing into the next round', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const { owed, since } = await declareAndCollect(room);
    for (const [player, prompt] of owed) { pourAll(player, room, room.guests[1], prompt); await sleep(120); }
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.standard, since);

    // The next round must run its own clock, not inherit a stale one.
    const since2 = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');
    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since2);
    for (const p of room.all) {
      expect(h.totalsFor(room.host, p.id).totalDrinks).toBeGreaterThanOrEqual(1);
    }
  }, 90_000);
});
