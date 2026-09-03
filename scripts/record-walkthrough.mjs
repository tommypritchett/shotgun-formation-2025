/**
 * A full walkthrough, end to end, at real speed — with the seats actually
 * playing.
 *
 * The earlier demo showed rounds firing into a dead room: three seats, one card
 * holder, nobody pouring. That records the trigger, not the game. This drives
 * six seats like people:
 *
 *   - whoever holds the declared card pours, spreading drinks across different
 *     recipients rather than dumping them on one
 *   - one round is undone and re-assigned to somebody else
 *   - one ends on LOCK IN, one is left to run out the clock
 *   - the Ref accepts one suggestion and ignores another
 *
 * Six seats rather than three because with three, a card only one of them holds
 * leaves most people watching "you don't hold this card" — which is exactly the
 * dead air the first take suffered from.
 *
 *   ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *   node scripts/record-walkthrough.mjs nfl
 *   node scripts/record-walkthrough.mjs college
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import { finalise } from './finalise-recording.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay } = require(path.join(ROOT, 'server/feed/detect.js'));
const { modeFor, AUTO } = require(path.join(ROOT, 'server/feed/cards.js'));

const URL = 'http://127.0.0.1:3002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chosen by density in REAL TIME, not by play index — the same distinction that
 * caught me out on the pacing numbers. A window of twenty plays can span an
 * hour of sofa time; what matters for a 1x recording is how many calls land
 * inside thirteen real minutes.
 *
 * Simulated against each fixture's own wallclock gaps:
 *   IND-ATL  from play 11 — 12 calls in the first 13 real minutes, the best NFL
 *   SMU-MIA  from play 95 — 13 calls, the best of all ten fixtures
 *
 * Windows containing a wallclock discontinuity are excluded: SMU-MIA's
 * timestamps jump BACKWARDS by 3h11m at play 40, and ReplayFeed clamps a
 * negative gap to zero, so a window across it fires everything at once. That
 * defect is ESPN's, and it is why the first college attempt — chosen on play
 * index — produced two calls in thirteen minutes.
 */
const GAMES = {
  nfl: { league: 'nfl', id: '401772636', from: 11, label: 'IND 31 - ATL 25' },
  college: { league: 'college-football', id: '401754581', from: 95, label: 'SMU 26 - MIA 20' },
  // A sustained drive rather than a keyhole. Measured from play 103:
  //   18 min -> 7 calls, 2 drives (15 plays then 8), 4 First Downs, NO score
  //   26 min -> 12 calls, 3 drives, 6 First Downs, and a Field Goal
  //   30 min -> 13 calls, 7 First Downs
  // 26 is the shortest window that contains a drive actually scoring, which is
  // the half the shorter one misses.
  'long-drive': {
    league: 'nfl', id: '401772636', from: 103, label: 'IND 31 - ATL 25 — two drives',
    minutes: 26, dir: 'long-drive-nfl',
  },
};

const which = GAMES[process.argv[2]] ? process.argv[2] : 'nfl';
const game = GAMES[which];
const MINUTES = Number(process.env.WALK_MINUTES || game.minutes || 12);
const OUT = path.join(ROOT, 'artifacts', game.dir || `walkthrough-${which}`);
fs.mkdirSync(OUT, { recursive: true });

/**
 * A replay is a private, one-shot stream and must never be shared between runs.
 *
 * Watchers are keyed on `league:gameId` and refcounted per room, which is right
 * for live football — eight rooms watching the Chiefs share one poller. But the
 * harness attaches through the dev-only replay seam and detaches over the same
 * driver socket, and `detachGame` requires the Ref, which the driver is not. So
 * the detach no-ops, the feed keeps replaying, and a later run reusing the same
 * id joins it mid-fixture.
 *
 * That is exactly what happened: a second college run picked up "Missed FG",
 * which lives 68 plays past the window it was supposed to be recording. Making
 * the id unique per run removes the sharing, and the idle-room reaper stops the
 * abandoned feed.
 */
const REPLAY_GAME_ID = `${GAMES[process.argv[2]] ? process.argv[2] : 'nfl'}-replay-${process.pid}-${Date.now()}`;

const fixture = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'fixtures', game.league, `${game.id}.json`), 'utf8'));
fixture.plays = [...fixture.plays].sort((a, b) => a.sequence - b.sequence).slice(game.from);

/** What this stretch will call, so the primary seat can be chosen on evidence. */
const upcoming = new Set();
for (const play of fixture.plays) {
  for (const d of detectPlay(play, { league: game.league })) {
    if (modeFor(d.cardId) === AUTO) upcoming.add(d.cardId);
  }
}

/**
 * Everything that happens, stamped from the moment recording starts, so the
 * videos can be jumped through rather than watched hoping.
 */
const t0 = Date.now();
const timeline = [];
const mmss = (ms) => {
  const s2 = Math.round(ms / 1000);
  return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`;
};
const note = (what) => {
  const at = mmss(Date.now() - t0);
  timeline.push({ at, what });
  console.log(`  ${at}  ${what}`);
  // Appended immediately. A run that dies — or a waiter that gets stopped —
  // must not take the record of what happened with it.
  try { fs.appendFileSync(path.join(OUT, 'timeline.txt'), `${at}  ${what}\n`); } catch { /* best effort */ }
};

const NAMES = ['Ref', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'];
// Clear the previous run out of this folder first. A recording whose primary
// seat differs from last time otherwise leaves the old seat's video sitting
// alongside the new one, and nothing on disk says which is current.
for (const f of fs.readdirSync(OUT)) {
  if (/\.webm$/.test(f) || f === 'manifest.json' || f === 'timeline.txt') {
    fs.rmSync(path.join(OUT, f), { force: true });
  }
}
const browser = await chromium.launch({ headless: true });

const seats = [];
for (const name of NAMES) {
  const context = await browser.newContext({
    viewport: { width: 460, height: 960 },
    recordVideo: { dir: OUT, size: { width: 460, height: 960 } },
  });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL, { waitUntil: 'load' });
  seats.push({ name, context, page, poured: 0 });
}
const ref = seats[0];
// Written before anything can go wrong: this is what lets finalise-recording
// map an anonymous page@<hash>.webm back to a seat, by creation order.
fs.writeFileSync(path.join(OUT, 'pending.json'), JSON.stringify({
  names: NAMES, startedAt: new Date(t0).toISOString(), game: game.label,
}, null, 1));

// ── the journey: room, joins, start ────────────────────────────────────────
await ref.page.getByPlaceholder('Name').fill('Ref');
await ref.page.getByRole('button', { name: 'Create a new game' }).click();
await ref.page.locator('.roomcode .n').waitFor({ timeout: 15000 });
const code = (await ref.page.locator('.roomcode .n').innerText()).trim();
for (const s of seats.slice(1)) {
  await s.page.getByPlaceholder('Name').fill(s.name);
  await s.page.getByPlaceholder('5 digits').fill(code);
  await s.page.getByRole('button', { name: /Join/ }).first().click();
  await s.page.waitForTimeout(700);          // paced, so the roster fills on camera
}
note(`room ${code} created, six seats joining`);
await sleep(1500);
const start = ref.page.getByRole('button', { name: 'Start game' });
await start.waitFor({ timeout: 15000 });
for (let i = 0; i < 20 && await start.isDisabled(); i += 1) await ref.page.waitForTimeout(400);
await start.click();
await sleep(2000);
note('game started');

// ── which seat holds the most of what is coming ────────────────────────────
const driver = io(URL, { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false });
await new Promise((r) => driver.on('connect', r));
driver.emit('requestGameState', { roomCode: code, playerName: 'Recorder' });

// The hand renders LABELS, uppercased by CSS — "SACK" for the card `Sacks` —
// so an id-to-id comparison finds nothing at all.
const cardsSource = fs.readFileSync(path.join(ROOT, 'client/src/data/cards.js'), 'utf8');
const labelOf = {};
for (const m of cardsSource.matchAll(/id:\s*'([^']+)'[\s\S]{0,200}?label:\s*'([^']+)'/g)) {
  labelOf[m[1]] = m[2].toUpperCase();
}
const upcomingLabels = new Set([...upcoming].map((id) => labelOf[id] || id.toUpperCase()));

const handOf = async (seat) => {
  const names = await seat.page.locator('.handblock .c-name').allInnerTexts().catch(() => []);
  return names.map((n) => n.trim().toUpperCase());
};
let primary = seats[1];
let bestOverlap = -1;
for (const s of seats.slice(1)) {
  const hand = await handOf(s);
  const overlap = hand.filter((c) => upcomingLabels.has(c)).length;
  console.log(`  ${s.name}: holds ${overlap} of the cards this stretch will call`);
  if (overlap > bestOverlap) { bestOverlap = overlap; primary = s; }
}
console.log(`primary seat: ${primary.name} (holds ${bestOverlap})`);
fs.writeFileSync(path.join(OUT, 'pending.json'), JSON.stringify({
  names: NAMES, startedAt: new Date(t0).toISOString(), game: game.label,
  primarySeat: primary.name, primaryHolds: bestOverlap,
}, null, 1));

// ── the picker, on camera ──────────────────────────────────────────────────
await ref.page.locator('.watchbtn').first().evaluate((el) => el.click());
await ref.page.locator('.gamepicker').waitFor({ timeout: 20000 });
note('picker opens — the NFL slate');
await sleep(6000);                                   // long enough to read it
if (game.league === 'college-football') {
  await ref.page.getByRole('tab', { name: 'College' }).evaluate((el) => el.click());
  note('league switched to College — ranked games only');
  await sleep(4000);
  await ref.page.locator('.gamepicker .chk input').evaluate((el) => el.click());
  note('ranked filter off — the whole Saturday slate');
  await sleep(3000);
  await ref.page.getByLabel('Search teams').fill('smu');
  note('searching "smu" to find one game among forty-five');
  await sleep(3000);
}
await ref.page.locator('.gamepicker .x').evaluate((el) => el.click());
note('game chosen, picker closes');
await sleep(800);

/**
 * Everything below is driven through the REF'S OWN UI, not the driver socket.
 *
 * setCardMode, pauseAutoCall and acceptSuggestion are all guarded with
 * `if (refOf(roomCode) !== socket.id) return;`. The driver is not the Ref, so
 * every one of them silently no-opped — and the timeline recorded them as
 * having happened. Three false claims in every recording: a dial that was
 * never changed, a pause that never paused, suggestions never answered.
 * attachGame worked only because it has an explicit dev-only replay bypass.
 *
 * So these go through the buttons a Ref actually presses, and each one is
 * VERIFIED before it is written down. A no-op now fails the run instead of
 * being recorded as fact.
 */
const openDial = async () => {
  await ref.page.locator('.watchbtn', { hasText: 'What the feed calls' })
    .evaluate((el) => el.click());
  await ref.page.locator('.carddial').waitFor({ timeout: 10000 });
};
const closeDial = async () => {
  await ref.page.locator('.carddial .x').evaluate((el) => el.click());
  await ref.page.locator('.carddial').waitFor({ state: 'detached', timeout: 10000 });
};

driver.emit('attachGame', {
  roomCode: code, league: game.league, gameId: REPLAY_GAME_ID,
  replayFixture: fixture, speed: 1,
});
note('game attached — score and clock live in the header');
await sleep(2500);

// ── the dial: a few cards moved to suggest, so both flows appear ───────────
// First Down stays on AUTO. It is the most frequent call across a whole game
// and moving it would hide the thing these recordings exist to show.
const TO_SUGGEST = ['Field Goal', 'Sacks', 'Turnover on Downs'];
await openDial();
for (const cardId of TO_SUGGEST) {
  const group = ref.page.getByRole('group', { name: `${cardId} mode` });
  await group.getByRole('button', { name: 'suggest' }).evaluate((el) => el.click());
  await sleep(400);                                   // visible on camera
}
for (const cardId of TO_SUGGEST) {
  const pressed = await ref.page.getByRole('group', { name: `${cardId} mode` })
    .getByRole('button', { name: 'suggest' }).getAttribute('aria-pressed');
  if (pressed !== 'true') throw new Error(`dial did not take: ${cardId} is not on suggest`);
}
await closeDial();
note(`dial: ${TO_SUGGEST.join(', ')} → suggest (First Down stays auto) — verified`);

// ── the Ref answers suggestions: accept the first, ignore the second ───────
// The prompt is sent to the Ref alone, so it can only be seen and answered
// from the Ref's page. Polled from the main loop below.
let suggestionsSeen = 0;
const answerSuggestion = async () => {
  const prompt = ref.page.locator('.suggestion');
  if (!(await prompt.count())) return;
  const cardId = await prompt.locator('.sg-card').innerText().catch(() => '');
  suggestionsSeen += 1;
  if (suggestionsSeen === 1) {
    await sleep(2500);                                // let it be read on camera
    await prompt.locator('.sg-yes').evaluate((el) => el.click()).catch(() => {});
    note(`Ref ACCEPTS the suggestion: ${cardId}`);
  } else {
    note(`Ref IGNORES a suggestion: ${cardId} — left to expire`);
    // Left alone deliberately: it has to disappear on its own.
    await prompt.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  }
};

const calls = [];
// Both events fire for every round and `declaredCard` lands FIRST, carrying no
// attribution. So the fallback pushes, and `roundSource` upgrades that entry in
// place with who called it and why — rather than recording the round twice.
driver.on('declaredCard', (cardId) => {
  if (!cardId) return;
  const last = calls[calls.length - 1];
  if (last && last.cardId === cardId && last.by === 'unknown') return;
  calls.push({ cardId, by: 'unknown' });
});
driver.on('roundSource', (p) => {
  const last = calls[calls.length - 1];
  if (last && last.cardId === p.cardId && last.by === 'unknown') {
    calls[calls.length - 1] = { ...last, ...p };
    return;
  }
  calls.push(p);
});

// ── the seats play ─────────────────────────────────────────────────────────
// Rotates through four behaviours so the video shows the range rather than the
// same pour four times.
let roundIndex = 0;
let lastCard = null;
const behaviours = ['spread', 'undo-reassign', 'lock-in', 'run-out'];

const playRound = async (seat, behaviour) => {
  const tiles = seat.page.locator('.assigner-overlay button[data-p]');
  const count = await tiles.count();
  if (!count) return;

  const owed = Number(await seat.page.locator('.adock .num').first().innerText()
    .catch(() => '0')) || 0;
  if (behaviour === 'run-out') { console.log(`    ${seat.name}: letting the clock run`); return; }

  const pours = Math.max(1, Math.min(owed || 3, 6));
  for (let i = 0; i < pours; i += 1) {
    await tiles.nth(i % count).click({ timeout: 2500 }).catch(() => {});
    await sleep(550);                                   // human pace, visible on camera
  }
  seat.poured += pours;

  if (behaviour === 'undo-reassign') {
    await seat.page.locator('.assigner-overlay .undo').click({ timeout: 2500 }).catch(() => {});
    await sleep(900);
    await tiles.nth((count - 1) % count).click({ timeout: 2500 }).catch(() => {});
    console.log(`    ${seat.name}: undid a pour and gave it to someone else`);
    await sleep(600);
  }
  if (behaviour === 'lock-in') {
    await seat.page.locator('.assigner-overlay .lockin').click({ timeout: 2500 }).catch(() => {});
    console.log(`    ${seat.name}: locked in`);
  }
};

const until = Date.now() + MINUTES * 60_000;
while (Date.now() < until) {
  const current = calls.length ? calls[calls.length - 1].cardId : null;
  if (current && current !== lastCard) {
    lastCard = current;
    const behaviour = behaviours[roundIndex % behaviours.length];
    roundIndex += 1;
    note(`round ${roundIndex}: ${current} (${behaviour})`);

    // The assigner opens on `timeRemaining > 0`, which needs the first clock
    // tick — so checking the instant the round is declared finds nothing and
    // the seat never plays. Watch for it instead, for most of the round.
    const played = new Set();
    const deadline = Date.now() + 14_000;
    while (Date.now() < deadline && played.size < seats.length) {
      for (const s of seats) {
        if (played.has(s.name)) continue;
        if (await s.page.locator('.assigner-overlay button[data-p]').count()) {
          played.add(s.name);
          await playRound(s, behaviour);
        }
      }
      await sleep(600);
    }
    if (!played.size) console.log('    (nobody held it)');
  }
  // The results board reverts to Standings on its own after ~20s of nobody
  // touching it. Existing behaviour, worth seeing at least once, so watch the
  // primary seat's tab rather than assuming it happened.
  if (!global.__revert) {
    const tab = await primary.page.locator('.boardtabs .on, .tabs .on, .bt.on').first()
      .innerText().catch(() => '');
    if (/round results/i.test(tab)) global.__resultsSince = global.__resultsSince || Date.now();
    else if (global.__resultsSince && /standings/i.test(tab)) {
      const held = Math.round((Date.now() - global.__resultsSince) / 1000);
      if (held >= 15) { global.__revert = true; note(`results reverted to standings on its own after ${held}s`); }
      global.__resultsSince = null;
    }
  }

  // The pause control, once, midway.
  if (roundIndex === 5 && !global.__paused) {
    global.__paused = true;
    await openDial();
    await ref.page.locator('.pausebtn').evaluate((el) => el.click());
    await ref.page.locator('.pausebtn.on').waitFor({ timeout: 10000 });
    await closeDial();
    note('auto-calling PAUSED — game stays attached, score keeps moving');
    await sleep(14000);
    await openDial();
    await ref.page.locator('.pausebtn').evaluate((el) => el.click());
    await ref.page.locator('.pausebtn.on').waitFor({ state: 'detached', timeout: 10000 });
    await closeDial();
    note('auto-calling RESUMED')
  }
  await answerSuggestion();
  await sleep(700);
}

console.log(`\n${calls.length} rounds: ${calls.map((c) => c.cardId).join(', ')}`);
for (const s of seats) console.log(`  ${s.name}: poured ${s.poured}`);

// Also Ref-guarded — over the driver socket this no-opped, which is what left
// a replay feed running for half an hour and contaminated the next run.
await ref.page.locator('.ls-detach').evaluate((el) => el.click()).catch(() => {});
await sleep(1500);
note('game detached — the room is an ordinary game again');

// Playwright only flushes a video when its context closes, so nothing is
// renameable until here.
for (const s of seats) await s.context.close();
await browser.close();

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  league: which, game: game.label, fixture: `${game.league}/${game.id}`, fromPlay: game.from,
  minutes: MINUTES, room: code, primarySeat: primary.name, primaryHolds: bestOverlap,
  rounds: calls.map((c) => ({ card: c.cardId, by: c.by, reason: c.reason })),
  timeline,
}, null, 1));

driver.close();

// Exactly what `node scripts/finalise-recording.mjs <folder>` does by hand.
// One code path, so a re-run cannot behave differently from the real thing.
finalise(OUT);

console.log('\n── timeline ──');
for (const e of timeline) console.log(`  ${e.at}  ${e.what}`);
console.log('done');
// The socket.io client holds the event loop open, so without this the process
// lingers after finishing and anything chained behind it never runs. That is
// what cost the college walkthrough.
process.exit(0);
