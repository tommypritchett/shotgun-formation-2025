/**
 * Issue 1 — the standings must show the score the server actually keeps.
 *
 * Reported from real play: "if I had 8 drinks in the standing then got 3 it
 * would update to 1 shotgun and 1 drink not 11 drinks."
 *
 * THE RULE, so it stops being re-derived:
 *
 *   - Conversion happens ONCE, server-side, on the ROUND result. Ten drinks
 *     taken in a single round become one shotgun there and nowhere else.
 *   - `totalDrinks` / `totalShotguns` on the standings are FINAL. Render raw.
 *   - `formatValue()` / `shotgunsFor()` are for CARD FACE VALUES only — a
 *     40-drink card shows as 4 shotguns. Never apply them to a running total.
 *
 * These are the first tests that render real client components. Every previous
 * session shipped the client with zero test coverage; this is the start of
 * closing that.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ScoreBoard from '../../client/src/components/ScoreBoard.jsx';
import PlayerTile from '../../client/src/components/PlayerTile.jsx';

afterEach(cleanup);

const player = (over = {}) => ({
  id: 'p1', name: 'Marcus', avatar: '', totalDrinks: 0, totalShotguns: 0, ...over,
});

/** Read the SG and DR cells out of a rendered standings row. */
const readRow = (name) => {
  const row = screen.getByText(name).closest('.prow');
  return {
    shotguns: row.querySelector('.stat.sg .v').textContent,
    drinks: row.querySelector('.stat.dk .v').textContent,
  };
};

const board = (players) => (
  <ScoreBoard
    players={players}
    tab="stand"
    onTab={() => {}}
    pulse={false}
    lastRoundCardId={null}
    lastRoundRows={[]}
    quarter={1}
    selfId="me"
  />
);

describe('standings totals', () => {
  it("shows 11 drinks as 11, not as 1 shotgun and 1 drink", () => {
    // The owner's exact case: 8 on the board, then a round of 3.
    render(board([player({ totalDrinks: 11 })]));
    expect(readRow('Marcus')).toEqual({ shotguns: '0', drinks: '11' });
  });

  it('leaves a real shotgun total alone instead of folding the drinks again', () => {
    // The server already converted a 10-drink round into this shotgun.
    render(board([player({ totalDrinks: 4, totalShotguns: 1 })]));
    expect(readRow('Marcus')).toEqual({ shotguns: '1', drinks: '4' });
  });

  it('does not invent shotguns from a large drink total', () => {
    render(board([player({ totalDrinks: 47, totalShotguns: 2 })]));
    expect(readRow('Marcus')).toEqual({ shotguns: '2', drinks: '47' });
  });

  it('ranks by the real total, not by the folded one', () => {
    render(board([
      player({ id: 'a', name: 'Ava', totalDrinks: 9, totalShotguns: 0 }),
      player({ id: 'b', name: 'Ben', totalDrinks: 11, totalShotguns: 0 }),
    ]));
    const names = [...document.querySelectorAll('.prow .nm')].map((n) => n.textContent);
    expect(names[0]).toContain('Ben');
    expect(readRow('Ben')).toEqual({ shotguns: '0', drinks: '11' });
  });

  it('renders zero as zero', () => {
    render(board([player()]));
    expect(readRow('Marcus')).toEqual({ shotguns: '0', drinks: '0' });
  });
});

describe('pour tile totals', () => {
  const tile = (over) => render(
    <PlayerTile
      player={player(over)}
      given={0}
      unit="drink"
      isShotgun={false}
      animation={undefined}
      onGive={() => {}}
    />
  );

  it('shows the same raw totals the standings do', () => {
    tile({ totalDrinks: 11, totalShotguns: 0 });
    expect(document.querySelector('.ptot').textContent).toBe('0 SG · 11 DR');
  });

  it('does not re-fold a total that already contains a shotgun', () => {
    tile({ totalDrinks: 4, totalShotguns: 1 });
    expect(document.querySelector('.ptot').textContent).toBe('1 SG · 4 DR');
  });
});

/**
 * The same bug, third site — found by auditing every use of the conversion
 * helpers rather than only the two the report named.
 *
 * `buildRoundRows` flattened a round result of {drinks:1, shotguns:1} into the
 * single number 11, and RoundLog then ran `formatValue(11)` over it, which
 * renders "1 shotgun" and SILENTLY DROPS the extra drink.
 */
import { buildRoundRows } from '../../client/src/lib/stats.js';

describe('round results rows', () => {
  const players = [{ id: 'p1', name: 'Marcus' }, { id: 'p2', name: 'Ava' }];

  it('keeps shotguns and drinks separate instead of flattening them', () => {
    const rows = buildRoundRows({ p1: { drinks: 1, shotguns: 1 } }, players);
    expect(rows[0]).toMatchObject({ name: 'Marcus', drinks: 1, shotguns: 1 });
  });

  it('reports a plain drinks round unchanged', () => {
    const rows = buildRoundRows({ p1: { drinks: 3, shotguns: 0 } }, players);
    expect(rows[0]).toMatchObject({ drinks: 3, shotguns: 0 });
  });

  it('skips players who took nothing', () => {
    const rows = buildRoundRows(
      { p1: { drinks: 0, shotguns: 0 }, p2: { drinks: 2, shotguns: 0 } },
      players
    );
    expect(rows.map((r) => r.name)).toEqual(['Ava']);
  });

  it('orders by what was actually drunk, counting a shotgun as ten', () => {
    const rows = buildRoundRows(
      { p1: { drinks: 4, shotguns: 0 }, p2: { drinks: 0, shotguns: 1 } },
      players
    );
    expect(rows.map((r) => r.name)).toEqual(['Ava', 'Marcus']);
  });
});
