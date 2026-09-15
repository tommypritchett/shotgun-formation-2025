/**
 * A suggestion the Ref cannot miss.
 *
 * ── Why this replaced the countdown prompt ───────────────────────────────
 *
 * The old prompt was a strip with a 20-second clock. Ignore it and it expired
 * silently, which meant an ignored suggestion and an UNSEEN one were
 * indistinguishable — from the Ref's side and from the logs. The owner watched
 * one go past in a real game without registering that a decision had been
 * offered at all.
 *
 * A suggestion fails open into nothing. It should fail into a decision.
 *
 * So this is modelled on `Announcement`, deliberately, and shares its
 * discipline:
 *
 *   - no auto-close on a timer, and no timer shown,
 *   - no tap-outside (the scrim dims and has no click handler),
 *   - no Escape,
 *   - two explicit buttons, and they are the only ways out.
 *
 * ── Both buttons are real answers ────────────────────────────────────────
 *
 * Neither is a default and neither happens by inaction. "Call it" declares the
 * card exactly as an auto-call would; "Skip" says no to THIS suggestion and
 * nothing else. That distinction is the whole point — inaction used to mean
 * skip, and nobody could tell it apart from not having looked.
 *
 * ── The game keeps running underneath ────────────────────────────────────
 *
 * Ordinary React, like `Announcement`: the round timer keeps ticking and
 * socket events keep landing while this is open, because nothing here blocks
 * the event loop. That matters more here than anywhere — a suggestion arrives
 * mid-game by definition.
 *
 * Presentational. State comes in as props and answers go out as callbacks; the
 * queue that decides WHICH suggestion is showing lives in App.
 */
export default function SuggestionModal({
  suggestion = null,
  queued = 0,
  onCall = () => {},
  onSkip = () => {},
}) {
  if (!suggestion) return null;

  return (
    <>
      {/* No onClick. Dimming only — tapping out must not count as an answer. */}
      <div className="scrim on" />
      <div
        className="sheet on suggest-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={`The feed suggests ${suggestion.cardId}`}
      >
        <div className="grab" />
        <p className="sg-kicker">THE FEED SPOTTED</p>
        <p className="sg-card">{suggestion.cardId}</p>
        {suggestion.reason ? <p className="sg-why">{suggestion.reason}</p> : null}
        {/*
          Said out loud when more are waiting, so answering does not feel like
          it came from nowhere when the next one appears immediately after.
        */}
        {queued > 0 ? (
          <p className="sg-queued">
            {queued} more waiting
          </p>
        ) : null}
        <button type="button" className="mi mi-call" onClick={() => onCall(suggestion)}>
          Call it
        </button>
        <button type="button" className="mi" onClick={() => onSkip(suggestion)}>
          Skip
        </button>
      </div>
    </>
  );
}
