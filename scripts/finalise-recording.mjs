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
import { sourceLine } from '../client/src/lib/round-source.js';
import { WILD_CARDS } from '../client/src/data/cards.js';

const WILD = new Set(WILD_CARDS.map((c) => c.id));

/**
 * What the banner actually said.
 *
 * The server sends ESPN's raw summary for the play, and the client puts it
 * through a corroboration gate before showing it: text that does not support
 * the card is dropped and the banner reads "The game called it" alone. A
 * manifest that records the raw summary therefore claims the app displayed
 * something it refused to display — a Penalty round whose recorded reason
 * describes a first down. The artifact has to say what was on screen.
 *
 * @param {{card: string, by: string, reason?: string}} round
 */
export const asDisplayed = (round) => {
  const raw = round.reason ?? round.rejectedSummary ?? null;
  const banner = sourceLine({ by: round.by, cardId: round.card, reason: raw },
    WILD.has(round.card));
  const shown = banner.startsWith('The game called it · ')
    ? banner.slice('The game called it · '.length) : '';
  return {
    card: round.card,
    by: round.by,
    banner,
    // Kept, but named for what it is: the text the gate refused. Only present
    // when there was something and it did not survive.
    ...(raw && !shown ? { rejectedSummary: raw } : {}),
  };
};

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

  // Repair a manifest written before the double-count was fixed: `declaredCard`
  // and `roundSource` both fire per round, so an adjacent pair naming the same
  // card is one round, and the attributed half is the one to keep.
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const rounds = (manifest.rounds || []).reduce((acc, r) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.card === r.card && (prev.by === 'unknown') !== (r.by === 'unknown')) {
        return [...acc.slice(0, -1), prev.by === 'unknown' ? r : prev];
      }
      return [...acc, r];
    }, []);
    // Once written, a manifest is the record of ONE run and must never be
    // recomputed. `banner` is derived from the client's formatter, so a later
    // change to that formatter would silently rewrite these lines into text the
    // footage does not show — the manifest would drift away from the video it
    // describes. Freeze on first write.
    const frozen = Boolean(manifest.footage && manifest.footage.bannersFrozen);
    if (frozen) console.log('  manifest.json: banners frozen — left exactly as recorded');
    const displayed = rounds.map(asDisplayed);
    const rejected = displayed.filter((r) => r.rejectedSummary).length;
    const before = JSON.stringify(manifest.rounds);
    if (!frozen && before !== JSON.stringify(displayed)) {
      fs.writeFileSync(manifestPath, JSON.stringify({
        ...manifest,
        rounds: displayed,
        footage: {
          ...(manifest.footage || {}),
          bannersFrozen: true,
          note: 'Each `banner` is the text the app rendered during this run. '
            + 'Frozen: never recompute it, or the manifest drifts away from the video.',
        },
      }, null, 1));
      if (rounds.length !== (manifest.rounds || []).length) {
        console.log(`  manifest.json: ${manifest.rounds.length} entries collapsed to ${rounds.length} rounds`);
      }
      console.log(`  manifest.json: rounds now record the banner text`
        + (rejected ? `, ${rejected} with a reason the gate refused` : ''));
    }
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
