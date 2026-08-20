/**
 * The waiting room. Shows the code big enough to read across a room, and the
 * avatars everyone will be identified by for the rest of the game.
 */
import GameHeader from './GameHeader';

export default function LobbyScreen({
  roomCode, players, isHost, onStart, onLeave, onShare, canStart, minPlayers,
}) {
  return (
    <div className="app">
      <GameHeader roomCode={null} />
      <div className="pad">
        <div className="roomcode">
          <span className="k">Room code</span>
          <span className="n">{roomCode}</span>
        </div>

        <div className="roster">
          {players.map((p, i) => (
            <span className={`rosteri${i === 0 ? ' host' : ''}`} key={p.id || p.name}>
              <img src={p.avatar} alt="" />
              <span className="n">{p.name}</span>
            </span>
          ))}
        </div>

        <p className="waiting">
          {canStart
            ? `${players.length} in. Start when everyone's here.`
            : `${players.length} in · need ${minPlayers} to start`}
        </p>

        {isHost ? (
          <button type="button" className="btn" onClick={onStart} disabled={!canStart}>
            Start game
          </button>
        ) : (
          <p className="waiting">Waiting for the Ref to start…</p>
        )}
        <button type="button" className="btn ghost" onClick={onShare}>Share game link</button>
        <button type="button" className="btn ghost" onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}
