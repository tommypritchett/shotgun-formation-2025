/**
 * The curtain call.
 *
 * The most postable moment in the product, so the things that matter are
 * whether it tells the truth and whether it stays put — not whether it renders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import GameOverScreen from '../../client/src/screens/GameOverScreen.jsx';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const p = (name, drinks, shotguns = 0) => ({ id: name, name, totalDrinks: drinks, totalShotguns: shotguns });

describe('who won', () => {
  it('names a clear winner', () => {
    render(<GameOverScreen standings={[p('Ava', 9), p('Ben', 3)]} roomCode="1" />);
    // The winner's name appears twice on purpose: the headline and the list.
    expect(screen.getAllByText('Ava').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/wins/i)).toBeTruthy();
  });

  it('counts a shotgun as ten when deciding', () => {
    render(<GameOverScreen standings={[p('High', 0, 1), p('Low', 9)]} roomCode="1" />);
    expect(screen.getByText(/wins/i)).toBeTruthy();
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT declare a winner on a tie', () => {
    // Two First Down rounds give everyone the same total. That is an ordinary
    // short game, not an edge case, and this screen gets screenshotted.
    render(<GameOverScreen standings={[p('Ava', 2), p('Ben', 2), p('Cy', 2)]} roomCode="1" />);
    expect(screen.queryByText(/wins/i), 'called a winner on a three-way tie').toBeNull();
    expect(screen.getByText(/dead heat/i)).toBeTruthy();
    expect(screen.getByText(/everybody drew/i)).toBeTruthy();
  });

  it('names the tied leaders when only some of them drew', () => {
    render(<GameOverScreen standings={[p('Ava', 5), p('Ben', 5), p('Cy', 1)]} roomCode="1" />);
    expect(screen.getByText(/Ava and Ben tied/i)).toBeTruthy();
  });

  it('does not highlight one of several leaders as first', () => {
    const { container } = render(
      <GameOverScreen standings={[p('Ava', 2), p('Ben', 2)]} roomCode="1" />,
    );
    expect(container.querySelectorAll('.go-row.first'),
      'a tie still crowned somebody').toHaveLength(0);
  });

  it('renders an empty result without throwing', () => {
    expect(() => render(<GameOverScreen standings={[]} roomCode="1" />)).not.toThrow();
    expect(screen.getByText(/game over/i)).toBeTruthy();
  });
});

describe('what it shows', () => {
  const three = [p('Ava', 4, 2), p('Ben', 7), p('Cy', 0)];

  it('lists every player with both totals', () => {
    const { container } = render(<GameOverScreen standings={three} roomCode="48213" />);
    for (const name of ['Ava', 'Ben', 'Cy']) {
      expect(screen.getAllByText(name).length, `${name} is missing`).toBeGreaterThanOrEqual(1);
    }
    // Read the rows rather than hunting loose numbers — a rank and a total
    // can legitimately be the same digit.
    const rows = container.querySelectorAll('.go-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/Ava/);
    expect(rows[0].querySelector('.go-chip.s').textContent).toContain('2');
    expect(rows[0].querySelector('.go-chip.d').textContent).toContain('4');
    expect(rows[1].querySelector('.go-chip.d').textContent).toContain('7');
  });

  it('shows the room code', () => {
    render(<GameOverScreen standings={three} roomCode="48213" />);
    expect(screen.getByText(/Room 48213/i)).toBeTruthy();
  });

  it('shows a dash for somebody who drank nothing, not a zero', () => {
    const { container } = render(<GameOverScreen standings={three} roomCode="1" />);
    expect(container.querySelector('.go-chip.none')).toBeTruthy();
  });

  it('is a curtain call, not a report', () => {
    const { container } = render(<GameOverScreen standings={three} roomCode="1" />);
    const text = container.textContent;
    for (const banned of [/round history/i, /best moment/i, /quarter by quarter/i]) {
      expect(text, 'the screen grew a stats breakdown').not.toMatch(banned);
    }
  });
});

describe('it persists', () => {
  it('does not time out or auto-advance', () => {
    vi.useFakeTimers();
    const { container } = render(
      <GameOverScreen standings={[p('Ava', 4)]} roomCode="1" />,
    );
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(container.querySelector('.gameover'),
      'the screen dismissed itself while somebody was still reading it').toBeTruthy();
  });

  it('has no dismiss-on-tap scrim', () => {
    const { container } = render(<GameOverScreen standings={[p('Ava', 4)]} roomCode="1" />);
    expect(container.querySelector('.scrim')).toBeNull();
  });
});

describe('the two actions', () => {
  it('offers Play again to the Ref only', () => {
    const { rerender } = render(
      <GameOverScreen standings={[p('Ava', 4)]} roomCode="1" isHost onPlayAgain={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /play again/i })).toBeTruthy();

    rerender(<GameOverScreen standings={[p('Ava', 4)]} roomCode="1" isHost={false} />);
    expect(screen.queryByRole('button', { name: /play again/i }),
      'a player could restart the room').toBeNull();
  });

  it('gives a non-Ref a way out', () => {
    render(<GameOverScreen standings={[p('Ava', 4)]} roomCode="1" onLeave={() => {}} />);
    expect(screen.getByRole('button', { name: /back to start/i })).toBeTruthy();
  });

  it('calls back on Play again', () => {
    const onPlayAgain = vi.fn();
    render(<GameOverScreen standings={[p('Ava', 4)]} roomCode="1" isHost onPlayAgain={onPlayAgain} />);
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(onPlayAgain).toHaveBeenCalled();
  });

  it('offers Share result to EVERY player, not just the Ref', () => {
    // Every player is a potential poster; that is the whole point.
    //
    // Read from the source rather than the DOM: ShareResult renders nothing
    // until its canvas has drawn, and jsdom has no canvas — so an absent node
    // here is the fail-open path working, not the control being gated. What
    // matters is that it is NOT behind an isHost condition.
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, '..', '..', 'client/src/screens/GameOverScreen.jsx'), 'utf8');
    const at = src.indexOf('<ShareResult');
    expect(at, 'the result card is not on this screen at all').toBeGreaterThan(-1);
    // Nothing gating it on the 200 characters before it.
    expect(src.slice(Math.max(0, at - 200), at),
      'Share result is gated behind isHost').not.toMatch(/isHost\s*(&&|\?)/);
  });
});
