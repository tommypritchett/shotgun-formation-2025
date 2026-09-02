/**
 * Re-take just the dial and pause stills, without a full 1x recording.
 *
 *   ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *   node scripts/demo-dial.mjs
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

// Attach slowly so the game stays live for the whole sequence.
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/nfl/401772636.json'), 'utf8'));
fixture.plays = [...fixture.plays].sort((a, b) => a.sequence - b.sequence).slice(12, 60);
const driver = io(URL, { transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: false });
await new Promise((r) => driver.on('connect', r));
driver.emit('attachGame', {
  roomCode: code, league: 'nfl', gameId: `${fixture.gameId}-dial`,
  replayFixture: fixture, speed: 6,
});
await sleep(2500);

const shot = async (name, note) => {
  await ref.page.screenshot({ path: path.join(OUT, `still-${name}.png`) });
  console.log(`  still-${name}.png — ${note}`);
};

await ref.page.locator('.watchbtn', { hasText: 'What the feed calls' }).evaluate((el) => el.click());
await sleep(900);
await shot('06-dial', 'the per-card dial, showing each card in its real mode');
await ref.page.locator('.pausebtn').evaluate((el) => el.click());
await sleep(1200);
await shot('07-paused', 'auto-calling paused, game still attached');
await ref.page.locator('.pausebtn').evaluate((el) => el.click());
await sleep(1000);
await shot('08-resumed', 'auto-calling resumed');

driver.emit('detachGame', { roomCode: code });
await browser.close();
console.log('done');
