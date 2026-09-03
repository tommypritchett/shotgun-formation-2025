/**
 * The live-game UI: the score strip and the "would have called" feed.
 *
 * Part A ships with the same guarantee as Session 15 — nothing declares a card
 * — so the feed IS the deliverable. It is how the pacing gets judged by
 * watching a replay rather than from a table of numbers, which means it has to
 * read like the game would feel.
 *
 * The other thing pinned here is what a room with no game attached sees:
 * nothing at all. This whole feature is additive or it is a regression.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LiveScore from '../../client/src/components/LiveScore.jsx';
import CallFeed from '../../client/src/components/CallFeed.jsx';
import GameScreen from '../../client/src/screens/GameScreen.jsx';

afterEach(cleanup);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const watching = (over = {}) => ({
  league: 'nfl', gameId: '1', home: 'BUF', away: 'KC',
  homeScore: 14, awayScore: 10, period: 2, clock: '3:20', state: 'in',
  error: null, ended: false, ...over,
});

const entry = (over = {}) => ({
  key: 'k1', cardId: 'Touchdown', reason: 'Rushing Touchdown (6)', at: '20:15:03',
  suggestion: false, ...over,
});

describe('the live score strip', () => {
  it('shows the teams, the score and the clock', () => {
    render(<LiveScore watching={watching()} />);
    expect(screen.getByText(/KC/)).toBeTruthy();
    expect(screen.getByText(/BUF/)).toBeTruthy();
    // The score is one element with a separator inside it, so read it whole.
    expect(document.querySelector('.ls-score').textContent).toMatch(/10.*14/);
    expect(screen.getByText('Q2 3:20')).toBeTruthy();
  });

  it('renders nothing at all when no game is attached', () => {
    const { container } = render(<LiveScore watching={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('says a feed has died rather than freezing on a stale score', () => {
    render(<LiveScore watching={watching({ error: 'boom' })} />);
    expect(screen.getByText('Feed unavailable')).toBeTruthy();
    // The old score must not sit there looking live.
    expect(document.querySelector('.ls-score')).toBeNull();
  });

  it('says when the feed has ended', () => {
    render(<LiveScore watching={watching({ ended: true })} />);
    expect(screen.getByText('Feed ended')).toBeTruthy();
  });

  it('handles a game that has not kicked off', () => {
    render(<LiveScore watching={watching({ state: 'pre', detail: '4:25 PM', period: null, clock: null })} />);
    expect(screen.getByText('4:25 PM')).toBeTruthy();
    expect(document.querySelector('.ls-score')).toBeNull();   // no score before kickoff
  });

  it('shows Final when the game is over', () => {
    render(<LiveScore watching={watching({ state: 'post' })} />);
    expect(screen.getByText('Final')).toBeTruthy();
  });

  it('offers the Ref one tap to change game, and nobody else', () => {
    const onDetach = vi.fn();
    const { rerender } = render(<LiveScore watching={watching()} onDetach={onDetach} canDetach />);
    fireEvent.click(screen.getByRole('button', { name: /change game/i }));
    expect(onDetach).toHaveBeenCalled();

    rerender(<LiveScore watching={watching()} onDetach={onDetach} canDetach={false} />);
    expect(screen.queryByRole('button', { name: /change game/i })).toBeNull();
  });
});

describe('the would-have-called feed', () => {
  it('counts what it has seen without being opened', () => {
    render(<CallFeed entries={[entry(), entry({ key: 'k2' })]} />);
    expect(screen.getByText('2')).toBeTruthy();
    // Collapsed by default: it must not eat the board.
    expect(screen.queryByText(/Rushing Touchdown/)).toBeNull();
  });

  it('shows the card, the time and one line of why', () => {
    render(<CallFeed entries={[entry()]} open />);
    expect(screen.getByText('Touchdown')).toBeTruthy();
    expect(screen.getByText('20:15:03')).toBeTruthy();
    expect(screen.getByText('Rushing Touchdown (6)')).toBeTruthy();
  });

  it('marks a suggestion as a suggestion, not a call', () => {
    // A suggestion is a question; a call is an announcement. They must not
    // read the same.
    render(<CallFeed entries={[entry({ cardId: '3 n Out', suggestion: true })]} open />);
    expect(screen.getByText('suggested')).toBeTruthy();
  });

  it('keeps the newest entry first, so the feed reads as it happens', () => {
    render(<CallFeed open entries={[
      entry({ key: 'new', cardId: 'Touchdown', at: '20:15:03' }),
      entry({ key: 'old', cardId: 'Sacks', at: '20:14:01' }),
    ]} />);
    const rows = document.querySelectorAll('.cf-row .cf-card');
    expect(rows[0].textContent).toBe('Touchdown');
  });

  it('says so when nothing has happened yet', () => {
    render(<CallFeed entries={[]} open />);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it('opens and closes on a tap', () => {
    const onToggle = vi.fn();
    render(<CallFeed entries={[entry()]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Called by the feed'));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('a room with no game attached', () => {
  const base = {
    quarter: 1, roomCode: '12345', players: [], boardTab: 'stand',
    lastRoundRows: [], hand: { standard: [], wild: [] }, selfId: 'me',
  };

  it('renders neither the score strip nor the feed', () => {
    const { container } = render(<GameScreen {...base} />);
    expect(container.querySelector('.livescore')).toBeNull();
    expect(container.querySelector('.callfeed')).toBeNull();
  });

  it('offers the Ref a way to start watching, and nobody else', () => {
    const { rerender, container } = render(
      <GameScreen {...base} isHost onWatchGame={() => {}} />
    );
    expect(screen.getByText('Select a game')).toBeTruthy();

    rerender(<GameScreen {...base} isHost={false} />);
    expect(container.querySelector('.watchbtn')).toBeNull();
  });

  /**
   * Session 18. The control was an 11px dim-grey pill and the owner could not
   * find it on his own phone at a bar. It is the Ref's way into the whole
   * feature, so it has to read as a real button, not a hint.
   */
  it('makes selecting a game a primary action, not a dim hint', () => {
    const { container } = render(
      <GameScreen {...base} isHost onWatchGame={() => {}} />
    );
    const btn = container.querySelector('.watchbtn');
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('primary');
    expect(btn.textContent).toContain('Select a game');
  });

  it('offers a way to change game once one is attached, not a bare Stop', () => {
    const { container } = render(
      <GameScreen {...base} isHost onWatchGame={() => {}} watching={watching()}
        onDetachGame={() => {}} />
    );
    const btn = container.querySelector('.ls-detach');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Change game');
  });

  it('hides the watch button once a game is attached', () => {
    const { container } = render(
      <GameScreen {...base} isHost onWatchGame={() => {}} watching={watching()} />
    );
    expect(container.querySelector('.watchbtn')).toBeNull();
    expect(container.querySelector('.livescore')).toBeTruthy();
  });
});

describe('the primary select-a-game button is actually styled', () => {
  const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');

  it('has a rule that makes it legible on a phone in a dark bar', () => {
    expect(css).toMatch(/\.watchbtn\.primary\s*\{/);
  });
});

describe('the layout does not grow', () => {
  // The game screen fits 390x844 with six players and no vertical scroll, and
  // that layout is what replaced `document.body.style.zoom = "70%"`. Both new
  // blocks are single-line and internally scrolling for exactly that reason.
  const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');

  it('keeps the score strip to one fixed-height line', () => {
    expect(css).toMatch(/\.livescore\{[^}]*white-space:nowrap/);
    expect(css).toMatch(/\.livescore\{[^}]*min-height:22px/);
  });

  it('scrolls the call feed internally rather than pushing the hand off', () => {
    expect(css).toMatch(/\.callfeed \.cf-list\{[^}]*overflow-y:auto/);
    expect(css).toMatch(/\.callfeed \.cf-list\{[^}]*max-height/);
  });

  it('trims rather than stacks at 360px', () => {
    const narrow = css.slice(css.indexOf('@media (max-width:380px)'));
    expect(narrow).toMatch(/\.livescore\{/);
    expect(narrow).toMatch(/min-height:20px/);
  });
});

describe('the score survives the round', () => {
  // The assigner covers the whole screen for the length of a round, and a round
  // fires precisely BECAUSE something just happened — so losing the score for
  // those twenty-one seconds loses it exactly when it is wanted.
  const card = { id: 'Touchdown', label: 'Touchdown', icon: 'td', deck: 'standard', drinks: 6 };

  it('shows the score and clock inside the assigner', async () => {
    const { default: DrinkAssigner } = await import('../../client/src/components/DrinkAssigner.jsx');
    render(<DrinkAssigner
      card={card} copies={1} source="The game called it" secondsLeft={20} fraction={0.9}
      tier="amber" targets={[]} watching={watching()}
    />);
    const line = document.querySelector('.a-score');
    expect(line, 'no score inside the assigner').toBeTruthy();
    expect(line.textContent).toMatch(/KC/);
    expect(line.textContent).toMatch(/BUF/);
    expect(line.textContent).toMatch(/Q2/);
    expect(line.textContent).toMatch(/3:20/);
  });

  it('shows nothing when no game is attached', async () => {
    const { default: DrinkAssigner } = await import('../../client/src/components/DrinkAssigner.jsx');
    render(<DrinkAssigner
      card={card} copies={1} source="The Ref declared" secondsLeft={20} fraction={0.9}
      tier="amber" targets={[]} watching={null}
    />);
    expect(document.querySelector('.a-score')).toBeNull();
  });
});
