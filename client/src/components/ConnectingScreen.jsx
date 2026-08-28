import { CAN } from './CanMark';

/**
 * "Getting you back in" — shown while the app tries to rejoin a room from the
 * URL or from saved state.
 *
 * It MUST have a way out. This screen used to be a dead end: the only bail-out
 * read a stale `gameState` and never fired, so a room that had closed left the
 * player watching a spinner with no button, and the saved state put them right
 * back on it next time they opened the app. Whatever else goes wrong, the way
 * back to the start screen is on the screen.
 */
export default function ConnectingScreen({ roomCode, onGiveUp }) {
  return (
    <div className="app">
      <div className="pad">
        <div className="hero">
          <img src={CAN} alt="" />
          <span className="l1">Getting you</span>
          <span className="l2">back in</span>
          <p>
            {roomCode ? `Rejoining room ${roomCode}…` : 'Rejoining your game…'}
          </p>
          <button type="button" className="btn ghost" onClick={onGiveUp}>
            Back to start
          </button>
        </div>
      </div>
    </div>
  );
}
