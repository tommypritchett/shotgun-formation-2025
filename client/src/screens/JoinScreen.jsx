/**
 * Name, then create or join. The mockup does not cover this screen, so it
 * borrows the tokens, the wordmark and nothing else — no new concepts.
 */
import { CAN } from '../components/Avatars';

export default function JoinScreen({
  playerName, onPlayerName,
  roomCode, onRoomCode,
  onCreate, onJoin,
  hasSharedRoomCode, errorMessage,
}) {
  const named = playerName.trim().length > 0;
  return (
    <div className="app">
      <div className="pad">
        <div className="hero">
          <img src={CAN} alt="" />
          <span className="l1">Shotgun</span>
          <span className="l2">Formation</span>
          <p>Everyone gets a hand. The Ref calls what just happened on the TV. If you&apos;re holding it, you hand out the drinks.</p>
        </div>

        <label className="field">
          <span className="k">Your name</span>
          <input
            value={playerName}
            onChange={(e) => onPlayerName(e.target.value)}
            placeholder="Name"
            maxLength={20}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span className="k">Room code</span>
          <input
            value={roomCode}
            onChange={(e) => onRoomCode(e.target.value)}
            placeholder="5 digits"
            inputMode="numeric"
            maxLength={5}
            readOnly={hasSharedRoomCode}
          />
        </label>

        <button type="button" className="btn" onClick={onJoin} disabled={!named || !roomCode}>
          {hasSharedRoomCode ? 'Join shared game' : 'Join game'}
        </button>
        <button type="button" className="btn ghost" onClick={onCreate} disabled={!named}>
          Create a new game
        </button>

        {errorMessage ? <p className="err">{errorMessage}</p> : null}
      </div>
    </div>
  );
}
