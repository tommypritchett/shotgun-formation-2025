/**
 * The finaliser turns a raw recording folder into a finished artifact.
 *
 * This exists because the failure it guards against has already happened once:
 * a 13-minute recording finished, the process hung on an open socket, the
 * waiter was stopped, and six `page@<hash>.webm` files were left with no way to
 * tell which seat was which and no timeline at all. Renaming has to be a step
 * that can be re-run against a folder on disk, and it has to be tested.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = path.resolve('scripts/finalise-recording.mjs');
let dir;

/** Videos are matched to seats by creation order, so the writes must be ordered. */
const writeVideosInOrder = (names) => {
  const files = [];
  names.forEach((_, i) => {
    const f = path.join(dir, `page@${'0'.repeat(31)}${i}.webm`);
    fs.writeFileSync(f, `video ${i}`);
    // birthtime has coarse resolution on some filesystems; stamp it explicitly
    // so the ordering under test is the ordering asserted.
    const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    fs.utimesSync(f, t, t);
    files.push(f);
  });
  return files;
};

const run = (target = dir) => execFileSync('node', [SCRIPT, target], { encoding: 'utf8' });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('finalise-recording', () => {
  it('names the Ref and the primary player seat, and drops the rest', () => {
    const names = ['Ref', 'Ben', 'Cy', 'Dee'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Cy' }));

    run();

    const left = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).sort();
    expect(left).toEqual(['1-PRIMARY-ref-Ref.webm', '2-secondary-player-Cy.webm']);
    // The right footage under the right name, not just the right name.
    expect(fs.readFileSync(path.join(dir, '1-PRIMARY-ref-Ref.webm'), 'utf8')).toBe('video 0');
    expect(fs.readFileSync(path.join(dir, '2-secondary-player-Cy.webm'), 'utf8')).toBe('video 2');
  });

  it('can be re-run against a folder it has already finished', () => {
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'timeline.txt'), '0:01  something happened\n');

    run();
    const after = fs.readdirSync(dir).sort();
    run();
    expect(fs.readdirSync(dir).sort()).toEqual(after);
  });

  it('collapses a round recorded twice, keeping the attributed half', () => {
    // `declaredCard` fires first with no attribution, then `roundSource` names
    // who called it. A recorder that pushed both counted every round twice —
    // the college manifest read "10 rounds" for five.
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      rounds: [
        { card: 'First Down', by: 'unknown' },
        { card: 'First Down', by: 'feed', reason: 'run for 7 yds' },
        { card: 'Penalty', by: 'unknown' },
        { card: 'Penalty', by: 'feed', reason: 'holding' },
      ],
    }));

    run();

    const { rounds } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(rounds).toEqual([
      { card: 'First Down', by: 'feed', banner: 'The game called it · run for 7 yds' },
      { card: 'Penalty', by: 'feed', banner: 'The game called it · holding' },
    ]);
  });

  it('leaves two genuine rounds of the same card alone', () => {
    // Big Play fires eleven times a game. Two in a row is ordinary football,
    // not a double count — the tell is that both carry attribution.
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    const rounds = [
      { card: 'Big Play 20+', by: 'feed', reason: '21 yd pass' },
      { card: 'Big Play 20+', by: 'feed', reason: '34 yd run' },
    ];
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ rounds }));

    run();

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).rounds)
      .toEqual([
        { card: 'Big Play 20+', by: 'feed', banner: 'The game called it · 21 yd pass' },
        { card: 'Big Play 20+', by: 'feed', banner: 'The game called it · 34 yd run' },
      ]);
  });

  it('records the banner the app showed, not the text the gate refused', () => {
    // Confirmed against the footage: the college Penalty round's banner read
    // "THE GAME CALLED IT" with no reason, because ESPN's summary for that play
    // describes a first down and does not support a Penalty card. A manifest
    // that recorded the raw summary claimed the app displayed something it
    // had specifically refused to display.
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      rounds: [
        { card: 'Penalty', by: 'feed', reason: 'C. Beck pass to M. Toney for 18 yds for a 1ST down' },
        { card: 'Touchdown', by: 'feed', reason: 'Alex Bauman 4 Yd pass from Carson Beck (Carter Davis Kick)' },
      ],
    }));

    run();

    const { rounds } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(rounds[0].banner).toBe('The game called it');
    expect(rounds[0]).not.toHaveProperty('reason');
    // The refused text is kept, but named for what it is.
    expect(rounds[0].rejectedSummary).toMatch(/1ST down/);

    // A reason that does support its card survives, and is recorded as shown —
    // including the parenthetical the formatter drops.
    expect(rounds[1].banner).toBe('The game called it · Alex Bauman 4 Yd pass from Carson Beck');
    expect(rounds[1]).not.toHaveProperty('rejectedSummary');
  });

  it('never recomputes a banner once it is frozen', () => {
    // The manifest describes ONE run. `banner` comes from the client's reason
    // formatter, so improving that formatter later would silently rewrite these
    // lines into text the video does not show. The fix for stranded name
    // suffixes changed 9 lines across the fixtures; none of them may leak back
    // into a manifest whose footage predates it.
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      rounds: [{ card: 'Penalty', by: 'feed', banner: 'The game called it · Jr. ATL 5 Yd penalty' }],
      footage: { bannersFrozen: true },
    }));

    run();

    const { rounds } = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(rounds[0].banner).toBe('The game called it · Jr. ATL 5 Yd penalty');
  });

  it('freezes the banners it writes, so the next run cannot move them', () => {
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      rounds: [{ card: 'Touchdown', by: 'feed', reason: 'Alex Bauman 4 Yd pass from Carson Beck' }],
    }));

    run();

    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(m.footage.bannersFrozen).toBe(true);
  });

  it('refuses to guess when there is no seat map, rather than mislabelling footage', () => {
    writeVideosInOrder(['Ref', 'Ben']);

    expect(() => run()).toThrow();
    // Wrong names on the footage would be worse than none: the files stay put.
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('page@'))).toHaveLength(2);
  });

  it('keeps a timeline written by a run that died part-way', () => {
    const names = ['Ref', 'Ben'];
    writeVideosInOrder(names);
    fs.writeFileSync(path.join(dir, 'pending.json'),
      JSON.stringify({ names, primarySeat: 'Ben' }));
    fs.writeFileSync(path.join(dir, 'timeline.txt'), '0:08  room created\n1:05  round 1\n');

    const out = run();

    expect(out).toMatch(/2 events/);
    expect(fs.readFileSync(path.join(dir, 'timeline.txt'), 'utf8')).toMatch(/round 1/);
  });
});

describe('record-walkthrough', () => {
  const source = fs.readFileSync(path.resolve('scripts/record-walkthrough.mjs'), 'utf8');

  it('closes the driver socket so the process can exit', () => {
    // An open socket.io client holds the node event loop open. Without this the
    // recorder prints "done" and then hangs forever, and anything chained
    // behind it — the next league's recording — never starts.
    expect(source).toMatch(/driver\.close\(\)/);
  });

  it('writes the seat map before the recording can fail', () => {
    // pending.json must be written when the seats are created, not at the end;
    // at the end is exactly when it was lost.
    const seatMap = source.indexOf("pending.json");
    const recordingEnds = source.indexOf('await browser.close()');
    expect(seatMap).toBeGreaterThan(-1);
    expect(seatMap).toBeLessThan(recordingEnds);
  });

  it('upgrades the unattributed round rather than pushing a second one', () => {
    // The ordering is the whole point: declaredCard first, roundSource second.
    expect(source).toMatch(/last\.by === 'unknown'/);
  });

  it('appends each timeline entry as it happens', () => {
    expect(source).toMatch(/appendFileSync\([^)]*timeline\.txt/);
  });
});
