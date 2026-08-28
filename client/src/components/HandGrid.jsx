/**
 * The whole hand, on screen at once.
 *
 * Copies are expanded into individual tiles: 5 Standard + 2 Wild is literally
 * seven cards, exactly like a hand of physical cards. No ×N badges, no
 * side-scroll — `.handgrid` wraps and `.handgrid .dupe` is hidden in CSS.
 */
import GameCard from './GameCard';
import { getCard } from '../data/cards';

/**
 * Server hands are arrays of `{ card, drinks, type }` wire objects, one entry
 * per copy. We resolve each to the canonical card record so nothing about a
 * card is read off the wire except its identity.
 */
const resolve = (entries = []) =>
  entries
    .map((entry, index) => {
      const id = typeof entry === 'string' ? entry : entry && entry.card;
      const card = getCard(id);
      return card ? { card, key: `${id}-${index}` } : null;
    })
    .filter(Boolean);

export default function HandGrid({ standard = [], wild = [], onCardTap }) {
  const tiles = [...resolve(standard), ...resolve(wild)];

  return (
    <div className="handblock">
      <div className="sec">
        <span className="tag">
          Your hand · <b>{standard.length} Standard</b> ·{' '}
          <b style={{ color: 'var(--sf-neon)' }}>{wild.length} Wild</b>
        </span>
      </div>
      <div className="handgrid">
        {tiles.map(({ card, key }) => (
          <GameCard key={key} card={card} onClick={onCardTap ? () => onCardTap(card) : undefined} />
        ))}
      </div>
    </div>
  );
}
