/**
 * One row of the standings table.
 *
 * Totals arrive from the server as a flat drink count plus a shotgun count.
 * The row shows them as two separate columns, SG and DR, because that is how
 * players actually talk about a score ("three shotguns and four").
 */
import DrinkGlyph from './DrinkGlyph';
import { CAN } from './Avatars';

function StatCell({ kind, value }) {
  const zero = value === 0 ? ' zero' : '';
  if (kind === 'sg') {
    return (
      <div className={`stat sg${zero}`}>
        <img src={CAN} alt="" />
        <span className="v">{value}</span>
      </div>
    );
  }
  return (
    <div className={`stat dk${zero}`}>
      <DrinkGlyph />
      <span className="v">{value}</span>
    </div>
  );
}

export default function PlayerRow({ rank, name, avatar, shotguns, drinks, isLeader, isSelf, isRef }) {
  const classes = ['prow', isLeader ? 'lead' : '', isSelf ? 'self' : ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <span className="rank num">{rank}</span>
      <div className="who">
        <img className="av" src={avatar} alt="" />
        <span className="nm">
          {name}
          {isRef ? <span className="badge-ref">REF</span> : null}
          {isSelf ? <span className="badge-you">YOU</span> : null}
        </span>
      </div>
      <StatCell kind="sg" value={shotguns} />
      <StatCell kind="dk" value={drinks} />
    </div>
  );
}
