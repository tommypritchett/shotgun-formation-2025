/**
 * Item 3 — the log has to be readable on the first live night.
 *
 * When a friend says "it broke around 11", Render's log buffer is bounded and
 * not searchable. Two loops made 11pm unreadable:
 *
 *  - `Heartbeat acknowledged by <id>` fired every 10 seconds per connected
 *    socket, forever, including an idle lobby.
 *  - The `ASSIGN DRINKS DEBUG` block was ~8 lines per call, and the client
 *    flushes every 700ms per pouring player. Six players through one 21-second
 *    round is on the order of a thousand lines.
 *
 * This is a budget, not a style rule: it fails when the log gets loud again,
 * whichever line is responsible. The bounds are deliberately generous — this
 * should catch a new hot loop, not a new sentence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness } from './helpers/harness.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lineCount = (text) => text.split('\n').filter((l) => l.trim()).length;

describe('server log volume', () => {
  /** @type {Awaited<ReturnType<typeof createHarness>>} */
  let h;
  beforeEach(async () => { h = await createHarness(); });
  afterEach(async () => { await h.teardown(); h.assertAlive(); });

  it('says almost nothing while a lobby sits idle', async () => {
    const room = await h.newRoom(['Ava', 'Ben', 'Cy']);
    void room;

    const before = lineCount(h.logs());
    // Three sockets, 12 seconds: one heartbeat round trip each, at least.
    await sleep(12_000);
    const added = lineCount(h.logs()) - before;

    // One ack per socket per 10s is three lines a round trip, forever, from a
    // lobby where nothing is happening. The budget is under that on purpose.
    expect(added, `an idle three-player lobby wrote ${added} lines in 12 seconds`)
      .toBeLessThanOrEqual(2);
  }, 40_000);

  it('keeps one round of pouring to a readable number of lines', async () => {
    const room = await h.newGame(['Ava', 'Ben', 'Cy']);
    const [ben, cy] = room.guests;

    const since = room.host.mark();
    expect(await room.declareFirstDown()).toBe('declared');

    const before = lineCount(h.logs());

    // The real client flushes a delta every 700ms while you tap. Six flushes
    // from two players is an ordinary round, not a stress test.
    for (let i = 0; i < 6; i += 1) {
      room.assignDrinks(room.host, [{ player: ben, drinks: 1 }]);
      room.assignDrinks(ben, [{ player: cy, drinks: 1 }]);
      await sleep(150);
    }

    await room.waitForFinalize(room.host, h.ROUND_SECONDS.firstDown, since);
    const added = lineCount(h.logs()) - before;

    expect(added, `12 pours and a finalize wrote ${added} lines`)
      .toBeLessThanOrEqual(120);
  }, 60_000);

  it('still records the commit it is running', async () => {
    await sleep(300);   // it lands just after the 'Server is running on port' line
    // The single most useful line in the file. It has already caught a stale
    // server once, and nothing here may cost us it.
    expect(h.logs()).toMatch(/Running code: [0-9a-f]{7}/);
  });
});
