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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

    // A compound play is cut at the seam between its two events, not mid-word.
    const long = 'Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt '
      + '8 Yd Fumble Recovery by Cam Bynum For 8 Yd Loss';
    const line = sourceLine({ by: 'feed', cardId: 'Turnover', reason: long });
    // The Turnover card gets the turnover half; the Sacks card gets the sack.
    expect(line).toBe('The game called it · Germaine Pratt 8 Yd Fumble Recovery');
    expect(line, 'still reads as Penix sacking himself').not.toMatch(/Sacked Michael/);
    expect(sourceLine({ by: 'feed', cardId: 'Sacks', reason: long }))
      .toBe('The game called it · Michael Penix Jr. Sacked');

    // Unknown source must never invent an attribution. Before the server has
    // said, the safe reading is the Ref — but it must not say "the game" .
    expect(sourceLine(null)).toBe('The Ref declared');
    expect(sourceLine(null)).not.toMatch(/game called/);
  });
});

describe('the reason reads like football', () => {
  /**
   * This line is read about seventy times a game on every phone in the room, so
   * it is the most-read text in the feature.
   *
   * ESPN concatenates the events of a compound play and repeats the player, so
   * a naive truncation produced "Michael Penix Jr. Sacked Michael Penix Jr.
   * Fumble…" — which reads as Penix sacking himself. Checked in bulk across
   * every detection in four fixtures, not one screenshot at a time.
   */
  let formatReason;
  beforeAll(async () => {
    ({ formatReason } = await import('../client/src/lib/round-source.js'));
  });

  it('cuts a compound play at the seam, not mid-thought', () => {
    expect(formatReason(
      'Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt 8 Yd Fumble Recovery by Cam Bynum For 8 Yd Loss',
      'Sacks'
    )).toBe('Michael Penix Jr. Sacked');

    expect(formatReason(
      'Daniel Jones Pass Complete for 14 Yds to Jonathan Taylor Jonathan Taylor Fumble Tanor Bortolini 0 Yd Fumble Recovery',
      'First Down'
    )).toBe('Daniel Jones 14 Yd pass to Jonathan Taylor');
  });

  it('keeps the half of a kick return that the card is about', () => {
    // The kicker is first and the returner second; the card is the return.
    expect(formatReason(
      'Bradley Pinion 60 Yd Kickoff Ashton Dulin 20 Yd Kickoff Return',
      'Big Play 20+'
    )).toBe('Ashton Dulin 20 Yd Kickoff Return');
  });

  it('keeps the penalty clause on a penalty', () => {
    expect(formatReason(
      'Michael Penix Jr. Incomplete Pass, Intended For Darnell Mooney Mekhi Blackmon 20 Yd Pnlty',
      'Penalty'
    )).toBe('Mekhi Blackmon 20 Yd penalty');
  });

  it('drops the extra point from a touchdown, and keeps it on a missed PAT', () => {
    expect(formatReason('Tyler Allgeier 1 Yd Rush (Zane Gonzalez Kick)', 'Touchdown'))
      .toBe('Tyler Allgeier 1 Yd Rush');
    expect(formatReason('Jonathan Taylor 1 Yd Rush (Michael Badgley PAT Failed)', 'Missed PAT'))
      .toContain('PAT Failed');
  });

  it('leaves a clean one-liner alone', () => {
    expect(formatReason('Bijan Robinson 16 Yd Rush', 'First Down'))
      .toBe('Bijan Robinson 16 Yd Rush');
  });

  it('never leaves a dangling comma', () => {
    expect(formatReason('Thomas Morstead Onside Kick,', 'Onside Attempt'))
      .toBe('Thomas Morstead Onside Kick');
  });

  it('says nothing when the summary does not support the card', () => {
    // A blank subtitle is clean. One that contradicts the card name is actively
    // misleading, and the room reads it while deciding whether to drink.
    expect(formatReason('Luke Farrell 9 Yd pass from Mac Jones (Eddy Pineiro PAT blocked)', 'Blocked Kicks'))
      .toBe('');
    expect(formatReason(
      'Tyler Allgeier 1 Yd Rush (Michael Penix Jr. Pass to Drake London for Two-Point Conversion)',
      '2 PT Conversion'
    )).toBe('');
    expect(formatReason('K. Jennings pass incomplete', 'Sacks')).toBe('');
  });

  it('keeps the turnover half of a strip sack for the Turnover card', () => {
    // "Penix Sacked Penix Fumble Germaine Pratt 8 Yd Fumble Recovery" — the sack
    // first, the turnover second. Each card gets its own half.
    const raw = 'Michael Penix Jr. Sacked Michael Penix Jr. Fumble Germaine Pratt '
      + '8 Yd Fumble Recovery by Cam Bynum For 8 Yd Loss';
    expect(formatReason(raw, 'Turnover')).toBe('Germaine Pratt 8 Yd Fumble Recovery');
    expect(formatReason(raw, 'Sacks')).toBe('Michael Penix Jr. Sacked');
  });

  it('will not call 19 yards a Big Play', () => {
    // The number in the text has to actually reach the threshold.
    expect(formatReason('Someone 19 Yd Rush', 'Big Play 20+')).toBe('');
    expect(formatReason('Someone 24 Yd Rush', 'Big Play 20+')).toBe('Someone 24 Yd Rush');
    expect(formatReason('Someone 24 Yd Rush', 'Big Play 50+')).toBe('');
  });

  it('holds the whole fixture set inside the banner', async () => {
    const fs2 = await import('node:fs');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const { detectPlay } = req(path.join(ROOT, 'server/feed/detect.js'));

    let lines = 0;
    let truncated = 0;
    let blanked = 0;
    for (const [league, id] of [['nfl', '401772636'], ['nfl', '401772879'],
      ['college-football', '401754581'], ['college-football', '401752889']]) {
      const g = JSON.parse(fs2.readFileSync(
        path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));
      for (const play of g.plays) {
        for (const d of detectPlay(play, { league })) {
          if (!play.shortText) continue;
          const out = formatReason(play.shortText, d.cardId);
          lines += 1;
          if (!out) { blanked += 1; continue; }
          if (out.endsWith('…')) truncated += 1;
          expect(out.length, `too long: ${out}`).toBeLessThanOrEqual(60);
          expect(out, `dangling punctuation: ${out}`).not.toMatch(/[,;:]$/);
        }
      }
    }
    expect(lines).toBeGreaterThan(200);
    // The corroboration gate must earn its place: near zero means it is doing
    // nothing, and a large fraction means it is silencing good lines.
    expect(blanked / lines, `${blanked}/${lines} blanked`).toBeGreaterThan(0.005);
    expect(blanked / lines, `${blanked}/${lines} blanked`).toBeLessThan(0.10);
    // Truncation is the last resort. A tenth of compound plays is acceptable;
    // a third would mean the clause rules had stopped working.
    expect(truncated / lines, `${truncated}/${lines} truncated`).toBeLessThan(0.15);
  });
});
