/**
 * Four Turnovers = 16 drinks = 1 shotgun + 6 drinks.
 *
 * The owner reproduced: you are given the shotgun and the six drinks are
 * unreachable. This drives it in a real browser and prints each phase.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4034, URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startServer = () => new Promise((res, rej) => {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  const t = setTimeout(() => rej(new Error('no start')), 15000);
  p.stdout.on('data', (b) => { if (String(b).includes('running on port')) { clearTimeout(t); res(p); } });
});
const bot = (n) => new Promise((res) => {
  const s = io(URL, { transports: ['websocket'], reconnection: false });
  s.on('connect', () => res({ s, n, id: s.id }));
});
const read = (page) => page.evaluate(() => {
  const el = document.querySelector('.assign');
  if (!el) return { open: false };
  return {
    hold: el.querySelector('.hold')?.textContent.replace(/\s+/g, ' ').trim(),
    head: el.querySelector('.gridhead .tag')?.textContent.trim(),
    hint: el.querySelector('.gridhead .hint')?.textContent.trim(),
    ammo: el.querySelector('.ammo .big')?.textContent.trim() ?? null,
    lock: el.querySelector('.lockin')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
  };
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
  await sleep(800);

  // Pick whichever card is worth 10+ in total, so the server splits it.
  const target = await page.evaluate(() => {
    const STD = ['Touchdown', 'Field Goal', 'Turnover', 'Sack', 'Penalty'];
    const t = {};
    document.querySelectorAll('.handgrid .card').forEach((c) => {
      const n = c.querySelector('.c-name')?.textContent.trim();
      const v = Number(c.querySelector('.c-corner .cv')?.textContent.trim());
      if (STD.includes(n) && v) t[n] = (t[n] || 0) + v;
    });
    const best = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
    return best ? { name: best[0], total: best[1] } : null;
  });
  console.log(`\nDeclaring ${target.name} — worth ${target.total} in hand`);
  if (target.total < 10) console.log('  (under 10, so no split this deal — rerun for the fold case)');

  await page.click('button.declare');
  await page.waitForSelector('.sheet.on .mi', { timeout: 10000 });
  await page.click(`.sheet.on .mi:has-text("${target.name}")`);
  await page.waitForSelector('.assign', { timeout: 15000 });
  await sleep(600);
  console.log('PHASE 1:', JSON.stringify(await read(page)));

  // Pour everything, one tap at a time, printing when the phase flips.
  let last = null;
  for (let i = 0; i < 20; i += 1) {
    const tiles = await page.$$('.ptile');
    if (!tiles.length) break;
    await tiles[i % tiles.length].click();
    await sleep(220);
    const now = await read(page);
    if (now.head !== last) { console.log(`  after tap ${i + 1}:`, JSON.stringify(now)); last = now.head; }
    if (now.lock && now.lock.includes('LOCK IN')) { console.log('ALL SETTLED:', JSON.stringify(now)); break; }
  }

  bots.forEach((b) => b.s.close());
  await ctx.close();
} finally { await browser.close(); server.kill(); }
