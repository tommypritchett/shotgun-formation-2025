/**
 * The returning-player announcement slot.
 *
 * Unglamorous and worth writing down: there is no email list by design, so on
 * the day the physical deck ships this banner is the only channel to the
 * people who played. It cannot be retrofitted later — by then they are gone.
 *
 * Two things it must never do: render server-supplied markup, or stand between
 * anyone and the game. Both are tested here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AnnouncementBanner from '../../client/src/components/AnnouncementBanner.jsx';
import { parseAnnouncement, isDismissed, dismiss } from '../../client/src/lib/announcement.js';

afterEach(cleanup);

/** An in-memory localStorage that can also be made to throw. */
const store = ({ broken = false } = {}) => {
  const map = new Map();
  return {
    getItem: (k) => { if (broken) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (broken) throw new Error('denied'); map.set(k, v); },
  };
};

const ok = { id: 'deck-2026', text: 'The deck ships Friday.' };

describe('what config is accepted', () => {
  it('accepts an id and text', () => {
    expect(parseAnnouncement(ok)).toEqual({ id: 'deck-2026', text: 'The deck ships Friday.', link: null });
  });

  it('keeps an http(s) link', () => {
    expect(parseAnnouncement({ ...ok, link: 'https://example.com/x' }).link)
      .toBe('https://example.com/x');
  });

  it('refuses anything it does not fully understand', () => {
    // A half-rendered banner is worse than none.
    for (const bad of [
      null, undefined, 'a string', 42, [], {},
      { id: 'x' },                       // no text
      { text: 'y' },                     // no id
      { id: '', text: 'y' },
      { id: 'x', text: '   ' },
      { id: 'x', text: 5 },
      { id: 'x'.repeat(200), text: 'y' },
      { id: 'x', text: 'y'.repeat(500) },
    ]) {
      expect(parseAnnouncement(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('drops a link that is not http(s)', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,<b>x', 'not a url', '']) {
      expect(parseAnnouncement({ ...ok, link }).link, `kept ${link}`).toBeNull();
    }
  });
});

describe('it renders text, never markup', () => {
  it('shows a script tag as literal text', () => {
    const nasty = '<script>alert(1)</script> and <b>bold</b>';
    const parsed = parseAnnouncement({ id: 'x', text: nasty });
    const { container } = render(<AnnouncementBanner announcement={parsed} />);
    expect(container.querySelector('script'), 'a script element was created').toBeNull();
    expect(container.querySelector('b'), 'markup was interpreted').toBeNull();
    expect(screen.getByText(nasty), 'the text was not shown literally').toBeTruthy();
  });

  it('renders nothing at all when there is no announcement', () => {
    const { container } = render(<AnnouncementBanner announcement={null} />);
    expect(container.innerHTML, 'left a gap in the layout').toBe('');
  });
});

describe('dismissal is per announcement id', () => {
  it('stays dismissed for the same id', () => {
    const s = store();
    expect(isDismissed('deck-2026', s)).toBe(false);
    dismiss('deck-2026', s);
    expect(isDismissed('deck-2026', s)).toBe(true);
  });

  it('shows again for a NEW id', () => {
    const s = store();
    dismiss('deck-2026', s);
    expect(isDismissed('spring-2027', s), 'a new announcement stayed hidden').toBe(false);
  });

  it('shows every time when storage is unavailable', () => {
    // The harmless failure, and the right one: this may never stand between
    // anyone and the game.
    const broken = store({ broken: true });
    expect(isDismissed('deck-2026', broken)).toBe(false);
    expect(() => dismiss('deck-2026', broken)).not.toThrow();
    expect(isDismissed('deck-2026', null)).toBe(false);
  });

  it('calls back when dismissed', () => {
    const onDismiss = vi.fn();
    render(<AnnouncementBanner announcement={parseAnnouncement(ok)} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('the server side', () => {
  const serverSource = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return fs.readFileSync(path.resolve(here, '..', '..', 'server.js'), 'utf8');
  };

  it('reads config from the environment, not a deploy', () => {
    expect(serverSource()).toContain('ANNOUNCEMENT_JSON');
  });

  it('never lets bad config take the server down', () => {
    // A typo in an env var killing the game would be far worse than a missing
    // banner. Verified live too: a malformed value logs and the server boots.
    const src = serverSource();
    const at = src.indexOf('const ANNOUNCEMENT = (() => {');
    expect(at, 'the announcement config block is gone').toBeGreaterThan(-1);
    const block = src.slice(at, at + 1400);
    expect(block, 'config parsing is not guarded').toMatch(/try\s*\{/);
    expect(block, 'a parse failure is not swallowed into null').toMatch(/return null/);
  });

  it('only emits when there is something to say', () => {
    expect(serverSource()).toMatch(/if \(ANNOUNCEMENT\) socket\.emit\('announcement'/);
  });
});
