/**
 * Name, then create or join.
 *
 * This is the only screen in the app that carries the FULL lockup — characters
 * and all. It is the one screen with room for it, and it sets the tone before
 * anyone is playing. Every other screen keeps the quiet header treatment, which
 * is what docs/logo-lockup.html specifies for small placements.
 *
 * The image is served from client/public as a plain URL rather than imported:
 * CRA cannot import from outside src/, and a 927 KB data URI in the bundle
 * would be worse than either. `scripts/make-icons.py` generates the web-sized
 * copy from art/shotgun-logo-transparent.png, which stays the source of truth.
 */


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
          {/* width/height are the real pixel dimensions, so the layout is
              reserved before the image arrives and nothing jumps. An <img>
              never blocks first paint; `decoding="async"` keeps it off the
              main thread too. Deliberately NOT loading="lazy" — this is the
              hero, and deferring it would make the screen pop in. */}
          <img
            className="lockup"
            src={`${process.env.PUBLIC_URL}/logo-lockup.png`}
            width={900}
            height={643}
            decoding="async"
            alt="Shotgun Formation — the football party game"
          />
          <p>Everyone gets a hand. The Ref calls what just happened on the TV. If you&apos;re holding it, you hand out the drinks.</p>
        </div>

        <label className="field">
          <span className="k">Your name</span>
          {/* Arriving on a share link the code is already filled, so the only
              thing left is a name — put the cursor there rather than make
              somebody in a bar find it. `autoFocus` rather than a ref effect:
              this component is presentational like the rest of the client, and
              a hook here would be the only one in any of them. */}
          <input
            autoFocus={hasSharedRoomCode}
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
