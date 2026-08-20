/**
 * Item 3 — a player who refreshes mid-round still could not pour.
 *
 * Phase 7a made the SERVER replay the prompt correctly, and the socket tests
 * proved it on the wire. It still failed on a real phone, because the client
 * threw the replay away.
 *
 * The client's `distributeDrinks` handler only accepted the payload if the
 * player's CURRENT HAND still contained the declared card:
 *
 *     if (player && player.cards && player.cards.standard &&
 *         player.cards.standard.some(card => card.card === cardType))
 *
 * That can never be true after a reconnect. The server removes a played card
 * and deals a replacement the moment it is played, so the hand no longer holds
 * it — by design. Worse, the `else` branch then CLEARED the distribution
 * state, and on a fresh page load `playersRef.current` is empty anyway, since
 * the replay arrives before `gameStarted` has populated the roster.
 *
 * The server only sends this event to players who owe something. The client's
 * job is to read it, not to re-adjudicate it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPourPrompt } from '../../client/src/lib/pour.js';

describe('reading the pour prompt', () => {
  it('reads a Standard prompt without consulting the hand', () => {
    expect(readPourPrompt({ cardType: 'Touchdown', drinkCount: 6, shotguns: 0 }))
      .toMatchObject({ card: 'Touchdown', drinks: 6, shotguns: 0, isWild: false });
  });

  it('reads a Wild prompt from wildcardtype', () => {
    expect(readPourPrompt({ wildcardtype: 'Doink', drinkCount: 0, shotguns: 4 }))
      .toMatchObject({ card: 'Doink', drinks: 0, shotguns: 4, isWild: true });
  });

  it('handles a mixed prompt', () => {
    const p = readPourPrompt({ cardType: 'Turnover', drinkCount: 2, shotguns: 1 });
    expect(p).toMatchObject({ drinks: 2, shotguns: 1 });
    expect(p.message).toBe('You need to assign 1 shotgun and 2 drinks for the Turnover!');
  });

  it('says nothing when there is nothing to pour', () => {
    expect(readPourPrompt({ cardType: 'Penalty', drinkCount: 0, shotguns: 0 })).toBeNull();
    expect(readPourPrompt({})).toBeNull();
  });

  it('singularises properly', () => {
    expect(readPourPrompt({ cardType: 'Penalty', drinkCount: 1, shotguns: 0 }).message)
      .toBe('You need to assign 1 drink for the Penalty!');
  });

  it('is unaffected by the player holding no matching card — the replay case', () => {
    // After a refresh the hand has been replenished and does NOT contain the
    // played card. The prompt must still be read.
    expect(readPourPrompt({ cardType: 'Field Goal', drinkCount: 6, shotguns: 0 }))
      .toMatchObject({ card: 'Field Goal', drinks: 6 });
  });
});

describe('the distributeDrinks handler trusts the server', () => {
  const APP = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
    'utf8'
  );
  const handler = APP.slice(
    APP.indexOf("socket.on('distributeDrinks'"),
    APP.indexOf("socket.on('distributeDrinks'") + 2000
  );

  it('does not re-check the hand before accepting a pour prompt', () => {
    expect(
      /cards\.standard\.some|cards\.wild\.some/.test(handler),
      'the handler is gating on the player\'s hand again. The server removes a '
        + 'played card and deals a replacement immediately, so this check can '
        + 'never pass after a reconnect and the replayed prompt is discarded.'
    ).toBe(false);
  });

  it('uses the shared reader', () => {
    expect(handler).toMatch(/readPourPrompt\(/);
  });
});
