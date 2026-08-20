/**
 * One playing card — the `.card` object from the approved mockup.
 *
 * This renders identically to the physical printed card: same icon, same value
 * chip, same layout. That is a hard product rule, not a preference — a player
 * holding the paper deck has to recognise the card on screen instantly.
 *
 * Every value comes from `data/cards.js`. Nothing about a card is ever
 * hardcoded here.
 */
import CardIcon from './CardIcon';
import DrinkGlyph from './DrinkGlyph';
import { CAN } from './Avatars';
import { DECK, formatValue, tierFor } from '../data/cards';

/** The unit mark for a value: a can for shotguns, a cup for drinks. */
function UnitMark({ isShotgun, canHeight }) {
  if (isShotgun) return <img src={CAN} alt="" style={canHeight ? { height: canHeight } : undefined} />;
  return <DrinkGlyph />;
}

export default function GameCard({
  card,
  copies = 1,
  mini = false,
  onClick,
  className = '',
}) {
  if (!card) return null;

  const tier = tierFor(card);
  const value = formatValue(card.drinks);
  const deckLabel = card.isGlobalEvent ? 'EVENT' : card.deck === DECK.WILD ? 'WILD' : 'STANDARD';
  const classes = [
    'card',
    tier,
    card.deck === DECK.WILD ? 'wild' : '',
    className,
  ].filter(Boolean).join(' ');

  const inner = (
    <>
      <div className="c-top">
        <span className="c-deck">{deckLabel}</span>
        <span className="c-corner">
          <UnitMark isShotgun={value.isShotgun} />
          <span className="cv">{value.amount}</span>
        </span>
      </div>
      {copies > 1 ? <span className="dupe">×{copies}</span> : null}
      <div className="c-art">
        <CardIcon name={card.icon} size={undefined} />
      </div>
      <div className="c-foot">
        <span className="chip">
          <UnitMark isShotgun={value.isShotgun} canHeight={15} />
          {value.amount} <span className="cu2">{value.unit.toUpperCase()}</span>
        </span>
        <span className="c-name">{card.label}</span>
        <span className="c-rule" />
        <span className="c-trig">{card.trigger}</span>
      </div>
    </>
  );

  // The declared-card thumbnail is decorative; a hand card is a real button.
  if (mini) return <div className={classes}>{inner}</div>;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`${card.label}, ${value.amount} ${value.unit}`}
    >
      {inner}
    </button>
  );
}
