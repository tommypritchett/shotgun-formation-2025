/**
 * Per-card frequency across every fixture. A deliverable, not a debug aid.
 *
 * This is how the auto/suggest dials get set from real numbers instead of
 * estimates, and it is the answer to "what does 40 first downs actually feel
 * like." It also reports how often one play produced more than one card, and
 * how often a penalty suppressed one — which is what says whether sequential
 * rounds are a rare event or a constant backlog.
 *
 *   node scripts/detector-frequency.mjs
 *   node scripts/detector-frequency.mjs --markdown
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay, detectDrive, isNegated, isOffsetting } = require(path.join(ROOT, 'server/feed/detect.js'));
const { modeFor, AUTO } = require(path.join(ROOT, 'server/feed/cards.js'));

const LEAGUES = ['nfl', 'college-football'];
const markdown = process.argv.includes('--markdown');

const loadFixtures = (league) => {
  const dir = path.join(ROOT, 'fixtures', league);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
};

/** Walk one game, counting cards and the multi-card / negation cases. */
const analyse = (fixture) => {
  const plays = [...(fixture.plays || [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const counts = {};
  let multiCardPlays = 0;
  let extraCardsFromMulti = 0;
  let negatedPlays = 0;
  let suppressedByNegation = 0;

  let previous = null;
  for (const play of plays) {
    const found = detectPlay(play, { previous, league: fixture.league });
    found.forEach((c) => { counts[c.cardId] = (counts[c.cardId] || 0) + 1; });
    if (found.length > 1) { multiCardPlays += 1; extraCardsFromMulti += found.length - 1; }

    if (isNegated(play) || isOffsetting(play)) {
      negatedPlays += 1;
      // What a yardage-only reading would have called on this play, and did not.
      const yards = typeof play.yards === 'number' ? play.yards : 0;
      if (yards >= 20) suppressedByNegation += 1;
    }
    previous = play;
  }

  for (const drive of fixture.drives || []) {
    detectDrive(drive).forEach((c) => { counts[c.cardId] = (counts[c.cardId] || 0) + 1; });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const autoTotal = Object.entries(counts)
    .filter(([id]) => modeFor(id) === AUTO)
    .reduce((a, [, n]) => a + n, 0);

  return {
    name: fixture.name, league: fixture.league, gameId: fixture.gameId,
    plays: plays.length, counts, total, autoTotal,
    multiCardPlays, extraCardsFromMulti, negatedPlays, suppressedByNegation,
  };
};

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

const report = () => {
  const all = [];
  for (const league of LEAGUES) {
    const games = loadFixtures(league).map(analyse);
    if (!games.length) continue;
    all.push([league, games]);
  }

  for (const [league, games] of all) {
    const cardIds = [...new Set(games.flatMap((g) => Object.keys(g.counts)))]
      .sort((a, b) => {
        const sum = (id) => games.reduce((n, g) => n + (g.counts[id] || 0), 0);
        return sum(b) - sum(a) || a.localeCompare(b);
      });

    console.log(`\n### ${league}\n`);
    const head = markdown
      ? `| Card | Mode | ${games.map((g) => g.name).join(' | ')} | Mean |`
      : `${pad('Card', 24)}${pad('Mode', 9)}${games.map((g) => num(g.gameId.slice(-4), 8)).join('')}${num('mean', 8)}`;
    console.log(head);
    if (markdown) console.log(`|---|---|${games.map(() => '---:').join('|')}|---:|`);

    for (const id of cardIds) {
      const vals = games.map((g) => g.counts[id] || 0);
      const mean = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
      console.log(markdown
        ? `| ${id} | ${modeFor(id)} | ${vals.join(' | ')} | **${mean}** |`
        : `${pad(id, 24)}${pad(modeFor(id), 9)}${vals.map((v) => num(v, 8)).join('')}${num(mean, 8)}`);
    }

    const line = (label, pick) => {
      const vals = games.map(pick);
      const mean = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
      console.log(markdown
        ? `| **${label}** | | ${vals.join(' | ')} | **${mean}** |`
        : `${pad(label, 24)}${pad('', 9)}${vals.map((v) => num(v, 8)).join('')}${num(mean, 8)}`);
    };
    line('TOTAL cards', (g) => g.total);
    line('of which auto-called', (g) => g.autoTotal);
    line('plays', (g) => g.plays);
    line('multi-card plays', (g) => g.multiCardPlays);
    line('extra cards from those', (g) => g.extraCardsFromMulti);
    line('negated plays', (g) => g.negatedPlays);
    line('suppressed by negation', (g) => g.suppressedByNegation);
  }
  console.log();
};

report();
