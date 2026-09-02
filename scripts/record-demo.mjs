/**
 * Record the feed calling a game, at REAL speed, from two viewpoints.
 *
 * Sped up it reads as a slideshow; the whole question is what the rhythm feels
 * like, so this runs at 1x. IND 31 - ATL 25 from Q1 10:15 contains the busiest
 * stretch in any of the ten fixtures — fourteen calls in five minutes.
 *
 *   ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *   node scripts/record-demo.mjs
 *
 * Writes artifacts/video/ref-*.webm, artifacts/video/player-*.webm and
 * artifacts/still-*.png. Takes about as long as the stretch it records.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts');
const VIDEO = path.join(OUT, 'video');
const URL = 'http://127.0.0.1:3002';
const FIXTURE = path.join(ROOT, 'fixtures/nfl/401772636.json');
const FROM = Number(process.env.DEMO_FROM || 12);
// Long enough to reach the busy stretch at real speed. Plays are spaced by
// their real wallclock gaps, so this is football time, not a progress bar.
const MINUTES = Number(process.env.DEMO_MINUTES || 12);

fs.mkdirSync(VIDEO, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString();

const browser = await chromium.launch({ headless: true });

/** Two viewpoints: the Ref, who has the controls, and an ordinary player. */
const open = async (label) => {
  const context = await browser.newContext({
    viewport: { width: 460, height: 960 },
    recordVideo: { dir: VIDEO, size: { width: 460, height: 960 } },
  });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL, { waitUntil: 'load' });
  return { label, context, page };
};

const ref = await open('ref');
const ben = await open('player');
const cy = await open('third');

await ref.page.getByPlaceholder('Name').fill('Ref');
await ref.page.getByRole('button', { name: 'Create a new game' }).click();
await ref.page.locator('.roomcode .n').waitFor({ timeout: 15000 });
const code = (await ref.page.locator('.roomcode .n').innerText()).trim();
for (const [w, name] of [[ben, 'Ben'], [cy, 'Cy']]) {
  await w.page.getByPlaceholder('Name').fill(name);
  await w.page.getByPlaceholder('5 digits').fill(code);
  await w.page.getByRole('button', { name: /Join/ }).first().click();
  await w.page.waitForTimeout(500);
}
const start = ref.page.getByRole('button', { name: 'Start game' });
await start.waitFor({ timeout: 15000 });
for (let i = 0; i < 20 && await start.isDisabled(); i += 1) await ref.page.waitForTimeout(400);
await start.click();
await ref.page.waitForTimeout(1500);
console.log(`room ${code} ready — recording ${MINUTES} minutes at 1x`);

const stills = [];
const still = async (name, note) => {
  const file = path.join(OUT, `still-${name}.png`);
  await ref.page.screenshot({ path: file });
  const playerFile = path.join(OUT, `still-${name}-player.png`);
  await ben.page.screenshot({ path: playerFile });
  stills.push({ name, note, at: stamp() });
  console.log(`  still: ${name} — ${note}`);
};

// Attach the fixture from just before the busy stretch.
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
fixture.plays = [...fixture.plays].sort((a, b) => a.sequence - b.sequence).slice(FROM);
const driver = io(URL, { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false });
await new Promise((r) => driver.on('connect', r));
// JOIN the room, or this socket sees nothing: `io.to(roomCode)` only reaches
// members, so a driver that merely attached the game records "0 calls" while
// rounds are firing in the browsers.
driver.emit('requestGameState', { roomCode: code, playerName: 'Recorder' });
await sleep(600);

// Watch the wire so stills land on the real moments rather than on a timer.
let firstCall = null;
let multiCard = null;
const seen = [];
driver.on('playAutoCalled', (p) => {
  seen.push({ cardId: p.cardId, at: Date.now() });
  if (!firstCall) firstCall = p;
  const recent = seen.filter((s) => Date.now() - s.at < 3000);
  if (recent.length > 1 && !multiCard) multiCard = recent.map((s) => s.cardId);
});

driver.emit('attachGame', {
  roomCode: code, league: fixture.league, gameId: String(fixture.gameId),
  replayFixture: fixture, speed: 1,
});
await new Promise((r) => { driver.once('gameAttached', r); setTimeout(r, 5000); });
await sleep(1500);
await still('01-attached', 'live score header, feed announced');

// Wait for the first round the feed starts.
// Wait for a real round rather than for a selector guess: the wire says when.
await new Promise((resolve) => {
  if (firstCall) { resolve(); return; }
  const started = Date.now();
  const poll = setInterval(() => {
    if (firstCall || Date.now() - started > 150000) { clearInterval(poll); resolve(); }
  }, 500);
});
await sleep(1500);
await still('02-first-call', `first auto-called round${firstCall ? `: ${firstCall.cardId}` : ''}`);

// Someone assigns drinks, so the demo shows a round being played, not just started.
const pour = ben.page.locator('.assigner-overlay button, .tapzone, .assign button').first();
if (await pour.count()) {
  await pour.click({ timeout: 5000 }).catch(() => {});
  await sleep(800);
  await still('03-assigning', 'a player handing out drinks');
}

// Results.
await sleep(9000);
await still('04-results', 'round results on the board');

// The dial and the pause control, taken WHILE THE GAME IS STILL ATTACHED.
// Left to the end they land after the feed has finished and detached, and the
// button under `.watchbtn` is "Watch a game" again — which is how the first
// take produced three stills of the picker.
const openDial = async () => {
  const dial = ref.page.locator('.watchbtn', { hasText: 'What the feed calls' });
  if (await dial.count()) {
    await dial.evaluate((el) => el.click());
    await sleep(900);
    return true;
  }
  return false;
};

await sleep(45_000);
if (await openDial()) {
  await still('06-dial', 'the per-card dial, grouped by how often a card fires');
  await ref.page.locator('.pausebtn').evaluate((el) => el.click());
  await sleep(1500);
  await still('07-paused', 'auto-calling paused, game still attached');
  await sleep(8000);
  await ref.page.locator('.pausebtn').evaluate((el) => el.click());
  await sleep(1200);
  await still('08-resumed', 'auto-calling resumed');
  await ref.page.locator('.carddial .x').evaluate((el) => el.click()).catch(() => {});
  await sleep(600);
} else {
  console.log('  (dial unavailable — the game was no longer attached)');
}

// Then let the rest of the stretch run, catching a back-to-back pair.
const until = Date.now() + MINUTES * 60_000;
let grabbedMulti = false;
while (Date.now() < until) {
  await sleep(3000);
  if (multiCard && !grabbedMulti) {
    grabbedMulti = true;
    await still('05-multi-card', `back-to-back rounds: ${multiCard.join(' then ')}`);
  }
}

console.log(`\ncalls seen while recording: ${seen.length}`);
console.log(seen.map((s) => s.cardId).join(', ') || '(none)');

driver.emit('detachGame', { roomCode: code });
await sleep(800);
for (const w of [ref, ben, cy]) await w.context.close();   // flushes the video
await browser.close();

const files = fs.readdirSync(VIDEO).filter((f) => f.endsWith('.webm'));
console.log('\nvideos:');
files.forEach((f) => console.log('  ', path.join(VIDEO, f)));
console.log('stills:');
stills.forEach((s) => console.log(`   still-${s.name}.png — ${s.note}`));
fs.writeFileSync(path.join(OUT, 'demo-manifest.json'),
  JSON.stringify({ room: code, from: FROM, minutes: MINUTES, calls: seen.map((s) => s.cardId), stills }, null, 1));
