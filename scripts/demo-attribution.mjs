/**
 * Re-take the two stills that show the round banner, from a PLAYER's seat.
 *
 *   ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *   node scripts/demo-attribution.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts');
const URL = 'http://127.0.0.1:3002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const pages = [];
for (const name of ['Ref', 'Ben', 'Cy']) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 960 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL, { waitUntil: 'load' });
  pages.push({ name, page });
}
const [ref, ben, cy] = pages;
await ref.page.getByPlaceholder('Name').fill('Ref');
await ref.page.getByRole('button', { name: 'Create a new game' }).click();
await ref.page.locator('.roomcode .n').waitFor({ timeout: 15000 });
const code = (await ref.page.locator('.roomcode .n').innerText()).trim();
for (const p of [ben, cy]) {
  await p.page.getByPlaceholder('Name').fill(p.name);
  await p.page.getByPlaceholder('5 digits').fill(code);
  await p.page.getByRole('button', { name: /Join/ }).first().click();
  await p.page.waitForTimeout(500);
}
const start = ref.page.getByRole('button', { name: 'Start game' });
await start.waitFor({ timeout: 15000 });
for (let i = 0; i < 20 && await start.isDisabled(); i += 1) await ref.page.waitForTimeout(400);
await start.click();
await ref.page.waitForTimeout(1200);

const driver = io(URL, { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false });
await new Promise((r) => driver.on('connect', r));
driver.emit('requestGameState', { roomCode: code, playerName: 'Recorder' });

let called = null;
driver.on('roundSource', (p) => { if (!called) called = p; });

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/nfl/401772636.json'), 'utf8'));
fixture.plays = [...fixture.plays].sort((a, b) => a.sequence - b.sequence).slice(12, 80);
driver.emit('attachGame', {
  roomCode: code, league: 'nfl', gameId: `${fixture.gameId}-attrib`,
  replayFixture: fixture, speed: 400,
});

// Wait for the feed to actually call something.
for (let i = 0; i < 120 && !called; i += 1) await sleep(500);
if (!called) { console.error('the feed never called a round'); process.exit(1); }
console.log(`feed called ${called.cardId} — "${called.reason}"`);
await sleep(1200);

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `still-${name}.png`) });
  console.log(`  still-${name}.png`);
};
await shot(ben.page, '02-first-call-player');
await shot(ref.page, '02-first-call');

// Someone hands out drinks, from a seat that holds the card if there is one.
for (const w of [ben, cy, ref]) {
  const tap = w.page.locator('.assigner-overlay .who button, .assigner-overlay .tap, .assign button').first();
  if (await tap.count()) { await tap.click({ timeout: 3000 }).catch(() => {}); break; }
}
await sleep(900);
await shot(ben.page, '03-assigning-player');
await shot(ref.page, '03-assigning');

driver.emit('detachGame', { roomCode: code });
await browser.close();
console.log('done');
