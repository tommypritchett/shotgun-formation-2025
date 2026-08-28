import { prepareGames, statusLine, isRanked } from '../lib/game-list';

/**
 * Pick the game the room is watching.
 *
 * Two taps: choose the game, done. Anything that turns this into a setup form
 * is working against the point of the feature — the Ref is meant to be doing
 * less, not filling in a screen before kickoff. There is deliberately no delay
 * setting here, and there must never be one.
 *
 * Presentational, like every other component in this client: the query and the
 * ranked toggle are props, and the state lives in App.js with the rest.
 */
export default function GamePicker({
  league = 'nfl',
  games = [],
  loading = false,
  error = null,
  query = '',
  onlyRanked = true,
  onQuery = () => {},
  onOnlyRanked = () => {},
  onLeague = () => {},
  onPick = () => {},
  onClose = () => {},
}) {
  const shown = prepareGames(games, { league, query, onlyRanked });
  const isCollege = league === 'college-football';

  return (
    <div className="sheet gamepicker" role="dialog" aria-label="Pick a game">
      <div className="sheet-head">
        <span className="t">Watch a game</span>
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="seg" role="tablist">
        <button
          type="button" role="tab" aria-selected={league === 'nfl'}
          className={league === 'nfl' ? 'on' : ''}
          onClick={() => onLeague('nfl')}
        >NFL</button>
        <button
          type="button" role="tab" aria-selected={isCollege}
          className={isCollege ? 'on' : ''}
          onClick={() => onLeague('college-football')}
        >College</button>
      </div>

      {/* An NFL Sunday is thirteen games and needs none of this. A college
          Saturday is fifty to a hundred and is unusable without it. */}
      {isCollege && (
        <div className="filters">
          <input
            type="search"
            className="search"
            placeholder="Search teams"
            aria-label="Search teams"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <label className="chk">
            <input
              type="checkbox"
              checked={onlyRanked}
              onChange={(e) => onOnlyRanked(e.target.checked)}
            />
            Ranked only
          </label>
        </div>
      )}

      {loading && <p className="hint">Loading games…</p>}
      {error && <p className="hint err">{error}</p>}
      {!loading && !error && shown.length === 0 && <p className="hint">No games to show.</p>}

      <ul className="gamelist">
        {shown.map((game) => (
          <li key={game.id}>
            <button type="button" className="gamerow" onClick={() => onPick(game)}>
              <span className="teams">
                {isRanked(game) && (
                  <span className="rank">
                    #{Math.min(game.home?.rank || 999, game.away?.rank || 999)}
                  </span>
                )}
                {game.away?.abbreviation} @ {game.home?.abbreviation}
              </span>
              <span className="score">
                {game.started ? `${game.away?.score ?? 0} - ${game.home?.score ?? 0}` : ''}
              </span>
              <span className="when">{statusLine(game)}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* Say plainly what a machine cannot see, rather than letting people
          wonder why the 40-point cards never fire. */}
      <p className="hint small">
        Doink and Record Broken are always called by the Ref — no feed can see them.
      </p>
    </div>
  );
}
