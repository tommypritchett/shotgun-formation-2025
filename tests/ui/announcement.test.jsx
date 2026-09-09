/**
 * The whistle-moved popup, and every other native dialog in the client.
 *
 * `newHost` fired `alert(message)`. The owner wants the popup — everyone must
 * register that the whistle moved — and that part is kept. The MECHANISM was
 * the bug: `alert()` halts the JavaScript main thread, so while it sits there
 * the round countdown stops ticking, the socket stops processing incoming
 * events, and a player slow to dismiss it can miss an entire round. On iOS
 * Safari that is a frozen game, not a slow one.
 *
 * So the property under test is not "a modal appears". It is: **with the modal
 * open, the game underneath keeps running.** That is exactly what a native
 * dialog cannot do and a React sheet can.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Announcement from '../../client/src/components/Announcement.jsx';

afterEach(cleanup);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the game keeps running underneath', () => {
  it('lets a countdown keep ticking while the modal is open', () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const timer = setInterval(() => { ticks += 1; }, 1000);

      render(<Announcement open title="Whistle" body="Ben is now the Ref." onDismiss={() => {}} />);
      expect(screen.getByText(/Ben is now the Ref/)).toBeTruthy();

      act(() => { vi.advanceTimersByTime(5000); });
      clearInterval(timer);

      expect(ticks, 'the countdown froze while the modal was open — this is the alert() bug')
        .toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still processes an incoming round event while the modal is open', () => {
    const handlers = {};
    const socket = {
      on: (e, fn) => { handlers[e] = fn; },
      fire: (e, payload) => handlers[e] && handlers[e](payload),
    };
    const seen = [];
    socket.on('declaredCard', (card) => seen.push(card));

    render(<Announcement open title="Whistle" body="Ben is now the Ref." onDismiss={() => {}} />);
    socket.fire('declaredCard', 'Touchdown');

    expect(seen, 'a round event was dropped while the modal was open')
      .toEqual(['Touchdown']);
  });
});

describe('it forces an acknowledgement', () => {
  it('needs a tap — there is no auto-close', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(<Announcement open title="Whistle" body="Ben is the Ref." onDismiss={onDismiss} />);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(onDismiss, 'the popup closed itself — nobody had to see it').not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot be dismissed by tapping outside it', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Announcement open title="Whistle" body="Ben is the Ref." onDismiss={onDismiss} />
    );
    const scrim = container.querySelector('.scrim');
    expect(scrim, 'no scrim rendered').toBeTruthy();
    fireEvent.click(scrim);
    expect(onDismiss, 'tapping outside dismissed it').not.toHaveBeenCalled();
  });

  it('closes on the button, and only on the button', () => {
    const onDismiss = vi.fn();
    render(<Announcement open title="Whistle" body="Ben is the Ref." onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(
      <Announcement open={false} title="Whistle" body="x" onDismiss={() => {}} />
    );
    expect(container.querySelector('.sheet')).toBeNull();
  });

  it('is a sheet that has actually slid in', () => {
    // `.sheet` is parked at translateY(110%) until `.on` is added. A popup
    // nobody can see is worse than the alert it replaced.
    const { container } = render(
      <Announcement open title="Whistle" body="x" onDismiss={() => {}} />
    );
    expect(container.querySelector('.sheet').className.split(/\s+/)).toContain('on');
  });
});

describe('no native dialogs remain', () => {
  /**
   * The real guarantee. A single surviving `alert()` reintroduces the exact
   * freeze this replaced, and it would not show up in any render test.
   */
  const clientSource = () => {
    const dir = path.join(ROOT, 'client', 'src');
    const files = [];
    const walk = (at) => {
      for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(dir);
    return files.map((f) => [f, fs.readFileSync(f, 'utf8')]);
  };

  it('has no alert(), confirm() or prompt() anywhere in client/src', () => {
    const offenders = [];
    for (const [file, src] of clientSource()) {
      src.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        // Skip comments. These files EXPLAIN why alert() was removed, so the
        // word appears in prose all over them — a scanner that cannot tell
        // prose from code fails on its own documentation.
        if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return;
        const code = line
          .replace(/\/\/.*$/, '')          // trailing line comment
          .replace(/`[^`]*`/g, '``')       // template literals
          .replace(/'[^']*'/g, "''")       // string literals
          .replace(/"[^"]*"/g, '""');
        if (/(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(code)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${trimmed}`);
        }
      });
    }
    expect(offenders, `native dialogs block the main thread:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the scanner would actually catch one', () => {
    // A scanner that skips comments could be skipping everything. This pins
    // that it still fires on real code, so the test above means something.
    const detects = (line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return false;
      const code = line
        .replace(/\/\/.*$/, '')
        .replace(/`[^`]*`/g, '``')
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""');
      return /(^|[^.\w])(window\.)?(alert|confirm|prompt)\s*\(/.test(code);
    };
    expect(detects('  alert(message);'), 'a bare alert slipped past').toBe(true);
    expect(detects('  window.alert(x);'), 'window.alert slipped past').toBe(true);
    expect(detects('  if (confirm(\'sure?\')) go();'), 'confirm slipped past').toBe(true);
    expect(detects('  alert(message);  // notify'), 'a commented-tail alert slipped past').toBe(true);
    // ...and does not fire on prose or on unrelated names.
    expect(detects(' * this replaces alert() everywhere'), 'prose was flagged').toBe(false);
    expect(detects('  this.alertShown = true;'), 'an unrelated name was flagged').toBe(false);
    expect(detects('  announce(\'Hold on\', message);'), 'the replacement was flagged').toBe(false);
  });
});
