/**
 * The full card, opened by tapping a tile in the hand.
 *
 * The grid tiles deliberately drop the trigger text — it cannot survive that
 * size and squinting at it is worse than not showing it. This is where the
 * player reads what the card actually means, at full size, before anything is
 * played.
 */
import GameCard from './GameCard';

export default function CardSheet({ card, onClose, actionLabel, onAction }) {
  if (!card) return null;
  return (
    <>
      <div className="scrim on" onClick={onClose} />
      <div className="sheet on cardsheet" role="dialog" aria-label={card.label} aria-modal="true">
        <div className="grab" />
        <div className="cardsheet-card">
          <GameCard card={card} mini={false} />
        </div>
        {actionLabel ? (
          <button type="button" className="mi" onClick={onAction} style={{ color: 'var(--sf-neon)' }}>
            {actionLabel}
          </button>
        ) : null}
        <button type="button" className="mi" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
