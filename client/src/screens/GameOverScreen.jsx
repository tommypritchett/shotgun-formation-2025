import { CAN } from '../components/CanMark';
import DrinkGlyph from '../components/DrinkGlyph';
import ShareResult from '../components/ShareResult';

/**
 * The curtain call.
 *
 * `gameOver` used to fire an announcement and drop everyone back on the join
 * screen, so the most postable moment in the product evaporated. This is that
 * moment: final standings, the room code, and one tap to share it.
 *
 * Deliberately NOT a report. No stats breakdown, no round history, no "best
 * moment" — the winner has to be unmistakable at a glance without reading the
 * numbers, which is what the size and the amber do.
 *
 * It persists. No timeout, no auto-advance, no dismiss-on-tap: somebody will
 * be reading this while their friend is still pouring a drink. Same discipline
 * as the announcement modal.
 */
export default function GameOverScreen({
  standings = [], roomCode = '', isHost = false, onPlayAgain, onLeave,
}) {
  /**
   * Who won — and whether anybody did.
   *
   * A tie at the top is not a rare edge case: two First Down rounds give every
   * player exactly the same total, and that is a completely ordinary short
   * game. Declaring one of them the winner because they sort first is simply
   * false, and this screen is the thing people screenshot.
   */
  const score = (p) => (p.totalShotguns || 0) * 10 + (p.totalDrinks || 0);
  const top = standings.length ? score(standings[0]) : 0;
  const leaders = standings.filter((p) => score(p) === top);
  const winner = standings.length && leaders.length === 1 ? standings[0] : null;
  const tied = standings.length > 1 && leaders.length > 1;

  return (
    <div className="app gameover">
      <div className="pad">
        <p className="go-k">Final</p>
        {winner ? (
          <h1 className="go-win">
            <span className="go-win-n">{winner.name}</span>
            <span className="go-win-l">wins</span>
          </h1>
        ) : tied ? (
          <h1 className="go-win">
            <span className="go-win-n">Dead heat</span>
            <span className="go-win-l">
              {leaders.length === standings.length
                ? 'everybody drew'
                : `${leaders.map((p) => p.name).join(' and ')} tied`}
            </span>
          </h1>
        ) : (
          <h1 className="go-win"><span className="go-win-l">Game over</span></h1>
        )}

        <ol className="go-list">
          {standings.map((p, i) => (
            <li
              key={p.id || p.name}
              className={score(p) === top && !tied ? 'go-row first' : 'go-row'}
            >
              <span className="go-rank">{i + 1}</span>
              <span className="go-name">{p.name}</span>
              <span className="go-amt">
                {(p.totalShotguns || 0) > 0 ? (
                  <span className="go-chip s"><img src={CAN} alt="" />{p.totalShotguns}</span>
                ) : null}
                {(p.totalDrinks || 0) > 0 ? (
                  <span className="go-chip d"><DrinkGlyph />{p.totalDrinks}</span>
                ) : null}
                {!(p.totalShotguns || 0) && !(p.totalDrinks || 0) ? (
                  <span className="go-chip none">—</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        <p className="go-room">Room {roomCode}</p>

        {/* The Session 18 card, in the place it was always for. */}
        <ShareResult players={standings} roomCode={roomCode} size="story" />

        {isHost && onPlayAgain ? (
          <button type="button" className="btn" onClick={onPlayAgain}>Play again</button>
        ) : null}
        <button type="button" className="btn ghost" onClick={onLeave}>
          {isHost ? 'Leave' : 'Back to start'}
        </button>
      </div>
    </div>
  );
}
