/**
 * The tab pair: Standings, and the results of the round that just ended.
 *
 * The board flips itself to Round Results when a round finalizes (with the
 * pulse), because that is the moment everyone looks at their phone. Standings
 * is always one tap back.
 */
import CardIcon from './CardIcon';
import DrinkGlyph from './DrinkGlyph';
import PlayerRow from './PlayerRow';
import { CAN } from './Avatars';
import { formatValue, getCard, shotgunsFor, DRINKS_PER_SHOTGUN } from '../data/cards';

function RoundLog({ cardId, rows, quarter }) {
  const card = getCard(cardId);
  return (
    <div className="log">
      <div className="log-head">
        {card ? <CardIcon name={card.icon} size={18} /> : <span style={{ width: 18 }} />}
        <span className="t">Last round{card ? ` · ${card.label}` : ''}</span>
        <span className="clock">{quarter ? `Q${quarter}` : ''}</span>
      </div>
      {rows.length === 0 ? (
        <div className="lrow">
          <span className="txt">Nothing was poured</span>
        </div>
      ) : (
        rows.map((row, i) => {
          const value = formatValue(row.drinks);
          return (
            <div className="lrow" key={`${row.fromName}-${row.toName}-${i}`}>
              <img className="av" src={row.fromAvatar} alt="" />
              <svg
                className="arr" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 12h14m-5-6l6 6-6 6" />
              </svg>
              <img className="av" src={row.toAvatar} alt="" />
              <span className="txt">
                <b>{row.fromName}</b> gave <b>{row.toIsSelf ? 'YOU' : row.toName}</b>
              </span>
              <span className="amt">
                <span className={`amt-chip ${value.isShotgun ? 's' : 'd'}${row.involvesSelf ? ' me' : ''}`}>
                  {value.isShotgun ? <img src={CAN} alt="" /> : <DrinkGlyph />}
                  {value.amount}
                </span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function ScoreBoard({
  players,
  tab,
  onTab,
  pulse,
  lastRoundCardId,
  lastRoundRows = [],
  quarter,
}) {
  const ranked = [...players].sort((a, b) => b.totalDrinks - a.totalDrinks);
  const showLast = tab === 'last';

  return (
    <div className="blk-stand">
      <div className="boardtabs" role="tablist" aria-label="Score board">
        <button
          type="button" role="tab" aria-selected={!showLast}
          className={`btab${!showLast ? ' on' : ''}`}
          onClick={() => onTab('stand')}
        >
          Standings
        </button>
        <button
          type="button" role="tab" aria-selected={showLast}
          className={`btab${showLast ? ' on' : ''}${pulse ? ' pulse' : ''}`}
          onClick={() => onTab('last')}
        >
          Round Results
        </button>
        <span className="bcount">{players.length} players</span>
      </div>

      <div className={`boardpane${!showLast ? ' on' : ''}`}>
        <div className="stand">
          <div className="stand-head">
            <span className="r">#</span>
            <span>Player</span>
            <span style={{ textAlign: 'right' }}>SG</span>
            <span style={{ textAlign: 'right' }}>DR</span>
          </div>
          <div className="rows">
            {ranked.map((p, i) => (
              <PlayerRow
                key={p.id || p.name}
                rank={i + 1}
                name={p.name}
                avatar={p.avatar}
                shotguns={(p.totalShotguns || 0) + shotgunsFor(p.totalDrinks || 0)}
                drinks={(p.totalDrinks || 0) % DRINKS_PER_SHOTGUN}
                isLeader={i === 0}
                isSelf={p.isSelf}
                isRef={p.isRef}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={`boardpane${showLast ? ' on' : ''}`}>
        <RoundLog cardId={lastRoundCardId} rows={lastRoundRows} quarter={quarter} />
      </div>
    </div>
  );
}
