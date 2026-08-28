/**
 * Reproduce: pour some of what you owe, refresh, see what the app says.
 *
 * The socket-level repro shows the SERVER replaying the full original amount.
 * The owner sees zero. That difference can only be client-side, so this drives
 * a real browser through the owner's exact steps and reports what it shows.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4032, URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverLog = [];

const startServer = () => new Promise((res, rej) => {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  const t = setTimeout(() => rej(new Error('no start')), 15000);
  p.stdout.on('data', (b) => { serverLog.push(String(b)); if (String(b).includes('running on port')) { clearTimeout(t); res(p); } });
  return p;
});
const bot = (name) => new Promise((res) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.on('connect', () => res({ s, name, id: s.id }));
});

/** What the assigner is telling the player right now. */
const readAssigner = (page) => page.evaluate(() => {
  const el = document.querySelector('.assign');
  if (!el) return { open: false };
  const ammo = el.querySelector('.ammo .big');
  const lock = el.querySelector('.lockin');
  return {
    open: true,
    hold: el.querySelector('.hold')?.textContent?.trim(),
    ammo: ammo ? ammo.textContent.trim() : null,
    lock: lock ? lock.textContent.trim() : null,
    passive: !!el.querySelector('.passive'),
    tiles: [...el.querySelectorAll('.ptile')].map((t) => t.dataset.given),
  };
});

const server = await startServer();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // The app fires alert() for its instructions on join and on game start.
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
  await sleep(800);

  // Pick the STANDARD card worth the most in total (face value x copies held),
  // so there is enough to pour a few and still have some outstanding. A
  // 1-drink Penalty makes the test degenerate.
  const target = await page.evaluate(() => {
    const STD = ['Touchdown', 'Field Goal', 'Turnover', 'Sack', 'Penalty'];
    const totals = {};
    document.querySelectorAll('.handgrid .card').forEach((c) => {
      const name = c.querySelector('.c-name')?.textContent.trim();
      const val = Number(c.querySelector('.c-corner .cv')?.textContent.trim());
      if (!STD.includes(name) || !val) return;
      totals[name] = (totals[name] || 0) + val;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0];
  });
  await page.click('button.declare');
  await page.waitForSelector('.sheet.on .mi', { timeout: 10000 });
  await page.click(`.sheet.on .mi:has-text("${target}")`);
  await page.waitForSelector('.assign', { timeout: 15000 });
  await sleep(600);

  console.log('\nBEFORE any pour:', JSON.stringify(await readAssigner(page)));

  const tiles = await page.$$('.ptile');
  await tiles[0].click(); await sleep(250);
  await tiles[0].click(); await sleep(900);   // two poured, and flushed
  console.log(`AFTER pouring 2 (${target}):`, JSON.stringify(await readAssigner(page)));

  const mark = serverLog.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);
  console.log('AFTER refresh   :', JSON.stringify(await readAssigner(page)));

  console.log('\n=== server, from the refresh onward ===');
  console.log(serverLog.slice(mark).join('').split('\n').filter((l) => /REPLAY|owes/i.test(l)).join('\n') || '  (no REPLAY line)');

  bots.forEach((b) => b.s.close());
  await ctx.close();
} finally { await browser.close(); server.kill(); }
