/**
 * One of the three phones, side by side.
 *
 * Showing all three at once is the single most important layout decision here.
 * A one-player point of view reads as a solitaire app; seeing Dylan tap and the
 * drinks land on Marcus is what makes it read as a party game, which is what it
 * is.
 *
 * Reuses `components/GameCard` unchanged — it already renders a card exactly as
 * the printed one, including the rule that a value of 20 shows as 2 SHOTGUNS.
 * That is the beat-8 payoff, so rendering it any other way here would be
 * inventing a second source of truth for the headline mechanic.
 */
import GameCard from '../components/GameCard';
import { getCard } from '../data/cards';

export default function DemoPlayer({
  player, hand, declared, totals, incoming, pouring, compact = false,
}) {
  const isHolder = declared && declared.holder === player.name;
  const declaredCard = declared && declared.cardId ? getCard(declared.cardId) : null;

  const classes = [
    'dplayer',
    isHolder ? 'holding' : '',
    incoming ? 'landing' : '',
    pouring ? 'pouring' : '',
  ].filter(Boolean).join(' ');

  /**
   * 9:16 shows ONE card, large.
   *
   * Seven cards across three panels on a phone puts each one at ~44px, at
   * which the value chip and the card name clip — and the card whose value has
   * to be readable is the 20-point Wild at beat 8, the entire payoff. So the
   * vertical cut shows the card that matters at a size you can read and counts
   * the rest. The 16:9 cut has room for the full hand and still shows it.
   */
  const renderCompactHand = () => {
    const all = [...(hand.standard || []), ...(hand.wild || [])];
    const showId = declaredCard && all.includes(declaredCard.id)
      ? declaredCard.id
      : all[0];
    const rest = Math.max(0, all.length - 1);
    return (
      <div className="dp-hand one">
        {renderCard(showId, 'one')}
        {rest > 0 ? <span className="dp-more">+{rest} more</span> : null}
      </div>
    );
  };

  const renderCard = (id, key) => {
    const card = getCard(id);
    if (!card) return null;
    const lit = Boolean(declaredCard && declaredCard.id === card.id);
    return (
      <div className={`dcard${lit ? ' lit' : ''}`} key={key}>
        <GameCard card={card} />
      </div>
    );
  };

  return (
    <section className={classes} aria-label={`${player.name}'s phone`}>
      <header className="dp-head">
        <img className="dp-av" src={player.avatar} alt="" style={{ '--ring': player.avatarRing }} />
        <span className="dp-name">{player.name}</span>
        {player.isRef ? <span className="dp-ref">REF</span> : null}
      </header>

      <div className="dp-tot" aria-label={`${player.name}'s totals`}>
        <span className="dp-sg">{totals.shotguns}</span><span className="dp-u">SG</span>
        <span className="dp-dr">{totals.drinks}</span><span className="dp-u">DR</span>
        {incoming ? <span className="dp-plus" aria-hidden="true">+{incoming}</span> : null}
      </div>

      {compact ? renderCompactHand() : (
        <>
          <div className="dp-hand mini">
            {(hand.standard || []).map((id, i) => renderCard(id, `s${i}`))}
          </div>
          <div className="dp-hand mini wild">
            {(hand.wild || []).map((id, i) => renderCard(id, `w${i}`))}
          </div>
        </>
      )}
    </section>
  );
}
