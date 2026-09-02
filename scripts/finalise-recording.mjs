/**
 * Turn a raw recording folder into a finished artifact.
 *
 * Playwright names videos `page@<hash>.webm` and only flushes them when the
 * context closes, so a run that dies — or a waiter that gets stopped — leaves a
 * folder of anonymous files and no timeline. That cost a whole 13-minute
 * recording once; it should not be able to twice.
 *
 * The recorder writes `pending.json` as soon as the seats exist and appends to
 * `timeline.txt` as it goes, so everything this needs is already on disk before
 * anything can go wrong. Run it against any recording folder, any time:
 *
 *   node scripts/finalise-recording.mjs artifacts/walkthrough-nfl
 *
 * It is idempotent — running it on an already-finished folder does nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Rename the seat videos and report the timeline. Safe to call twice.
 * @param {string} dir a recording folder
 */
export const finalise = (dir) => {

  const raw = fs.readdirSync(dir).filter((f) => /^page@.*\.webm$/.test(f));
  if (!raw.length) {
    console.log(`${dir}: nothing to rename (already finalised, or no video yet)`);
  } else {
    const pendingPath = path.join(dir, 'pending.json');
    if (!fs.existsSync(pendingPath)) {
      console.error(`${dir}: no pending.json — cannot tell which seat is which.`);
      console.error('Videos are left as they are rather than guessed at.');
      throw new Error('no seat map');
    }
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));

    // Playwright creates the file when the page is created, so creation order is
    // seat order. That is the only link between an anonymous file and a name.
    const byAge = raw
      .map((f) => ({ f, born: fs.statSync(path.join(dir, f)).birthtimeMs }))
      .sort((a, b) => a.born - b.born)
      .map((x) => x.f);

    if (byAge.length !== pending.names.length) {
      console.warn(`${dir}: ${byAge.length} videos for ${pending.names.length} seats — `
        + 'mapping by creation order anyway, check the result.');
    }

    byAge.forEach((file, i) => {
      const name = pending.names[i];
      const from = path.join(dir, file);
      if (!name) { fs.rmSync(from, { force: true }); return; }
      const role = name === 'Ref' ? '1-PRIMARY-ref'
        : name === pending.primarySeat ? '2-secondary-player' : null;
      // Only the two viewpoints asked for are kept; the rest are the same room
      // from seats nobody needs to watch.
      if (!role) { fs.rmSync(from, { force: true }); return; }
      const to = path.join(dir, `${role}-${name}.webm`);
      fs.renameSync(from, to);
      console.log(`  ${role.padEnd(20)} ${path.basename(to)}`);
    });
  }

  // The timeline is appended live, so it exists even if the run died mid-way.
  const timeline = path.join(dir, 'timeline.txt');
  if (fs.existsSync(timeline)) {
    const lines = fs.readFileSync(timeline, 'utf8').trim().split('\n').filter(Boolean);
    console.log(`  timeline.txt (${lines.length} events, last: ${lines[lines.length - 1] || 'none'})`);
  } else {
    console.log('  no timeline.txt — the run died before anything was logged');
  }
  console.log(`${dir}: finalised`);
};

// CLI: node scripts/finalise-recording.mjs artifacts/walkthrough-college
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target || !fs.existsSync(target)) {
    console.error('usage: finalise-recording.mjs <recording folder>');
    process.exit(2);
  }
  try { finalise(target); } catch (err) { console.error(err.message); process.exit(1); }
}
