/**
 * The walkthrough mounts and runs with no server at all.
 *
 * That is the requirement, not a nicety: this URL gets sent to strangers on bad
 * wifi and opened on a Tuesday in July when nobody is playing. If it needed a
 * socket, a fixture or a live scoreboard it would be broken most of the time,
 * which for a marketing asset means broken exactly when someone is judging it.
 *
 * jsdom has no socket.io server behind it and nothing here stubs one — the
 * demo simply never opens one, and these tests would throw if it did.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Demo from '../../client/src/demo/Demo.jsx';
import { isDemoRoute, DEMO_PATH } from '../../client/src/demo/index.js';
import { BEATS, PLAYERS, END_CARD, TOTAL_MS } from '../../client/src/demo/script.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/**
 * The demo's clock is `requestAnimationFrame`, which is right for smooth
 * playback and is NOT faked by vitest's default timer set — so a run has to opt
 * rAF in explicitly or the sequence never advances and every assertion below
 * quietly passes against the first frame.
 */
const useFakeClock = () => vi.useFakeTimers({
  toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'performance', 'Date'],
});

/** Drive the rAF clock by hand so a "run" takes milliseconds, not two minutes. */
const runFor = async (ms, step = 250) => {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { vi.advanceTimersByTime(step); });
  }
};

const atUrl = (search = '', pathname = DEMO_PATH) => {
  window.history.replaceState({}, '', `${pathname}${search}`);
};

describe('the route', () => {
  it('matches /how-to-play, with or without a trailing slash', () => {
    expect(isDemoRoute('/how-to-play')).toBe(true);
    expect(isDemoRoute('/how-to-play/')).toBe(true);
    expect(isDemoRoute('/How-To-Play')).toBe(true);
  });

  it('does not swallow the game', () => {
    expect(isDemoRoute('/')).toBe(false);
    expect(isDemoRoute('')).toBe(false);
    expect(isDemoRoute('/mockup.html')).toBe(false);
  });
});

describe('it mounts with no server running', () => {
  it('renders the picker first, naming no real club', () => {
    atUrl('');
    render(<Demo />);
    expect(screen.getByLabelText('Pick a game')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bNFL\b/);
  });

  it('runs start to finish without throwing', async () => {
    useFakeClock();
    atUrl('');
    const { container } = render(<Demo />);
    await runFor(TOTAL_MS + 2000, 500);
    // The end card is the last thing it holds on.
    expect(container.textContent).toContain(END_CARD.url);
  }, 60_000);

  it('shows all three players once the hands are dealt', async () => {
    useFakeClock();
    atUrl('?beat=3');
    render(<Demo />);
    await runFor(1500);
    // Three real screens, one per player.
    expect(document.querySelectorAll('.dphone')).toHaveLength(PLAYERS.length);
  });
});

describe('deep-linking a beat', () => {
  it('?beat=N opens on the shotgun without replaying the top', async () => {
    const climax = BEATS.find((b) => b.id === 'shotgun');
    useFakeClock();
    atUrl(`?beat=${climax.n}`);
    const { container } = render(<Demo />);
    await runFor(1200);
    expect(container.textContent).toContain(climax.set.declared.cardId);
  });

  it('clamps a nonsense beat rather than breaking', async () => {
    useFakeClock();
    atUrl('?beat=999');
    expect(() => render(<Demo />)).not.toThrow();
    await runFor(600);
    atUrl('?beat=-4');
    expect(() => render(<Demo />)).not.toThrow();
  });
});

describe('the two modes', () => {
  it('How to Play shows controls you can drive by hand', async () => {
    useFakeClock();
    atUrl('');
    render(<Demo />);
    await runFor(400);
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pause|play/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Beat 11' })).toBeTruthy();
  });

  it('stepping to a beat by hand shows that beat', async () => {
    useFakeClock();
    atUrl('');
    const { container } = render(<Demo />);
    await runFor(400);
    const climax = BEATS.find((b) => b.id === 'shotgun');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Beat ${climax.n}` }));
    });
    await runFor(1200);
    expect(container.textContent).toContain(climax.set.declared.cardId);
  });

  it('clean mode hides every control', async () => {
    useFakeClock();
    atUrl('?clean=1');
    const { container } = render(<Demo />);
    await runFor(400);
    expect(container.querySelector('.dctl'), 'controls are visible in clean mode').toBeNull();
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
  });

  it('clean mode still runs to the end card on its own', async () => {
    useFakeClock();
    atUrl('?clean=1');
    const { container } = render(<Demo />);
    await runFor(TOTAL_MS + 2000, 500);
    expect(container.textContent).toContain(END_CARD.url);
    // ...and holds there rather than looping back to the picker.
    await runFor(6000, 500);
    expect(container.textContent).toContain(END_CARD.url);
  }, 60_000);

  it('opens vertical when asked, for the 9:16 cut', async () => {
    useFakeClock();
    atUrl('?vertical');
    const { container } = render(<Demo />);
    await runFor(300);
    expect(container.querySelector('.demo').className).toContain('vertical');
  });
});

describe('captions', () => {
  it('can be turned off, because some cuts get their text in the editor', async () => {
    useFakeClock();
    atUrl('?beat=3');
    const { container } = render(<Demo />);
    await runFor(800);
    expect(container.querySelector('.dcap'), 'no caption to turn off').toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /captions on/i }));
    });
    expect(container.querySelector('.dcap')).toBeNull();
  });
});
