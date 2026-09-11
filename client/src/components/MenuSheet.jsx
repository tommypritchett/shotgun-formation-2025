/** The bottom menu sheet, opened from the header. */
export default function MenuSheet({
  open, onClose, roomCode, playerCount, maxPlayers,
  onRules, onLeave, onHandOff, onRemovePlayer, onEndGame, shareSlot = null,
  soundOn = true, onToggleSound,
}) {
  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} />
      <div className={`sheet${open ? ' on' : ''}`} role="dialog" aria-label="Menu" aria-modal={open}>
        <div className="grab" />
        <button type="button" className="mi" onClick={onRules}>
          Rules &amp; card values <span className="k">23 cards</span>
        </button>
        <button type="button" className="mi" onClick={onClose}>
          Players <span className="k">{playerCount} / {maxPlayers}</span>
        </button>
        <button type="button" className="mi" onClick={onClose}>
          Room code <span className="k">{roomCode}</span>
        </button>
        {/* Item 3: share the game as it stands, from the menu, available to
            EVERY player at any time. Deliberately not a button competing with
            the round controls — the round screen is the busiest thing in the
            app and nothing may make pouring harder. */}
        {shareSlot}
        {/* One toggle, no slider. This is a drinking game, not a mixing desk.
            Somebody whose phone is the party speaker wants this off within
            about four seconds. */}
        {onToggleSound ? (
          <button type="button" className="mi" onClick={onToggleSound} aria-pressed={soundOn}>
            Sounds <span className="k">{soundOn ? 'ON' : 'OFF'}</span>
          </button>
        ) : null}
        {onHandOff ? (
          <button type="button" className="mi" onClick={onHandOff}>
            Hand off the whistle <span className="k">NEW REF</span>
          </button>
        ) : null}
        {/* Ref-only, like the handoff above it: for somebody who left the bar
            without leaving the game. */}
        {onRemovePlayer ? (
          <button type="button" className="mi" onClick={onRemovePlayer}>
            Remove a player <span className="k">REF</span>
          </button>
        ) : null}
        {/* Ref-only: finishes the game for EVERYONE and shows the result.
            Sits above Leave, because leaving is the thing you do after. */}
        {onEndGame ? (
          <button type="button" className="mi" onClick={onEndGame}>
            End game <span className="k">FINAL SCORE</span>
          </button>
        ) : null}
        <button type="button" className="mi" onClick={onLeave}>Leave game</button>
      </div>
    </>
  );
}
