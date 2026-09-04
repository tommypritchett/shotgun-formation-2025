/** The bottom menu sheet, opened from the header. */
export default function MenuSheet({
  open, onClose, roomCode, playerCount, maxPlayers,
  onRules, onLeave, onHandOff, onRemovePlayer,
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
        <button type="button" className="mi" onClick={onLeave}>Leave game</button>
      </div>
    </>
  );
}
