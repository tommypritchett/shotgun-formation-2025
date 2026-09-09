/**
 * Something the room must actually register, shown without stopping the game.
 *
 * This replaces `alert()`. The popup itself was never the problem — the owner
 * wants one, and wants it to need a tap, so that when the whistle moves
 * everybody has seen it. The MECHANISM was the problem: `alert()` halts the
 * JavaScript main thread. While it sits there the round countdown stops
 * ticking, the socket stops processing incoming events, and a player slow to
 * dismiss it misses a whole round. On iOS Safari that is a frozen game rather
 * than a slow one — and `newHost` fires mid-round by definition, because the
 * usual reason the whistle moves is that somebody's phone just died.
 *
 * Being ordinary React is the entire point: the timer keeps ticking and events
 * keep landing underneath, because nothing here blocks the event loop.
 *
 * ── Deliberately harder to dismiss than the other sheets ─────────────────
 *
 * Every other sheet in this client closes on the scrim and on Escape, because
 * they are things you opened. This one is something that happened TO you, so:
 *
 *   - no auto-close on a timer,
 *   - no tap-outside-to-close (the scrim is rendered for the dimming only and
 *     has no click handler),
 *   - no Escape,
 *   - one button, and it is the only way out.
 *
 * If that ever loosens, the popup stops doing the one job it has.
 *
 * Presentational, like the rest of this client: state comes in as props and
 * goes out as a callback.
 */
export default function Announcement({
  open = false,
  title = '',
  body = '',
  dismissText = 'Got it',
  onDismiss = () => {},
}) {
  if (!open) return null;

  return (
    <>
      {/* No onClick. Dimming only — tapping out must not count as reading it. */}
      <div className="scrim on" />
      <div
        className="sheet on announce"
        role="alertdialog"
        aria-modal="true"
        aria-label={title || 'Announcement'}
      >
        <div className="grab" />
        {title ? <p className="announce-t">{title}</p> : null}
        <p className="announce-b">{body}</p>
        <button type="button" className="mi" onClick={onDismiss}>
          {dismissText}
        </button>
      </div>
    </>
  );
}
