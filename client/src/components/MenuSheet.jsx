/** The bottom menu sheet, opened from the header. */
export default function MenuSheet({ open, onClose, roomCode, playerCount, maxPlayers, onRules, onLeave, onHandOff }) {
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
        <button type="button" className="mi" onClick={onLeave}>Leave game</button>
      </div>
    </>
  );
}
