/**
 * Load the BUILT bundle in a real browser and fail on any uncaught error.
 *
 * This exists because "Compiled with warnings." is not the same as "runs".
 * Session 14 froze the socket options and passed them straight to `io()`;
 * socket.io-client's Manager writes `opts.path` onto whatever object it is
 * given, so the app threw at module scope, before React mounted, and served a
 * white screen. It compiled cleanly. The unit suite was 305 green. Nothing
 * anywhere had ever loaded the built bundle.
 *
 * Usage — serve the build first (`node server.js` does), then:
 *
 *     node scripts/smoke-built-bundle.mjs http://127.0.0.1:3002/
 *
 * Exits non-zero on any uncaught page error. Verified against the bug itself:
 * with the fix reverted it reports
 * `TypeError: Cannot add property path, object is not extensible` and a
 * zero-length #root.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:3002/';
const browser = await chromium.launch();
const page = await browser.newPage();

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('dialog', (d) => d.accept());

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(4000);

const rootHtml = await page.evaluate(() => {
  const r = document.getElementById('root');
  return r ? r.innerHTML.length : -1;
});
const visibleText = (await page.evaluate(() => document.body.innerText || '')).trim().slice(0, 120);

console.log('URL              :', URL);
console.log('#root html length:', rootHtml, rootHtml > 0 ? '(React mounted)' : '(WHITE SCREEN)');
console.log('visible text     :', JSON.stringify(visibleText));
console.log('pageerrors       :', pageErrors.length ? JSON.stringify(pageErrors, null, 2) : 'none');
console.log('console errors   :', consoleErrors.length ? JSON.stringify(consoleErrors, null, 2) : 'none');

await browser.close();
process.exit(pageErrors.length ? 1 : 0);
