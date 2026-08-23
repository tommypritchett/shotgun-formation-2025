/**
 * Capture the First Down screen from the real app.
 *
 * It was reported as reading like someone is about to point at you — the
 * passive "you don't hold this card" copy. First Down is a global event, so it
 * needs its own words. This drives a real round to prove what a player sees.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4012;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startServer = () => new Promise((resolve, reject) => {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  const t = setTimeout(() => reject(new Error('server never started')), 15000);
  p.stdout.on('data', (b) => { if (String(b).includes('running on port')) { clearTimeout(t); resolve(p); } });
});

const bot = (name) => new Promise((res) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.on('connect', () => res({ s, name, id: s.id }));
});

const server = await startServer();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
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

  // A BOT calls First Down, so the browser player sees it as a plain participant.
  await page.click('button.declare');
  await page.waitForSelector('.sheet.on .mi', { timeout: 10000 });
  await page.click('.sheet.on .mi:has-text("First Down")');

  await page.waitForSelector('.assign', { timeout: 15000 });
  await sleep(900);
  await page.screenshot({ path: path.join(ROOT, 'screenshots', 'first-down-iphone-390x844.png') });
  console.log('  ▸ screenshots/first-down-iphone-390x844.png');
  bots.forEach((b) => b.s.close());
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}
