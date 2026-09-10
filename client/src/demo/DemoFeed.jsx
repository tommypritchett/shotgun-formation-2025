/**
 * The running log of what just happened, in plain language.
 *
 * A NEW component rather than a reuse of `components/CallFeed`. CallFeed is a
 * collapsible "called by the feed" panel keyed to `{cardId, reason}` rows; this
 * needs a flat narrative with indented consequence lines ("Dylan → Marcus 4
 * drinks"). Bending CallFeed into that shape would mean changing its props and
 * its output, which this session is not allowed to do — so the presentational
 * thing it does well is left alone and this stands beside it.
 *
 * Newest at the BOTTOM, like a chat log, because the demo is read forwards.
 */
import { lineText } from './lines';

export default function DemoFeed({ lines = [], title = 'What just happened' }) {
  return (
    <section className="dfeed" aria-label={title}>
      <h2 className="dfeed-h">{title}</h2>
      <ol className="dfeed-list">
        {lines.map((line) => (
          <li key={line.key} className={`dfeed-row k-${line.kind || 'note'}`}>
            {lineText(line)}
          </li>
        ))}
      </ol>
    </section>
  );
}
