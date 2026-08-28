/**
 * Pull a completed game's play-by-play and drives into a fixture file.
 *
 * The whole feature has to be testable on a Tuesday. These fixtures are how:
 * a recorded game replayed through ReplayFeed exercises detection, queueing and
 * the delay offset end to end, on any day, without a live game.
 *
 * Usage:
 *   node scripts/capture-fixture.mjs nfl 401772877
 *   node scripts/capture-fixture.mjs college-football 401752889
 *   node scripts/capture-fixture.mjs --list nfl 20251109
 *
 * Writes fixtures/{league}/{gameId}.json. Raw ESPN shapes are NOT stored: the
 * fixture holds normalised plays, so a change at ESPN cannot silently rewrite
 * what the detector tests assert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import normalise from '../server/feed/normalise.js';

const { normalisePlay, normaliseDrive } = normalise;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football';

const getJSON = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
};

const listGames = async (league, date) => {
  const url = `${SITE}/${league}/scoreboard?limit=500${date ? `&dates=${date}` : ''}`
    + (league === 'college-football' ? '&groups=80' : '');
  const { events = [] } = await getJSON(url);
  for (const event of events) {
    const comp = (event.competitions || [])[0] || {};
    const teams = (comp.competitors || [])
      .map((c) => `${c.team?.abbreviation ?? '?'} ${c.score ?? ''}`).join(' - ');
    const period = event.status?.period ?? 0;
    console.log(event.id, (event.status?.type?.name ?? '').padEnd(14), teams, period > 4 ? '(OT)' : '');
  }
};

const capture = async (league, gameId) => {
  const scoreboard = await getJSON(`${SITE}/${league}/scoreboard?limit=500`).catch(() => ({}));
  void scoreboard;

  const summary = await getJSON(`${SITE}/${league}/summary?event=${gameId}`).catch(() => ({}));
  const comp = summary?.header?.competitions?.[0] ?? {};
  const teams = (comp.competitors || []).map((c) => ({
    id: c.id,
    abbreviation: c.team?.abbreviation ?? null,
    displayName: c.team?.displayName ?? null,
    score: Number(c.score ?? 0),
    homeAway: c.homeAway ?? null,
  }));

  const playsRaw = await getJSON(
    `${CORE}/${league}/events/${gameId}/competitions/${gameId}/plays?limit=400`
  );
  const drivesRaw = await getJSON(
    `${CORE}/${league}/events/${gameId}/competitions/${gameId}/drives?limit=200`
  ).catch(() => ({ items: [] }));

  const plays = (playsRaw.items || [])
    .map(normalisePlay)
    .filter(Boolean)
    .sort((a, b) => a.sequence - b.sequence);

  const drives = (drivesRaw.items || []).map(normaliseDrive).filter(Boolean);

  const fixture = {
    league,
    gameId: String(gameId),
    capturedAt: new Date().toISOString(),
    name: teams.map((t) => `${t.abbreviation} ${t.score}`).join(' - '),
    teams,
    periods: plays.reduce((max, p) => Math.max(max, p.period || 0), 0),
    playCount: plays.length,
    driveCount: drives.length,
    plays,
    drives,
  };

  const dir = path.join(ROOT, 'fixtures', league);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${gameId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);

  const withText = plays.filter((p) => p.text).length;
  const withYards = plays.filter((p) => p.yards !== null).length;
  const withDowns = plays.filter((p) => p.start.down !== null).length;
  console.log(`${file}`);
  console.log(`  ${fixture.name} | ${plays.length} plays, ${drives.length} drives, ${fixture.periods} periods`);
  console.log(`  text ${withText}/${plays.length} | yards ${withYards}/${plays.length} | downs ${withDowns}/${plays.length}`);
};

const [a, b, c] = process.argv.slice(2);
if (a === '--list') await listGames(b, c);
else if (a && b) await capture(a, b);
else {
  console.error('usage: capture-fixture.mjs <league> <gameId>  |  --list <league> [YYYYMMDD]');
  process.exit(2);
}
