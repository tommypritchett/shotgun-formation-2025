/**
 * The feed interface, and the one rule that keeps this testable.
 *
 * Two implementations, from the first commit:
 *
 *   ReplayFeed — reads a recorded game and emits its plays on a timer, as
 *                though they were happening now
 *   LiveFeed   — polls ESPN for a real in-progress game
 *
 * Nothing above this line may be able to tell them apart. Detection, queueing,
 * the delay offset, the socket events and the UI all sit on top, so a recorded
 * game replayed at 20x is a complete end-to-end exercise of the whole feature,
 * on any day, in about ten minutes.
 *
 * ReplayFeed was written first on purpose. Built second it would have ended up
 * subtly different from the live path and therefore useless as a test.
 *
 * ── One rule for the live path: never take timing from the feed ───────────
 *
 * ESPN's play `wallclock` is not monotonic. Verified in a captured fixture:
 * SMU 26 - MIA 20 jumps BACKWARDS by 3h11m at play 40. A live feed can deliver
 * the same thing.
 *
 * So nothing in the live path derives timing from a play's timestamps. The
 * 45-second delay and the 90-second stale drop both measure from `Date.now()`
 * at the moment the detection was queued; dedupe is on ESPN's play ID, not on
 * time; poll scheduling is a fixed interval with its own backoff. A backwards
 * jump therefore cannot dump a burst of queued calls into a live room.
 *
 * ReplayFeed is the ONLY place that reads `wallclock`, deliberately — it is
 * reproducing the spacing of a recorded game — and it clamps negative gaps to
 * zero and caps long ones. `tests/feed-timing-source.test.js` pins this; if you
 * are about to schedule something off a play's timestamp, that is the test that
 * will stop you, and it is right to.
 */

const EventEmitter = require('node:events');

/**
 * Events every feed emits:
 *
 *   'play'   (normalised play)     — one new play, never the same id twice
 *   'drive'  (normalised drive)    — a drive whose result is now known
 *   'state'  ({ period, clock, homeScore, awayScore, status })
 *   'error'  (Error)               — recoverable; the feed keeps going
 *   'end'    ({ reason })          — final, or stopped. No further events.
 */
class Feed extends EventEmitter {
  constructor({ league = 'nfl', gameId = null } = {}) {
    super();
    this.league = league;
    this.gameId = gameId ? String(gameId) : null;
    this.started = false;
    this.stopped = false;
    /** Every play id already emitted. A play fires once, ever. */
    this.seen = new Set();
  }

  /** Emit a play unless it has been seen. Returns whether it was new. */
  emitPlay(play) {
    if (!play || !play.id || this.seen.has(play.id) || this.stopped) return false;
    this.seen.add(play.id);
    this.emit('play', play);
    return true;
  }

  start() { throw new Error('Feed.start not implemented'); }

  stop(reason = 'stopped') {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    this.emit('end', { reason });
    this.removeAllListeners();
  }
}

module.exports = { Feed };
