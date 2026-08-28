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

describe('ordering the list', () => {
  it('puts ranked games first, best rank first', () => {
    const out = sortGames([
      game({ id: 'unranked' }),
      game({ id: 'nine', home: { abbreviation: 'H', rank: 9 }, away: { abbreviation: 'A' } }),
      game({ id: 'two', home: { abbreviation: 'H', rank: 2 }, away: { abbreviation: 'A' } }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['two', 'nine', 'unranked']);
  });

  it('puts a game you can still watch above one that has finished', () => {
    const out = sortGames([
      game({ id: 'done', state: 'post' }),
      game({ id: 'live', state: 'in' }),
      game({ id: 'later', state: 'pre' }),
    ]);
    expect(out.map((g) => g.id)).toEqual(['live', 'later', 'done']);
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

  it('says which cards a feed can never call', () => {
    render(<GamePicker league="nfl" games={games} />);
    expect(screen.getByText(/Doink and Record Broken are always called by the Ref/)).toBeTruthy();
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
