/**
 * The Ref opens the handoff sheet while a player is away.
 *
 * Before: the away player was listed as selectable (stale roster), and tapping
 * them dropped the Ref's own whistle even though the server refused.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4033, URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startServer = () => new Promise((res, rej) => {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  const t = setTimeout(() => rej(new Error('no start')), 15000);
  p.stdout.on('data', (b) => { if (String(b).includes('running on port')) { clearTimeout(t); res(p); } });
});
const bot = (name) => new Promise((res) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.on('connect', () => res({ s, name, id: s.id }));
});

const server = await startServer();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.fill('.field:nth-of-type(1) input', 'Tommy');
  await page.click('button.btn.ghost');
  await page.waitForSelector('.roomcode .n', { timeout: 15000 });
  const code = (await page.textContent('.roomcode .n')).trim();

  const bots = [];
  for (const n of ['Marcus', 'Big Mike']) { const b = await bot(n); b.s.emit('joinRoom', code, n); bots.push(b); await sleep(250); }
  await page.waitForFunction(() => document.querySelectorAll('.rosteri').length >= 3, undefined, { timeout: 15000 });
  await page.click('button.btn:not(.ghost)');
  await page.waitForSelector('.handgrid .card', { timeout: 20000 });
  await sleep(700);

  // Marcus walks away.
  bots[0].s.close();
  await sleep(1200);

  await page.click('.iconbtn');                      // menu
  await page.waitForSelector('.sheet.on', { timeout: 8000 });
  await page.click('.sheet.on .mi:has-text("Hand off the whistle")');
  await page.waitForSelector('[aria-label="Select a new Ref"].on', { timeout: 8000 });
  await sleep(400);

  const sheet = await page.evaluate(() => {
    const s = document.querySelector('[aria-label="Select a new Ref"]');
    return [...s.querySelectorAll('.mi')].map((b) => ({
      text: b.textContent.replace(/\s+/g, ' ').trim(),
      disabled: b.disabled,
    }));
  });
  console.log('\nHANDOFF SHEET with Marcus away:');
  sheet.forEach((r) => console.log(`   ${r.disabled ? '[disabled]' : '[  click ]'} ${r.text}`));

  // Still the Ref?
  const stillRef = await page.evaluate(() => !!document.querySelector('.declare .ref'));
  console.log(`\nRef still holds the whistle before choosing: ${stillRef}`);

  bots.forEach((b) => b.s.close());
  await ctx.close();
} finally { await browser.close(); server.kill(); }
