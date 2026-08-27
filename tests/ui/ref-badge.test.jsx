/**
 * Item 3 — everyone at the table can see who the Ref is.
 *
 * The board has always been able to draw a REF badge; the row data never let
 * it. App.js built each row with
 *
 *     isRef: player.id === socket.id && isHost
 *
 * `isHost` is a boolean about YOU, and `player.id === socket.id` is only ever
 * true on your own row — so the badge could appear on nobody else's, ever. The
 * Ref knew, and only because they already knew. After a handoff or a rejoin
 * even they could be wrong, because `isHost` was separate state that no
 * payload confirmed.
 *
 * The fix is one id from the server (`hostId`, now on every `gameStarted`),
 * with `isHost` DERIVED from it. These tests pin both halves: the badge lands
 * where the data says, and the data comes from the id rather than from a
 * second boolean that can drift.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import ScoreBoard from '../../client/src/components/ScoreBoard.jsx';

afterEach(cleanup);

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
  'utf8'
);

const SELF = 'me';

/** The four rows a real table produces, with the whistle on whoever you say. */
const table = (refId) =>
  [
    { id: SELF, name: 'Ava' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cy' },
    { id: 'd', name: 'Dee' },
  ].map((p) => ({
    ...p,
    avatar: '',
    totalDrinks: 0,
    totalShotguns: 0,
    isSelf: p.id === SELF,
    isRef: p.id === refId,
  }));

const board = (players) => (
  <ScoreBoard
    players={players}
    tab="stand"
    onTab={() => {}}
    pulse={false}
    lastRoundCardId={null}
    lastRoundRows={[]}
    quarter={1}
    selfId={SELF}
  />
);

/** The name on whichever row carries the badge, or null. */
const whoHasTheBadge = () => {
  const badges = screen.queryAllByText('REF');
  if (badges.length === 0) return null;
  expect(badges, 'more than one row claims the whistle').toHaveLength(1);
  return badges[0].closest('.prow').querySelector('.nm, .name')?.textContent
    ?? badges[0].closest('.prow').textContent;
};

describe('the REF badge on the standings', () => {
  it("draws it on another player's row, which is the whole point", () => {
    render(board(table('c')));
    expect(whoHasTheBadge()).toMatch(/Cy/);
  });

  it('draws it on your own row when the whistle is yours', () => {
    render(board(table(SELF)));
    expect(whoHasTheBadge()).toMatch(/Ava/);
  });

  it('moves with a handoff rather than staying put', () => {
    const { rerender } = render(board(table(SELF)));
    expect(whoHasTheBadge()).toMatch(/Ava/);

    rerender(board(table('d')));       // server said newHost: Dee
    expect(whoHasTheBadge()).toMatch(/Dee/);
  });

  it('shows nothing rather than guessing when no host is known yet', () => {
    render(board(table(null)));
    expect(whoHasTheBadge()).toBeNull();
  });
});

describe('where the row data comes from', () => {
  it('marks the Ref by host id, not by "is it me and am I host"', () => {
    expect(
      APP,
      'isRef is still ANDed with socket.id, so the badge can only land on your '
        + 'own row and nobody else can see who the Ref is'
    ).not.toMatch(/isRef:\s*player\.id === socket\.id/);
    expect(APP).toMatch(/isRef:\s*player\.id === hostId/);
  });

  it('learns the host id from the gameStarted payload', () => {
    // A player who joins mid-game, or reconnects, gets no `newHost` — this
    // payload is the only place they can learn who has the whistle.
    const at = APP.indexOf("socket.on('gameStarted'");
    expect(at, 'no gameStarted handler').toBeGreaterThan(-1);
    expect(APP.slice(at, at + 500)).toMatch(/hostId/);
  });
});
