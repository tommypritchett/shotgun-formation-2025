/**
 * The Ref removing a player, on screen.
 *
 * Ref-only, and behind a confirm — it takes somebody out of a game they are
 * playing, and a mis-tap in a dark bar would be unrecoverable for them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MenuSheet from '../../client/src/components/MenuSheet.jsx';
import RemovePlayerSheet from '../../client/src/components/RemovePlayerSheet.jsx';

afterEach(cleanup);

const players = [
  { id: 'me', name: 'Ava' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cy', disconnected: true },
];

describe('the menu entry', () => {
  const base = {
    open: true, onClose: () => {}, roomCode: '12345',
    playerCount: 3, maxPlayers: 10, onRules: () => {}, onLeave: () => {},
  };

  it('offers Remove a player to the Ref', () => {
    render(<MenuSheet {...base} onRemovePlayer={() => {}} />);
    expect(screen.getByText(/remove a player/i)).toBeTruthy();
  });

  it('does not offer it to anybody else', () => {
    render(<MenuSheet {...base} />);
    expect(screen.queryByText(/remove a player/i)).toBeNull();
  });
});

describe('the remove sheet', () => {
  const base = { open: true, players, selfId: 'me', onClose: () => {}, onRemove: () => {} };

  it('lists everyone except the Ref', () => {
    render(<RemovePlayerSheet {...base} />);
    expect(screen.queryByText('Ava')).toBeNull();
    expect(screen.getByText(/Ben/)).toBeTruthy();
    expect(screen.getByText(/Cy/)).toBeTruthy();
  });

  it('does not remove on the first tap — it asks first', () => {
    const onRemove = vi.fn();
    render(<RemovePlayerSheet {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getByText(/Ben/));
    expect(onRemove, 'a single tap removed somebody').not.toHaveBeenCalled();
    expect(screen.getByText(/remove ben/i)).toBeTruthy();
  });

  it('removes once confirmed', () => {
    const onRemove = vi.fn();
    render(<RemovePlayerSheet {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getByText(/Ben/));
    fireEvent.click(screen.getByRole('button', { name: /^remove ben$/i }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('lets the Ref back out of the confirm', () => {
    const onRemove = vi.fn();
    render(<RemovePlayerSheet {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getByText(/Ben/));
    fireEvent.click(screen.getByRole('button', { name: /keep them in/i }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/Ben/)).toBeTruthy();
  });

  it('says who is away, rather than hiding them', () => {
    // A player who dropped can still be removed — that is the whole point:
    // they left the bar. Hiding them would defeat the feature.
    render(<RemovePlayerSheet {...base} />);
    expect(screen.getByText(/away/i)).toBeTruthy();
  });
});
