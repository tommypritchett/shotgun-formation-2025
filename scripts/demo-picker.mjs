/**
 * Screenshot the game picker against a REAL past slate.
 *
 * There is no live football most of the week, so the picker is empty most of
 * the week. Start the server with FEED_DEMO_DATE set and it lists that day
 * instead — real endpoint, real shapes, real teams and scores.
 *
 *   FEED_DEMO_DATE_NFL=20251109 FEED_DEMO_DATE_COLLEGE=20251108 \\
 *     ALLOW_REPLAY_ATTACH=1 PORT=3002 node server.js
 *   node scripts/demo-picker.mjs
 *
 * Writes artifacts/picker-*.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts');
const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:3002';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const shot = async (page, name) => {
  const file = path.join(OUT, `picker-${name}.png`);
  // Screenshot the SHEET, not the viewport: the picker renders in an overlay
  // that can sit outside a phone-sized viewport, which produces a blank frame.
  const sheet = page.locator('.gamepicker');
  if (await sheet.count()) await sheet.screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('  ', file);
};

// Three players, because the picker only exists inside a started game.
const pages = [];
for (const name of ['Ref', 'Ben', 'Cy']) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 }, deviceScaleFactor: 2 });
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
console.log(`room ${code} ready`);

// Open the picker: NFL first.
// The dock is fixed and can be clipped at phone heights, so click the element
// itself rather than fighting the viewport.
await ref.page.locator('.watchbtn').first().evaluate((el) => el.click());
await ref.page.locator('.gamepicker .gamerow').first().waitFor({ timeout: 20000 });
const nflCount = await ref.page.locator('.gamepicker .gamerow').count();
console.log(`NFL slate: ${nflCount} games`);
await shot(ref.page, 'nfl');

// College: the picker's real work.
// Switching league re-requests from the server, so wait for the LIST TO
// CHANGE rather than for "a row exists" — the NFL rows are still on screen.
const firstNflRow = await ref.page.locator('.gamepicker .gamerow').first().innerText();
await ref.page.getByRole('tab', { name: 'College' }).evaluate((el) => el.click());
await ref.page.waitForFunction(
  (previous) => {
    const row = document.querySelector('.gamepicker .gamerow');
    return row && row.innerText !== previous;
  },
  firstNflRow,
  { timeout: 30000 }
);
const cfbCount = await ref.page.locator('.gamepicker .gamerow').count();
console.log(`college (ranked-only default): ${cfbCount} games`);
await shot(ref.page, 'college-ranked');

// Everything, so the size of a Saturday is visible.
await ref.page.locator('.gamepicker .chk input').evaluate((el) => el.click());
await ref.page.waitForTimeout(400);
console.log(`college (all): ${await ref.page.locator('.gamepicker .gamerow').count()} games`);
await shot(ref.page, 'college-all');

// Search, which is how anyone finds one game among a hundred.
await ref.page.getByLabel('Search teams').fill('ohio');
await ref.page.waitForTimeout(400);
console.log(`college (search "ohio"): ${await ref.page.locator('.gamepicker .gamerow').count()} games`);
await shot(ref.page, 'college-search');

await browser.close();
console.log('done');
