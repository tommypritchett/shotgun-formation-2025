/**
 * What the system detected and would have called.
 *
 * The deliverable of Part A, and the whole reason nothing declares yet: this is
 * how you judge the pacing by watching rather than from a table. Entries appear
 * at the moment a round WOULD have started — the 45-second broadcast delay has
 * already been applied server-side — so the rhythm on screen is the rhythm the
 * room would actually feel.
 *
 * Visible to everyone. Suggestions are Ref-only and arrive marked as
 * suggestions rather than calls, because a suggestion is a question and a call
 * is an announcement.
 */
export default function CallFeed({ entries = [], open = false, onToggle = () => {} }) {
  const calls = entries.length;

  return (
    <section className={`callfeed${open ? ' open' : ''}`} aria-label="What the feed would have called">
      <button type="button" className="cf-head" onClick={onToggle} aria-expanded={open}>
        <span className="cf-t">Would have called</span>
        <span className="cf-n">{calls}</span>
        <span className="cf-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <ul className="cf-list">
          {calls === 0 ? (
            <li className="cf-empty">Nothing yet. Attach a game and the calls will land here.</li>
          ) : null}
          {entries.map((entry) => (
            <li key={entry.key} className={entry.suggestion ? 'cf-row suggest' : 'cf-row'}>
              <span className="cf-time">{entry.at}</span>
              <span className="cf-card">{entry.cardId}</span>
              {entry.suggestion ? <span className="cf-tag">suggested</span> : null}
              <span className="cf-why">{entry.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
