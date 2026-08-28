/**
 * Item 2 — a player rejoining mid-round blanked everyone else's hand.
 *
 * Reported from real play: a 4th player rejoined mid-turn and EVERY other
 * active player's cards vanished. They could not play that round, and the
 * cards came back only when the round ended.
 *
 * That last detail is the tell. `finalizeRound` re-emits `updatePlayerHand` to
 * everyone, which is what restored them — so something was wiping the hand at
 * rejoin time and nothing put it back until the round closed.
 *
 * The cause was NOT the server. `server.js`'s "refresh every active player's
 * hand" block builds `{ standard: … || [], wild: … || [] }` explicitly and
 * guards on the stats existing; it is the most defensive emit in the file.
 *
 * The cause was a STALE CLOSURE in the client. The `updatePlayers` handler is
 * registered in a `useEffect` with `[]` deps, so the `players` it closed over
 * is frozen at the first render's value — an empty array, forever. The lookup
 * that was supposed to re-attach each player's cards therefore never matched
 * anyone, and every roster broadcast stripped the whole table's hands.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergePlayerCards } from '../../client/src/lib/players.js';

const HAND = { standard: [{ card: 'Touchdown', drinks: 3 }], wild: [{ card: 'Doink', drinks: 40 }] };

const server = (id, name, over = {}) => ({ id, name, disconnected: false, ...over });

describe('roster merge keeps hands attached', () => {
  it('re-attaches cards the client already had', () => {
    const known = [{ ...server('a', 'Ava'), cards: HAND }];
    const merged = mergePlayerCards([server('a', 'Ava')], known);
    expect(merged[0].cards).toEqual(HAND);
  });

  it("does not blank the other players when a fourth rejoins", () => {
    // The owner's exact scenario: Ava, Ben and Cy are mid-round holding cards;
    // Dee rejoins on a NEW socket id, and the server broadcasts the roster.
    const known = ['a', 'b', 'c'].map((id) => ({ ...server(id, id.toUpperCase()), cards: HAND }));
    const roster = [
      server('a', 'A'), server('b', 'B'), server('c', 'C'), server('dee-new', 'Dee'),
    ];

    const merged = mergePlayerCards(roster, known);

    for (const id of ['a', 'b', 'c']) {
      const player = merged.find((p) => p.id === id);
      expect(player.cards, `${id} lost their hand when Dee rejoined`).toEqual(HAND);
    }
    // Dee genuinely has no cards on the client yet; the server sends her hand
    // separately. She must not inherit anyone else's.
    expect(merged.find((p) => p.id === 'dee-new').cards).toBeUndefined();
  });

  it('picks up cards stashed by gameStarted before the roster existed', () => {
    const merged = mergePlayerCards([server('a', 'Ava')], [], { a: HAND });
    expect(merged[0].cards).toEqual(HAND);
  });

  it('prefers the local hand over a stale pending stash', () => {
    const older = { standard: [], wild: [] };
    const known = [{ ...server('a', 'Ava'), cards: HAND }];
    const merged = mergePlayerCards([server('a', 'Ava')], known, { a: older });
    expect(merged[0].cards).toEqual(HAND);
  });

  it('deduplicates a doubled id and keeps the copy with cards', () => {
    const roster = [server('a', 'Ava'), server('a', 'Ava')];
    const known = [{ ...server('a', 'Ava'), cards: HAND }];
    const merged = mergePlayerCards(roster, known);
    expect(merged).toHaveLength(1);
    expect(merged[0].cards).toEqual(HAND);
  });

  it('carries the disconnected flag through untouched', () => {
    const known = [{ ...server('a', 'Ava'), cards: HAND }];
    const merged = mergePlayerCards([server('a', 'Ava', { disconnected: true })], known);
    expect(merged[0].disconnected).toBe(true);
    expect(merged[0].cards).toEqual(HAND);
  });
});

/**
 * The merge above is only correct if App.js hands it the CURRENT roster. The
 * bug was never in the merge logic — it was in what got passed to it. This is
 * the tripwire for that specific regression.
 */
describe('the updatePlayers handler reads the live roster', () => {
  const APP = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
    'utf8'
  );

  it('passes playersRef.current, not the closed-over players state', () => {
    const call = APP.match(/mergePlayerCards\([\s\S]{0,120}?\)/);
    expect(call, 'App.js no longer calls mergePlayerCards — update this test').toBeTruthy();
    expect(
      call[0].includes('playersRef.current'),
      'the updatePlayers handler is registered with [] deps, so `players` there is '
        + 'frozen at the first render (an empty array). It must read playersRef.current.'
    ).toBe(true);
  });
});
