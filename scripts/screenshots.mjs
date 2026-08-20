/**
 * Screenshots of the REAL app: a real `server.js`, the real production build,
 * and a real browser joining as a real player over a real socket.
 *
 * Nothing here is mocked or hand-fed state. The game reaches each screen by
 * being played: bots join over sockets, the browser is the host, and the host
 * declares a card it is actually holding so the assigner has real drinks in it.
 *
 * Usage: node scripts/screenshots.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 4010;
const URL = `http://localhost:${PORT}`;

const VIEWPORTS = [
  { name: 'iphone-390x844', width: 390, height: 844, mobile: true },
  { name: 'android-360x780', width: 360, height: 780, mobile: true },
  { name: 'desktop-1280x900', width: 1280, height: 900, mobile: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── server ────────────────────────────────────────────────────────────────
const startServer = () =>
  new Promise((resolve, reject) => {
    const proc = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (buf) => {
      if (String(buf).includes('running on port')) { clearTimeout(timer); resolve(proc); }
    });
    proc.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));
  });

/** A bot player: a real socket, no browser. */
const connectBot = (name) =>
  new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false });
    const bot = { name, socket, id: null, hand: { standard: [], wild: [] } };
    socket.on('connect', () => { bot.id = socket.id; resolve(bot); });
    socket.on('gameStarted', ({ hands }) => {
      if (hands && hands[socket.id]) bot.hand = hands[socket.id];
    });
    socket.on('updatePlayerHand', (hand) => { bot.hand = hand; });
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error(`bot ${name} never connected`)), 10000);
  });

const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  ▸', path.relative(ROOT, file));
};

/** Read the card names the host is actually holding, off the real DOM. */
const handCardNames = (page) =>
  page.$$eval('.handgrid .card .c-name', (els) => els.map((e) => e.textContent.trim()));

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  console.log(`server up on ${PORT}`);

  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n== ${vp.name} ==`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      const page = await context.newPage();

      // ── join screen ────────────────────────────────────────────────────
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 15000 });
      await shot(page, `join-${vp.name}`);

      // The browser is the host, so it can declare a card it is holding.
      await page.fill('.field:nth-of-type(1) input', 'Tommy');
      await page.click('button.btn.ghost');            // Create a new game
      await page.waitForSelector('.roomcode .n', { timeout: 15000 });
      const roomCode = (await page.textContent('.roomcode .n')).trim();
      console.log('  room', roomCode);

      // ── bots fill the table to 6 ───────────────────────────────────────
      const botNames = ['Marcus', 'Big Mike', 'Shannon', 'Devon', 'Priya'];
      const bots = [];
      for (const name of botNames) {
        const bot = await connectBot(name);
        bot.socket.emit('joinRoom', roomCode, name);
        bots.push(bot);
        await sleep(220);
      }
      await page.waitForFunction(
        () => document.querySelectorAll('.rosteri').length >= 6,
        undefined, { timeout: 15000 }
      );
      await shot(page, `lobby-${vp.name}`);

      // ── start, and let the deal land ───────────────────────────────────
      await page.click('button.btn:not(.ghost)');       // Start game
      await page.waitForSelector('.handgrid .card', { timeout: 20000 });
      await sleep(900);
      await shot(page, `game-idle-${vp.name}`);

      // ── declare a card the host is HOLDING, so the assigner is active ──
      const held = await handCardNames(page);
      const target = held.find((n) => ['Touchdown', 'Field Goal', 'Turnover', 'Sack', 'Penalty'].includes(n));
      console.log('  hand:', held.join(', '), '→ declaring', target);

      await page.click('button.declare');
      await page.waitForSelector('.sheet.on .mi', { timeout: 10000 });
      await page.click(`.sheet.on .mi:has-text("${target}")`);

      await page.waitForSelector('.assign', { timeout: 15000 });
      await sleep(700);
      await shot(page, `assigner-${vp.name}`);

      // ── pour into two players, so tallies and the ammo readout are real ─
      const tiles = await page.$$('.ptile');
      if (tiles.length >= 2) {
        await tiles[0].click(); await sleep(180);
        await tiles[1].click(); await sleep(180);
        await tiles[0].click(); await sleep(400);
      }
      await shot(page, `assigner-poured-${vp.name}`);

      // ── let the round expire; auto-lock, then Round Results ────────────
      await page.waitForSelector('.lockin.sent, #toast.on', { timeout: 30000 }).catch(() => {});
      await sleep(600);
      await shot(page, `assigner-autolock-${vp.name}`);

      await page.waitForFunction(
        () => !document.querySelector('.assign'),
        undefined, { timeout: 30000 }
      ).catch(() => {});
      await sleep(900);
      await shot(page, `round-results-${vp.name}`);

      // Standings is one tap back.
      await page.click('.btab:has-text("Standings")').catch(() => {});
      await sleep(400);
      await shot(page, `standings-${vp.name}`);

      bots.forEach((b) => b.socket.close());
      await context.close();
    }

    // ── the mockup, at the same sizes, for side-by-side comparison ───────
    console.log('\n== mockup reference ==');
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2, isMobile: vp.mobile, hasTouch: vp.mobile,
      });
      const page = await context.newPage();
      await page.goto(`${URL}/mockup.html`, { waitUntil: 'networkidle' });
      await sleep(700);
      await shot(page, `MOCKUP-game-${vp.name}`);
      await page.click('#tab2');
      await sleep(900);
      await shot(page, `MOCKUP-assigner-${vp.name}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log('\ndone');
}

run().catch((err) => { console.error(err); process.exit(1); });
