import { GROUPS, REF_ONLY, frequencyLabel } from '../lib/card-groups';

/**
 * Per-card auto / suggest / off, for this room.
 *
 * The dial the owner tunes after a real game night. Two things shape it:
 * it is reached for on a phone mid-game, so it is grouped by how often a card
 * fires rather than listed alphabetically; and every card carries its real
 * per-game frequency, because "First Down, about 30 a game" answers the actual
 * question — "what do I turn down?" — faster than any amount of explanation.
 *
 * Presentational, like the rest of this client: modes come in as props and go
 * out as callbacks.
 */
/**
 * NOTE the `on` class. `.sheet` is a bottom sheet parked at
 * `translateY(110%)` until `.on` is added, so a sheet rendered without it
 * is mounted, sized, in the DOM, and completely off-screen. This component
 * is only rendered while open, so it is always `on`.
 */
export default function CardDial({
  modes = {}, defaults = {}, onMode = () => {}, onClose = () => {},
  paused = false, onPause = () => {},
}) {
  const modeOf = (cardId) => modes[cardId] || defaults[cardId] || 'off';

  return (
    <div className="sheet carddial on" role="dialog" aria-label="What the feed calls">
      <div className="sheet-head">
        <span className="t">What the feed calls</span>
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* The escape hatch lives at the top, because when it is wanted it is
          wanted immediately. */}
      <button
        type="button"
        className={`pausebtn${paused ? ' on' : ''}`}
        onClick={() => onPause(!paused)}
      >
        {paused ? 'Auto-calling is paused — resume' : 'Pause auto-calling'}
      </button>
      {paused ? (
        <p className="hint">
          Nothing will be called until you resume. The score still updates and you can
          still call anything by hand.
        </p>
      ) : null}

      {GROUPS.map((group) => (
        <section className="dialgroup" key={group.key}>
          <h3>{group.title}</h3>
          <p className="hint">{group.hint}</p>
          {group.cards.map((cardId) => (
            <div className="dialrow" key={cardId}>
              <span className="dc-name">
                {cardId}
                <span className="dc-freq">{frequencyLabel(cardId)}</span>
              </span>
              <span className="dc-modes" role="group" aria-label={`${cardId} mode`}>
                {['auto', 'suggest', 'off'].map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={modeOf(cardId) === mode ? 'on' : ''}
                    aria-pressed={modeOf(cardId) === mode}
                    onClick={() => onMode(cardId, mode)}
                  >
                    {mode}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </section>
      ))}

      <section className="dialgroup">
        <h3>Only you can call these</h3>
        <p className="hint">
          No feed can see them — they are commentary, not data. {REF_ONLY.join(', ')}.
        </p>
      </section>
    </div>
  );
}
