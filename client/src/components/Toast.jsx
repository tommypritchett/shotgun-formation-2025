/**
 * Transient confirmation, e.g. "Time! 3 pours locked in automatically".
 *
 * Renders nothing at all when there is no message. The CSS hides an empty
 * toast with `opacity: 0`, but an always-mounted element is one stray class
 * away from showing as a bare green pill floating under the hand — which is
 * exactly what a screenshot caught. Not rendering it cannot go wrong.
 */
export default function Toast({ message }) {
  if (!message) return null;
  return (
    <div id="toast" role="status" className="on">
      {message}
    </div>
  );
}
