/**
 * Item 5 — Round Results should not be where the board lives.
 *
 * It flips there when a round lands (Session 7) because that is the moment
 * everyone looks down. Twenty seconds later, with nothing happening, the
 * standings are what people actually want to see.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_IDLE_REVERT_MS, shouldRevertToStandings } from '../../client/src/lib/board.js';

const idle = (over = {}) => ({
  boardTab: 'last', boardPinned: false, declaredCard: null, timeRemaining: 0, ...over,
});

describe('falling back to Standings', () => {
  it('reverts when Round Results has been up with nothing happening', () => {
    expect(shouldRevertToStandings(idle())).toBe(true);
  });

  it('does nothing when Standings is already showing', () => {
    expect(shouldRevertToStandings(idle({ boardTab: 'stand' }))).toBe(false);
  });

  it('leaves it alone if the player opened the tab themselves', () => {
    // Someone deliberately opened Round Results to argue about a pour.
    // Yanking it away mid-argument is worse than leaving it up.
    expect(shouldRevertToStandings(idle({ boardPinned: true }))).toBe(false);
  });

  it('does not revert while a card is on the table', () => {
    expect(shouldRevertToStandings(idle({ declaredCard: 'Touchdown' }))).toBe(false);
  });

  it('does not revert while a round timer is still running', () => {
    expect(shouldRevertToStandings(idle({ timeRemaining: 7 }))).toBe(false);
  });

  it('tolerates being called with nothing', () => {
    expect(shouldRevertToStandings()).toBe(false);
    expect(shouldRevertToStandings({})).toBe(false);
  });

  it('waits about twenty seconds', () => {
    expect(BOARD_IDLE_REVERT_MS).toBe(20_000);
  });
});

describe('the board effect uses the rule', () => {
  const APP = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
    'utf8'
  );

  it('delegates rather than re-deriving the conditions inline', () => {
    expect(APP).toMatch(/shouldRevertToStandings\(\{/);
  });

  it('pins the board when a tab is tapped, so the timer backs off', () => {
    expect(APP).toMatch(/onBoardTab=\{[^}]*setBoardPinned\(true\)/);
  });

  it('unpins on the automatic flip, so the next idle period can revert', () => {
    expect(APP).toMatch(/setBoardPinned\(false\)/);
  });
});
