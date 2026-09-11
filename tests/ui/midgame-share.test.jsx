/**
 * Sharing mid-game.
 *
 * A game runs long and the best moment is often not the end — it is somebody
 * taking ten drinks in a round. So every player can share the standings as
 * they stand, at any time.
 *
 * Two constraints do the work here: it must not compete with the round
 * controls, and it must not leak who poured what.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import MenuSheet from '../../client/src/components/MenuSheet.jsx';
import GameScreen from '../../client/src/screens/GameScreen.jsx';

afterEach(cleanup);

const readFile = (rel) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const url = require('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '..', '..', rel), 'utf8');
};

const base = {
  open: true, onClose: () => {}, roomCode: '48213',
  playerCount: 3, maxPlayers: 10, onRules: () => {}, onLeave: () => {},
};

describe('where it lives', () => {
  it('is in the menu, and takes whatever share control it is given', () => {
    render(<MenuSheet {...base} shareSlot={<button type="button">Share the score</button>} />);
    expect(screen.getByRole('button', { name: /share the score/i })).toBeTruthy();
  });

  it('renders nothing when there is nothing to share', () => {
    const { container } = render(<MenuSheet {...base} />);
    expect(container.textContent).not.toMatch(/share the score/i);
  });

  it('does NOT add a control to the round screen', () => {
    // The round screen is the busiest thing in the app and nothing here may
    // make pouring harder.
    const { container } = render(
      <GameScreen
        quarter={1} roomCode="48213" players={[]} boardTab="stand"
        lastRoundRows={[]} hand={{ standard: [], wild: [] }} selfId="me"
      />,
    );
    expect(container.textContent, 'a share control appeared on the round screen')
      .not.toMatch(/share the score/i);
  });

  it('is available to EVERY player, not only the Ref', () => {
    const src = readFile('client/src/App.js');
    const at = src.indexOf('shareSlot={');
    expect(at, 'the mid-game share slot is gone').toBeGreaterThan(-1);
    const block = src.slice(at, at + 900);
    expect(block, 'the mid-game share was gated behind isHost')
      .not.toMatch(/isHost\s*(&&|\?)/);
  });
});

describe('what it claims', () => {
  it('is labelled as a snapshot, not a final result', () => {
    const src = readFile('client/src/App.js');
    const at = src.indexOf('shareSlot={');
    const block = src.slice(at, at + 900);
    expect(block).toMatch(/title="RIGHT NOW"/);
  });

  it('carries no timestamp or quarter label', () => {
    // Mid-game numbers are a snapshot. It will be posted five minutes later
    // either way, and a stale clock on the image is worse than no clock.
    const src = readFile('client/src/App.js');
    const at = src.indexOf('shareSlot={');
    const block = src.slice(at, at + 900);
    expect(block, 'the card claims a time').not.toMatch(/toLocaleTimeString|Date\.now|quarter=\{/);

    const card = readFile('client/src/lib/result-card.js');
    expect(card, 'the card module reads a clock')
      .not.toMatch(/new Date\(\)|Date\.now\(\)|toLocaleTimeString/);
  });

  it('uses the 9:16 story size, like the end-of-game card', () => {
    const src = readFile('client/src/App.js');
    const at = src.indexOf('shareSlot={');
    expect(src.slice(at, at + 900)).toMatch(/size="story"/);
  });
});
