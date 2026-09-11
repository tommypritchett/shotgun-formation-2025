/**
 * The one-tap invite.
 *
 * The host reading a code out loud is where players are lost, so this is on
 * the critical path of a stranger's first thirty seconds. It fails open: share
 * -> clipboard -> and if even that fails, the host still has the code on
 * screen and the game is unaffected.
 */
import { describe, expect, it, vi } from 'vitest';
import { inviteText, shareInvite } from '../../client/src/lib/invite.js';
import { SITE_ORIGIN, SITE_LABEL, roomUrl, CUSTOM_DOMAIN_LIVE }
  from '../../client/src/lib/site.js';

describe('the message', () => {
  it('reads correctly with no editing', () => {
    expect(inviteText('48213')).toBe(
      'Shotgun Formation — join my room\n'
      + '\n'
      + 'Code: 48213\n'
      + `${SITE_ORIGIN}/?room=48213\n`
      + '\n'
      + 'No app, no signup. Just open the link.',
    );
  });

  it('carries the code BOTH in the link and written out', () => {
    const text = inviteText('12345');
    expect(text).toContain('Code: 12345');
    expect(text).toContain('?room=12345');
  });

  it('links somewhere that actually resolves today', () => {
    // shotgunformation.com is registered but not serving yet. A pretty link
    // that 404s is worse than an ugly one that works.
    expect(roomUrl('1').startsWith('https://')).toBe(true);
    if (!CUSTOM_DOMAIN_LIVE) {
      expect(SITE_ORIGIN).toContain('onrender.com');
    }
  });

  it('still shows humans the pretty domain', () => {
    expect(SITE_LABEL).toBe('shotgunformation.com');
  });

  it('keeps the host in ONE place, so the switch is one line', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = path.resolve(here, '..', '..', 'client', 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(e.name)) continue;
        if (full.endsWith(path.join('lib', 'site.js'))) continue;   // the one place
        const body = fs.readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
        if (/shotgunformation\.(com|onrender)/.test(body)) {
          offenders.push(path.relative(src, full));
        }
      }
    };
    walk(src);
    expect(offenders, `the domain is hardcoded outside lib/site.js: ${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('does not fall over on a missing room code', () => {
    expect(() => inviteText(undefined)).not.toThrow();
    expect(inviteText(undefined)).toContain('Code: ');
  });
});

describe('getting it out of the phone', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareInvite('48213', { share })).toBe('shared');
    expect(share.mock.calls[0][0].text).toContain('48213');
  });

  it('falls back to the clipboard when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareInvite('48213', { clipboard: { writeText } })).toBe('copied');
    expect(writeText.mock.calls[0][0]).toContain('?room=48213');
  });

  it('falls back to the clipboard when the share sheet is cancelled', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = { share: vi.fn().mockRejectedValue(new Error('cancel')), clipboard: { writeText } };
    expect(await shareInvite('48213', nav)).toBe('copied');
  });

  it('reports failure rather than pretending, when nothing is available', async () => {
    expect(await shareInvite('48213', {})).toBe('failed');
    expect(await shareInvite('48213', null)).toBe('failed');
    const nav = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } };
    expect(await shareInvite('48213', nav)).toBe('failed');
  });
});
