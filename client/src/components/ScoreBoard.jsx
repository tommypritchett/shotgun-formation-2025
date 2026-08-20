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

/**
 * What just happened, as far as the wire can tell us.
 *
 * The mockup shows "X gave Y". The socket contract does not carry that:
 * `updatePlayerStats.roundResults` is keyed by RECIPIENT only, with no record
 * of who poured. Rather than invent an attribution the server never sent, this
 * shows who drank and how much. See SESSION_7_REPORT.md.
 */
function RoundLog({ cardId, rows, quarter, players, selfId }) {
  const card = getCard(cardId);
  const byId = {};
  players.forEach((p) => { byId[p.id] = p; });

  return (
    <div className="log">
      <div className="log-head">
        {card ? <CardIcon name={card.icon} size={18} /> : <span style={{ width: 18 }} />}
        <span className="t">Last round{card ? ` · ${card.label}` : ''}</span>
        <span className="clock">{quarter ? `Q${quarter}` : ''}</span>
      </div>
      {rows.length === 0 ? (
        <div className="lrow"><span className="txt">Nothing was poured</span></div>
      ) : (
        rows.map((row) => {
          const value = formatValue(row.drinks);
          const player = byId[row.id];
          const isSelf = row.id === selfId;
          return (
            <div className="lrow" key={row.id}>
              <img className="av" src={player ? player.avatar : undefined} alt="" />
              <span className="txt">
                <b>{isSelf ? 'YOU' : row.name}</b> drank
              </span>
              <span className="amt">
                <span className={`amt-chip ${value.isShotgun ? 's' : 'd'}${isSelf ? ' me' : ''}`}>
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
  selfId,
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
        <RoundLog
          cardId={lastRoundCardId}
          rows={lastRoundRows}
          quarter={quarter}
          players={players}
          selfId={selfId}
        />
      </div>
    </div>
  );
}
