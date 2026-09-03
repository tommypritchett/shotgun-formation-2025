/**
 * What the feed has called.
 *
 * The running record of every round the feed started, plus the ones it skipped
 * because a round was already live. Entries appear at the moment the round
 * starts — the 45-second broadcast delay is applied server-side — so this reads
 * in step with the game rather than ahead of it.
 *
 * Visible to everyone. Suggestions are Ref-only and arrive marked as
 * suggestions rather than calls, because a suggestion is a question and a call
 * is an announcement.
 */
export default function CallFeed({ entries = [], open = false, onToggle = () => {} }) {
  const calls = entries.length;

  return (
    <section className={`callfeed${open ? ' open' : ''}`} aria-label="What the feed has called">
      <button type="button" className="cf-head" onClick={onToggle} aria-expanded={open}>
        <span className="cf-t">Called by the feed</span>
        <span className="cf-n">{calls}</span>
        <span className="cf-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <ul className="cf-list">
          {calls === 0 ? (
            <li className="cf-empty">Nothing yet. Calls will land here as the game goes.</li>
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
