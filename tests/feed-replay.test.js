/**
 * The feed layer.
 *
 * ReplayFeed is the reason any of this is testable on a Tuesday, so it gets
 * tested as a first-class implementation rather than as a stub: real gaps,
 * speed multiplier, seeking, dedupe, clean stop.
 *
 * LiveFeed is tested against an injected fetch. It is never pointed at ESPN
 * from the suite — a test that depends on a third party being up and on a real
 * game being in progress is a test that fails on a Tuesday, which is the exact
 * thing this architecture exists to avoid.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ReplayFeed } = require(path.join(ROOT, 'server/feed/replay-feed.js'));
const { LiveFeed, listGames } = require(path.join(ROOT, 'server/feed/live-feed.js'));
const { Watchers } = require(path.join(ROOT, 'server/feed/watchers.js'));

const fixture = (league, id) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));

/** Run a replay to completion as fast as the event loop allows. */
const runToEnd = (feed) => new Promise((resolve) => {
  const plays = []; const drives = []; const states = [];
  feed.on('play', (p) => plays.push(p));
  feed.on('drive', (d) => drives.push(d));
  feed.on('state', (s) => states.push(s));
  feed.on('end', (e) => resolve({ plays, drives, states, end: e }));
  feed.start();
});

describe('ReplayFeed', () => {
  it('emits every play of a real game, in sequence order', async () => {
    const game = fixture('nfl', '401772877');
    const { plays, end } = await runToEnd(new ReplayFeed(game, { speed: 100_000 }));

    expect(plays).toHaveLength(game.playCount);
    expect(end.reason).toBe('final');
    // ESPN does not return them in order — an Official Timeout can be listed
    // before the touchdown it followed — so the feed must sort.
    const sequences = plays.map((p) => p.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  it('emits each drive once, after its plays', async () => {
    const game = fixture('nfl', '401772877');
    const { drives } = await runToEnd(new ReplayFeed(game, { speed: 100_000 }));
    expect(drives).toHaveLength(game.driveCount);
    expect(new Set(drives.map((d) => d.id)).size).toBe(drives.length);
  });

  it('never emits the same play twice', async () => {
    const game = fixture('nfl', '401772879');
    const { plays } = await runToEnd(new ReplayFeed(game, { speed: 100_000 }));
    expect(new Set(plays.map((p) => p.id)).size).toBe(plays.length);
  });

  it('seeks, so a test can start at the two-minute drill', async () => {
    const game = fixture('nfl', '401772879');
    const full = game.playCount;
    const { plays } = await runToEnd(new ReplayFeed(game, { speed: 100_000, startAt: full - 10 }));
    expect(plays).toHaveLength(10);
  });

  it('honours the real gaps between plays, scaled by speed', async () => {
    // The delay queue and the 45s offset are only meaningfully exercised if
    // plays arrive spread out, so this must not collapse to a flood.
    const game = fixture('nfl', '401772877');
    const delays = [];
    const feed = new ReplayFeed(game, {
      speed: 60,
      setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, 0); },
    });
    await runToEnd(feed);
    expect(delays.some((d) => d > 0), 'every play was emitted at once').toBe(true);
    const spread = delays.filter((d) => d > 0);
    expect(spread.length).toBeGreaterThan(game.playCount / 2);
  });

  it('runs faster when told to', async () => {
    const game = fixture('nfl', '401772877');
    const sum = async (speed) => {
      const delays = [];
      const feed = new ReplayFeed(game, {
        speed, setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, 0); },
      });
      await runToEnd(feed);
      return delays.reduce((a, b) => a + b, 0);
    };
    const slow = await sum(1);
    const fast = await sum(20);
    expect(fast).toBeLessThan(slow / 10);
  });

  it('ends cleanly on a game with no plays at all', async () => {
    // A real completed game ESPN carries nothing for. It must not hang.
    const { plays, end } = await runToEnd(new ReplayFeed(fixture('college-football', '401773497'), { speed: 1000 }));
    expect(plays).toEqual([]);
    expect(end.reason).toBe('no plays');
  });

  it('emits nothing after being stopped', async () => {
    const game = fixture('nfl', '401772877');
    const feed = new ReplayFeed(game, { speed: 100_000 });
    const seen = [];
    feed.on('play', (p) => {
      seen.push(p);
      if (seen.length === 3) feed.stop('test');
    });
    await new Promise((r) => { feed.on('end', r); feed.start(); });
    const atStop = seen.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBe(atStop);
  });

  it('survives a fixture that is nonsense', () => {
    for (const bad of [null, undefined, {}, { plays: 'no' }, 42]) {
      expect(() => new ReplayFeed(bad, { speed: 1000 })).not.toThrow();
    }
  });
});

describe('LiveFeed', () => {
  afterEach(() => vi.restoreAllMocks());

  const fakeFetch = (responses) => {
    let call = 0;
    return vi.fn(async (url) => {
      const which = call++;
      const body = typeof responses === 'function' ? responses(url, which) : responses;
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body };
    });
  };

  it('polls plays and emits them normalised, once each', async () => {
    const raw = {
      items: [
        { id: '1', sequenceNumber: '100', type: { id: '5', text: 'Rush' }, text: 'a run',
          start: {}, end: {}, statYardage: 3 },
        { id: '2', sequenceNumber: '200', type: { id: '7', text: 'Sack' }, text: 'a sack',
          start: {}, end: {}, statYardage: -8 },
      ],
    };
    const feed = new LiveFeed({
      league: 'nfl', gameId: '999', fetchImpl: fakeFetch(raw),
      setTimeout: () => null,   // one poll only
    });
    const plays = [];
    feed.on('play', (p) => plays.push(p));
    feed.start();
    await new Promise((r) => setTimeout(r, 20));

    expect(plays.map((p) => p.id)).toEqual(['1', '2']);
    expect(plays[0].typeText).toBe('Rush');   // normalised, not ESPN's shape
    expect(plays[0].$ref).toBeUndefined();
  });

  it('does not re-emit a play it has already seen', async () => {
    const raw = { items: [{ id: '1', sequenceNumber: '100', start: {}, end: {} }] };
    let timeoutFn = null;
    const feed = new LiveFeed({
      league: 'nfl', gameId: '999', fetchImpl: fakeFetch(raw),
      setTimeout: (fn) => { timeoutFn = fn; return 1; },
    });
    const plays = [];
    feed.on('play', (p) => plays.push(p));
    feed.start();
    await new Promise((r) => setTimeout(r, 20));
    timeoutFn?.();                       // poll again, same payload
    await new Promise((r) => setTimeout(r, 20));

    expect(plays).toHaveLength(1);
  });

  it('backs off instead of hammering a service that is failing', async () => {
    const waits = [];
    const feed = new LiveFeed({
      league: 'nfl', gameId: '999',
      fetchImpl: vi.fn(async () => { throw new Error('ESPN is having a day'); }),
      setTimeout: (fn, ms) => { waits.push(ms); return 1; },
    });
    feed.on('error', () => {});
    feed.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(waits[0]).toBeGreaterThanOrEqual(10_000);
  });

  it('degrades to silence rather than throwing when the shape changes', async () => {
    const feed = new LiveFeed({
      league: 'nfl', gameId: '999',
      fetchImpl: fakeFetch({ somethingElse: true }),   // no `items` at all
      setTimeout: () => null,
    });
    const plays = [];
    feed.on('play', (p) => plays.push(p));
    feed.on('error', () => {});
    expect(() => feed.start()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(plays).toEqual([]);
  });

  it('uses one code path for both leagues', () => {
    const nfl = new LiveFeed({ league: 'nfl', gameId: '1' });
    const college = new LiveFeed({ league: 'college-football', gameId: '1' });
    expect(nfl.playsUrl).toContain('/leagues/nfl/');
    expect(college.playsUrl).toContain('/leagues/college-football/');
    expect(nfl.playsUrl.replace('/nfl/', '/X/')).toBe(college.playsUrl.replace('/college-football/', '/X/'));
  });
});

describe('listGames', () => {
  it('normalises the scoreboard into something a picker can render', async () => {
    const raw = {
      events: [{
        id: '401', shortName: 'KC @ BUF',
        status: { period: 2, displayClock: '3:20', type: { state: 'in', shortDetail: 'Q2 3:20' } },
        competitions: [{
          competitors: [
            { homeAway: 'home', score: '14', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' }, curatedRank: { current: 3 } },
            { homeAway: 'away', score: '10', team: { abbreviation: 'KC', displayName: 'Kansas City Chiefs' }, curatedRank: { current: 99 } },
          ],
        }],
      }],
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => raw });
    const [game] = await listGames('nfl', { fetchImpl });

    expect(game.id).toBe('401');
    expect(game.home.abbreviation).toBe('BUF');
    expect(game.home.rank).toBe(3);
    expect(game.away.rank).toBeNull();       // 99 is "unranked", not a rank
    expect(game.state).toBe('in');
    expect(game.started).toBe(true);
  });

  it('skips rows it cannot understand instead of failing the whole list', async () => {
    const raw = { events: [{ id: '1' }, { nonsense: true }, null, { id: '2', competitions: [] }] };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => raw });
    const games = await listGames('nfl', { fetchImpl });
    expect(games.map((g) => g.id)).toEqual(['1', '2']);
  });
});

describe('one poller per game, not per room', () => {
  it('shares a feed between rooms and stops it when the last one leaves', () => {
    const stops = [];
    const w = new Watchers({ createFeed: ({ gameId }) => ({ stop: () => stops.push(gameId) }) });

    w.attach('AAA', 'nfl', '1');
    w.attach('BBB', 'nfl', '1');
    w.attach('CCC', 'nfl', '2');
    expect(w.size).toBe(2);
    expect(w.roomsWatching('nfl', '1')).toHaveLength(2);

    w.release('AAA');
    expect(w.size).toBe(2);
    expect(stops).toEqual([]);

    w.release('BBB');
    expect(w.size).toBe(1);
    expect(stops).toEqual(['1']);
  });

  it('moves a room from one game to another without leaking the first', () => {
    const w = new Watchers({ createFeed: () => ({ stop: () => {} }) });
    w.attach('AAA', 'nfl', '1');
    w.attach('AAA', 'nfl', '2');
    expect(w.size).toBe(1);
    expect(w.forRoom('AAA').gameId).toBe('2');
  });

  it('lets a reaped room take its poller down with it', () => {
    const stops = [];
    const w = new Watchers({ createFeed: () => ({ stop: () => stops.push('stopped') }) });
    w.attach('AAA', 'nfl', '1');
    w.releaseAllForRoom('AAA');
    expect(w.size).toBe(0);
    expect(stops).toHaveLength(1);
  });

  it('ignores a release for a room that was never attached', () => {
    const w = new Watchers({ createFeed: () => ({ stop: () => {} }) });
    expect(w.release('NOPE')).toBe(false);
  });
});
