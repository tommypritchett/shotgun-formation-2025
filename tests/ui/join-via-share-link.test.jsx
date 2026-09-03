/**
 * Arriving on a share link must always leave a join screen you can use.
 *
 * The reported symptom was "the room code was not filled in, and they could
 * not type one either" — an invited player with no way into the game at all.
 *
 * Both halves were real, and neither matched the first guess:
 *
 * 1. The link DOES carry the code. `handleShareGame` builds
 *    `${origin}?room=${roomCode}`. What never happened was reading it back:
 *    `roomCode` state initialised to '' and only the BOTH-params rejoin path
 *    ever called `setRoomCode`, and that path requires `player` too.
 *
 * 2. The field was `readOnly` whenever the URL had a room and no player. So a
 *    share-link recipient got an EMPTY field that was also read-only, and a
 *    Join button disabled on `!roomCode`. Three states that individually look
 *    reasonable and together are a dead end.
 *
 * The auto-join effect at App.js:869 was NOT involved — it is gated on
 * `urlParams.roomCode && urlParams.playerName`, and a share link has no
 * `player`, so it never fires for this case.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import JoinScreen from '../../client/src/screens/JoinScreen.jsx';
import { roomCodeFromSearch } from '../../client/src/lib/share-link.js';

afterEach(cleanup);

describe('reading the room code out of a share link', () => {
  it('finds the code the Share Link button actually writes', () => {
    // Must match handleShareGame: `${window.location.origin}?room=${roomCode}`
    expect(roomCodeFromSearch('?room=12345')).toBe('12345');
  });

  it('is empty when there is no link, so a normal visit is untouched', () => {
    expect(roomCodeFromSearch('')).toBe('');
    expect(roomCodeFromSearch('?')).toBe('');
    expect(roomCodeFromSearch('?other=1')).toBe('');
  });

  it('ignores a code that is not a room code rather than pre-filling rubbish', () => {
    expect(roomCodeFromSearch('?room=')).toBe('');
    expect(roomCodeFromSearch('?room=not-a-code')).toBe('');
    expect(roomCodeFromSearch('?room=123456789')).toBe('');
  });

  it('still reads the code when a player name rides along', () => {
    expect(roomCodeFromSearch('?room=12345&player=Ava')).toBe('12345');
  });
});

describe('the join screen a share link lands on', () => {
  const props = {
    playerName: '', onPlayerName: () => {},
    roomCode: '12345', onRoomCode: () => {},
    onCreate: () => {}, onJoin: () => {},
    hasSharedRoomCode: true, errorMessage: null,
  };

  it('pre-fills the room code', () => {
    render(<JoinScreen {...props} />);
    expect(screen.getByLabelText(/room code/i).value).toBe('12345');
  });

  it('never renders a room code field you cannot type in', () => {
    // This is the whole bug. A read-only field is fine only if it is right,
    // and it was empty.
    render(<JoinScreen {...props} />);
    const field = screen.getByLabelText(/room code/i);
    expect(field.readOnly).toBe(false);
    expect(field.disabled).toBe(false);
  });

  it('lets a wrong code be corrected, which readOnly made impossible', () => {
    const onRoomCode = vi.fn();
    render(<JoinScreen {...props} onRoomCode={onRoomCode} />);
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: '54321' } });
    expect(onRoomCode).toHaveBeenCalledWith('54321');
  });

  it('puts the cursor in the name field, which is the only thing left to do', () => {
    render(<JoinScreen {...props} />);
    expect(document.activeElement).toBe(screen.getByLabelText(/your name/i));
  });

  it('enables Join once the name is typed, with the code coming from the link', () => {
    const { rerender } = render(<JoinScreen {...props} />);
    expect(screen.getByRole('button', { name: /join/i }).disabled).toBe(true);
    rerender(<JoinScreen {...props} playerName="Ava" />);
    expect(screen.getByRole('button', { name: /join/i }).disabled).toBe(false);
  });
});

describe('a bad room code in the URL', () => {
  it('leaves a usable form rather than a dead end', () => {
    // Nothing pre-filled, everything typable, Create still available.
    render(<JoinScreen playerName="" onPlayerName={() => {}} roomCode=""
      onRoomCode={() => {}} onCreate={() => {}} onJoin={() => {}}
      hasSharedRoomCode={false} errorMessage="That room code does not exist." />);
    const field = screen.getByLabelText(/room code/i);
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe('');
    expect(screen.getByText(/does not exist/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create a new game/i })).toBeTruthy();
  });
});

describe('no params at all', () => {
  it('is exactly the screen it has always been', () => {
    render(<JoinScreen playerName="" onPlayerName={() => {}} roomCode=""
      onRoomCode={() => {}} onCreate={() => {}} onJoin={() => {}}
      hasSharedRoomCode={false} errorMessage={null} />);
    expect(screen.getByLabelText(/your name/i).value).toBe('');
    expect(screen.getByLabelText(/room code/i).value).toBe('');
    expect(screen.getByRole('button', { name: /^join game$/i }).disabled).toBe(true);
  });
});
