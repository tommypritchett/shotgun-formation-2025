/**
 * The replay seam has to be visible when it is on.
 *
 * `ALLOW_REPLAY_ATTACH=1` lets any socket attach an arbitrary replay fixture to
 * any room, bypassing the Ref-only rule. That is correct for a dev machine and
 * would be a room-hijack primitive in production. It is off by default — but
 * off-by-default is worth much less than visible-if-on, because the failure
 * mode is somebody setting it and nobody noticing.
 *
 * The boot line is where that gets noticed: it is the first thing in the Render
 * log, next to the commit SHA.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Boot the real server, read its banner, kill it. Port 0 avoids collisions. */
const bootLog = (env) => new Promise((resolve, reject) => {
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', ...env },
  });
  let out = '';
  const done = (err) => { try { child.kill('SIGKILL'); } catch { /* already gone */ }
    if (err) reject(err); else resolve(out); };
  child.stdout.on('data', (d) => {
    out += String(d);
    // The commit line is the last thing the banner prints.
    if (/Running code:/.test(out)) setTimeout(() => done(), 150);
  });
  child.stderr.on('data', (d) => { out += String(d); });
  child.on('error', done);
  setTimeout(() => done(new Error(`server never booted. Got:\n${out}`)), 20_000);
});

describe('the boot banner', () => {
  it('says so, loudly, when the replay seam is on', async () => {
    const out = await bootLog({ ALLOW_REPLAY_ATTACH: '1' });

    expect(out).toMatch(/ALLOW_REPLAY_ATTACH/);
    // Not a neutral note — it has to read as something to act on.
    expect(out).toMatch(/replay attach|not for production/i);
  }, 30_000);

  it('stays silent when it is off, so the warning means something', async () => {
    // A banner that always warns is a banner nobody reads.
    const out = await bootLog({ ALLOW_REPLAY_ATTACH: undefined });

    expect(out).toMatch(/Running code:/);
    expect(out).not.toMatch(/ALLOW_REPLAY_ATTACH/);
  }, 30_000);

  it('is not fooled by a truthy-looking value', async () => {
    // The guard is `=== '1'`, so the banner must use the same test or the two
    // disagree — a log that says "off" while the seam is on is worse than none.
    const out = await bootLog({ ALLOW_REPLAY_ATTACH: 'true' });

    expect(out).not.toMatch(/ALLOW_REPLAY_ATTACH/);
  }, 30_000);
});
