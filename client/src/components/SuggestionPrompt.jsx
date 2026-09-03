/**
 * "3rd and out — call it?"
 *
 * A suggestion is a question, so it needs an answer or it goes away. Accepting
 * declares exactly as an auto-call would; ignoring lets it expire quietly, and
 * an expired suggestion must not linger on screen pretending to still be live.
 *
 * The countdown is the honest part: it shows how long the offer has left, so
 * the Ref knows whether to reach for it or let it go.
 */
export default function SuggestionPrompt({ suggestion, secondsLeft, onAccept, onDismiss }) {
  if (!suggestion) return null;

  return (
    <div className="suggestion" role="status">
      <span className="sg-k">Call it?</span>
      <span className="sg-card">{suggestion.cardId}</span>
      <span className="sg-why">{suggestion.reason}</span>
      <span className="sg-left" aria-label={`${secondsLeft} seconds left`}>{secondsLeft}s</span>
      <button type="button" className="sg-yes" onClick={() => onAccept(suggestion)}>Call it</button>
      <button type="button" className="sg-no" onClick={onDismiss} aria-label="Ignore">×</button>
    </div>
  );
}
