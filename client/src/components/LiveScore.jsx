import { statusLine } from '../lib/game-list';

/**
 * The attached game's score, quiet, under the header.
 *
 * Deliberately one line. It sits alongside the existing header treatment and
 * must not compete with the round timer or the deck, and must not push the
 * board down at 360px — the layout that replaced the old `zoom: 70%` hack has
 * no slack in it.
 *
 * The states are handled honestly rather than by freezing on a stale score: a
 * feed that has died says so, because a score that silently stops updating
 * during a game is worse than no score at all.
 */
export default function LiveScore({ watching, onDetach, canDetach = false }) {
  if (!watching) return null;

  const { away, home, state, error, ended } = watching;
  const line = error
    ? 'Feed unavailable'
    : ended
      ? 'Feed ended'
      : statusLine(watching);

  const started = state === 'in' || state === 'post';
  const stale = Boolean(error || ended);

  return (
    <div className={`livescore${stale ? ' stale' : ''}`} aria-live="polite">
      <span className="ls-teams">
        {away || 'Away'} <span className="at">@</span> {home || 'Home'}
      </span>
      {started && !stale ? (
        <span className="ls-score">
          {watching.awayScore ?? 0}<span className="dash">–</span>{watching.homeScore ?? 0}
        </span>
      ) : null}
      <span className="ls-when">{line}</span>
      {canDetach ? (
        <button type="button" className="ls-detach" onClick={onDetach}
          aria-label="Change game — stop watching this one and pick another">
          Change game
        </button>
      ) : null}
    </div>
  );
}
