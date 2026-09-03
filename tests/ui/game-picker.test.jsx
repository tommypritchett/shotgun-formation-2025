/**
 * The game picker.
 *
 * The two leagues are genuinely different problems: an NFL Sunday is thirteen
 * games and a flat list is enough; a college Saturday is fifty to a hundred and
 * more, which is unusable on a phone without ranking, filtering and search.
 *
 * The other thing pinned here is what the picker must NOT grow: a delay
 * setting. The point of the feature is that the Ref configures nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GamePicker from '../../client/src/components/GamePicker.jsx';
import { prepareGames, sortGames, matchesSearch, statusLine } from '../../client/src/lib/game-list.js';

afterEach(cleanup);

const game = (over = {}) => ({
  id: '1', league: 'college-football', name: 'A @ B',
  home: { abbreviation: 'HOME', displayName: 'Home Team', score: 0, rank: null },
  away: { abbreviation: 'AWAY', displayName: 'Away Team', score: 0, rank: null },
  period: null, clock: null, state: 'pre', started: false, completed: false, detail: '1:00 PM',
  ...over,
});

/**
 * Session 18. The old order was rank-first, which is the wrong question for
 * somebody standing at a bar. They are picking the game that is ON, not the
 * best game of the week. State is now the primary sort and rank is a tiebreak
 * inside it.
 */
describe('ordering the list', () => {
  it('puts what is on now above what has not started, and Final last', () => {
    const out = sortGames([
      game({ id: 'done', state: 'post' }),
      game({ id: 'later', state: 'pre', date: '2026-09-03T23:00Z' }),
      game({ id: 'live', state: 'in', period: 2, clock: '7:00' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['live', 'later', 'done']);
  });

  it('does NOT let a ranked game outrank one that is actually in progress', () => {
    const out = sortGames([
      game({ id: 'ranked-pre', state: 'pre', date: '2026-09-04T03:00Z',
        home: { abbreviation: 'H', rank: 1 }, away: { abbreviation: 'A' } }),
      game({ id: 'unranked-live', state: 'in', period: 3, clock: '5:00' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['unranked-live', 'ranked-pre']);
  });

  it('orders in-progress games by how far along they are, nearest the end first', () => {
    const out = sortGames([
      game({ id: 'q1', state: 'in', period: 1, clock: '12:00' }),
      game({ id: 'q4', state: 'in', period: 4, clock: '2:00' }),
      game({ id: 'q2', state: 'in', period: 2, clock: '8:00' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['q4', 'q2', 'q1']);
  });

  it('within one quarter, the game with less clock left comes first', () => {
    const out = sortGames([
      game({ id: 'lots', state: 'in', period: 2, clock: '14:30' }),
      game({ id: 'little', state: 'in', period: 2, clock: '0:45' }),
      game({ id: 'mid', state: 'in', period: 2, clock: '7:10' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['little', 'mid', 'lots']);
  });

  it('orders not-yet-started games by kickoff, nearest first', () => {
    const out = sortGames([
      game({ id: 'nine', state: 'pre', date: '2026-09-04T01:00Z' }),
      game({ id: 'six', state: 'pre', date: '2026-09-03T22:00Z' }),
      game({ id: 'seven', state: 'pre', date: '2026-09-03T23:00Z' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['six', 'seven', 'nine']);
  });

  it('uses rank only as a tiebreak inside a group, not across groups', () => {
    const out = sortGames([
      game({ id: 'unranked', state: 'pre', date: '2026-09-03T22:00Z' }),
      game({ id: 'nine', state: 'pre', date: '2026-09-03T22:00Z',
        home: { abbreviation: 'H', rank: 9 }, away: { abbreviation: 'A' } }),
      game({ id: 'two', state: 'pre', date: '2026-09-03T22:00Z',
        home: { abbreviation: 'H', rank: 2 }, away: { abbreviation: 'A' } }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['two', 'nine', 'unranked']);
  });

  it('does not fall over when a game has no date, clock or period at all', () => {
    const out = sortGames([
      game({ id: 'b', state: 'pre', date: null, detail: null, name: 'B' }),
      game({ id: 'a', state: 'pre', date: null, detail: null, name: 'A' }),
      game({ id: 'live', state: 'in', period: null, clock: null }),
    ]);
    expect(out[0].id).toBe('live');
    expect(out.map((g) => g.id).slice(1)).toEqual(['a', 'b']);
  });

  it('is stable between polls, so rows do not jump under a thumb', () => {
    const games = [game({ id: 'b', name: 'B' }), game({ id: 'a', name: 'A' })];
    expect(sortGames(games).map((g) => g.id)).toEqual(sortGames([...games].reverse()).map((g) => g.id));
  });
});

describe('finding one game among a hundred', () => {
  it('matches either team by code or by name', () => {
    const g = game({
      home: { abbreviation: 'OSU', displayName: 'Ohio State Buckeyes' },
      away: { abbreviation: 'PSU', displayName: 'Penn State Nittany Lions' },
    });
    expect(matchesSearch(g, 'osu')).toBe(true);
    expect(matchesSearch(g, 'nittany')).toBe(true);
    expect(matchesSearch(g, '')).toBe(true);
    expect(matchesSearch(g, 'alabama')).toBe(false);
  });

  it('shows everything rather than an empty screen when nothing is ranked', () => {
    // An empty picker reads as broken, so the ranked filter falls back.
    const games = [game({ id: '1' }), game({ id: '2' })];
    const out = prepareGames(games, { league: 'college-football', onlyRanked: true });
    expect(out).toHaveLength(2);
  });

  it('does not apply the college view to the NFL', () => {
    const games = [game({ id: '1', league: 'nfl' })];
    expect(prepareGames(games, { league: 'nfl', onlyRanked: true })).toHaveLength(1);
  });

  it('ignores rows with no id rather than rendering a dead one', () => {
    expect(prepareGames([game(), { noId: true }, null], { league: 'nfl' })).toHaveLength(1);
  });
});

describe('the status line', () => {
  it('reads the way a football fan expects', () => {
    expect(statusLine(game({ state: 'in', period: 2, clock: '3:20' }))).toBe('Q2 3:20');
    expect(statusLine(game({ state: 'post' }))).toBe('Final');
    expect(statusLine(game({ state: 'pre', detail: '4:25 PM' }))).toBe('4:25 PM');
  });
});

/**
 * Session 18. "Ranked only" defaulted to ON, which hid three quarters of the
 * slate behind a checkbox nobody knew to look at — and while the fetch was
 * also broken it made the picker look like it had no unranked games at all.
 * The whole slate is the honest default; ranked is the narrowing option.
 */
describe('the default view', () => {
  it('defaults the ranked filter to OFF, so the whole slate shows', () => {
    const games = [
      game({ id: 'ranked', home: { abbreviation: 'H', rank: 3 }, away: { abbreviation: 'A' } }),
      game({ id: 'plain', home: { abbreviation: 'C' }, away: { abbreviation: 'D' } }),
    ];
    const { container } = render(<GamePicker league="college-football" games={games} />);
    expect(container.querySelectorAll('.gamerow')).toHaveLength(2);
  });

  it('leaves the ranked checkbox unticked until somebody ticks it', () => {
    render(<GamePicker league="college-football" games={[game()]} />);
    expect(screen.getByLabelText(/ranked only/i).checked).toBe(false);
  });

  it('still narrows to ranked when the option is turned on', () => {
    const games = [
      game({ id: 'ranked', home: { abbreviation: 'H', rank: 3 }, away: { abbreviation: 'A' } }),
      game({ id: 'plain', home: { abbreviation: 'C' }, away: { abbreviation: 'D' } }),
    ];
    const { container } = render(
      <GamePicker league="college-football" games={games} onlyRanked />
    );
    expect(container.querySelectorAll('.gamerow')).toHaveLength(1);
  });
});

describe('the picker on screen', () => {
  const games = [
    game({ id: 'live', state: 'in', started: true, period: 3, clock: '5:00',
      home: { abbreviation: 'UGA', displayName: 'Georgia', score: 21, rank: 2 },
      away: { abbreviation: 'FLA', displayName: 'Florida', score: 7, rank: null } }),
    game({ id: 'other', home: { abbreviation: 'RICE', displayName: 'Rice' },
      away: { abbreviation: 'UTSA', displayName: 'UTSA' } }),
  ];

  it('picks a game in one tap', () => {
    const onPick = vi.fn();
    render(<GamePicker league="nfl" games={games} onPick={onPick} />);
    fireEvent.click(screen.getByText(/FLA @ UGA/));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'live' }));
  });

  it('offers search and a ranked filter for college, and neither for the NFL', () => {
    const { rerender } = render(<GamePicker league="nfl" games={games} />);
    expect(screen.queryByLabelText('Search teams')).toBeNull();

    rerender(<GamePicker league="college-football" games={games} />);
    expect(screen.getByLabelText('Search teams')).toBeTruthy();
  });

  it('reports what was typed rather than swallowing it', () => {
    const onQuery = vi.fn();
    render(<GamePicker league="college-football" games={games} onQuery={onQuery} />);
    fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'georgia' } });
    expect(onQuery).toHaveBeenCalledWith('georgia');
  });

  it('narrows the list to what was typed', () => {
    render(<GamePicker league="college-football" games={games} query="georgia" onlyRanked={false} />);
    expect(screen.queryByText(/UTSA @ RICE/)).toBeNull();
    expect(screen.getByText(/FLA @ UGA/)).toBeTruthy();
  });

  it('shows the unranked games once the filter is off', () => {
    render(<GamePicker league="college-football" games={games} onlyRanked={false} />);
    expect(screen.getByText(/UTSA @ RICE/)).toBeTruthy();
  });

  it('names every card a feed can never call', () => {
    // Naming them beats leaving cards that silently never appear. Fake Punt/FG
    // joined the list in Session 17: the word "fake" is in 0 of 111 real games.
    render(<GamePicker league="nfl" games={games} />);
    const note = screen.getByText(/always called by the Ref/);
    for (const card of ['Doink', 'Record Broken', 'Fake Punt/FG']) {
      expect(note.textContent, `${card} is Ref-only but the UI does not say so`).toContain(card);
    }
  });

  it('shows an error without blanking the screen', () => {
    render(<GamePicker league="nfl" games={[]} error="Could not load games right now." />);
    expect(screen.getByText(/Could not load games/)).toBeTruthy();
  });

  it('has no delay or offset setting anywhere in it', () => {
    // The owner ruled this out explicitly: a delay the Ref has to configure
    // hands back the work the feature exists to remove.
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..',
        'client', 'src', 'components', 'GamePicker.jsx'), 'utf8'
    );
    // Code only. The file's own comment explains why there is no delay
    // setting, and prose about the absence of a thing is not the thing.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/delay|offset|calibrat/i);
    render(<GamePicker league="nfl" games={games} />);
    expect(screen.queryByText(/delay/i)).toBeNull();
  });
});
