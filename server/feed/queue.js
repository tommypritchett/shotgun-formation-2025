/**
 * The broadcast delay, and what happens to detections while they wait.
 *
 * ── Why the delay exists ──────────────────────────────────────────────────
 *
 * A data feed is near-real-time. Television is not. Measured at the 2026 Super
 * Bowl: antenna ~19s behind, cable ~38s, YouTube TV and Hulu ~53s. Firing on
 * detection announces the touchdown before anybody in the room has seen it,
 * which does not just spoil the play — it inverts the game. The drink is
 * supposed to be a reaction to something you all just watched.
 *
 * ── Why it is a constant and not a setting ────────────────────────────────
 *
 * The point of this whole feature is to take work off the Ref. Making them
 * configure a delay before kickoff hands it straight back. One number, tuned
 * centrally if real play says otherwise.
 *
 * **The failure modes are not symmetric.** Firing late means drinking a few
 * seconds after you saw the play, which nobody minds. Firing early spoils the
 * play, which is the thing that ruins the feature. So if this ever needs
 * moving, move it UP.
 *
 * A split room — people watching from different houses on different providers —
 * stays a known limitation. One number cannot be right for all of them.
 */

const { byPriority } = require('./cards');

/**
 * Zero. OWNER'S DECISION, 2026-09-03, on measured evidence.
 *
 * The original 45s assumed the feed was near-real-time and that all of the lag
 * had to be added by us. It is not. Measured against three live college games
 * on 2026-09-03, the gap between a play happening and it becoming visible in
 * ESPN's API was:
 *
 *   min 14.1s   median 28.5s   p90 161s
 *
 * So the feed already supplies most of a broadcast delay on its own. Adding 45s
 * on top produced a real end-to-end delay of roughly 78s — measured at the
 * table as "over a minute", which is exactly what it was.
 *
 * ── The arithmetic, written out, because it was chosen and not overlooked ──
 *
 * With nothing added, a call lands at roughly:
 *
 *     28.5s (median publish) + ~2.5s (mean wait on a 5s poll) = ~31s
 *
 * against the measured broadcast lag:
 *
 *     antenna ~19s   cable ~38s   YouTube TV / Hulu ~53s
 *
 * So the MEDIAN call now arrives about 7s before cable shows the play and
 * about 22s before a stream does. This is not merely a fast-tail risk: on
 * cable and on streams the typical call is early, and on the 14.1s publish
 * tail it can be ~20s early on cable and ~35s early on a stream. Only an
 * antenna is reliably ahead of it.
 *
 * **That is the accepted cost.** The owner chose zero with these numbers in
 * front of them, having felt the 78s version during a real game, and confirmed
 * it afterwards when the median-early consequence was spelled out. Being
 * consistently a few seconds early was judged the better failure than being a
 * minute late.
 *
 * **If this is revisited, do not just raise the constant.** A fixed number
 * cannot fit a publish lag that ranges 14s to 161s: whatever value makes the
 * median right makes the tails wrong in both directions. The honest fix is a
 * per-play adaptive delay — wait `TARGET - (now - play.wallclock)`, clamped to
 * [0, TARGET] — which lands every call at a constant offset regardless of how
 * fast ESPN published it. That needs a guard, because `wallclock` is not
 * monotonic (a captured fixture jumps backwards 3h11m at play 40), so a garbage
 * value must fall back to the constant rather than compute a negative wait.
 * See docs/LIVE_GAME_PLAN.md and tests/feed-timing-source.test.js.
 *
 * The env override exists so the tests can exercise THIS code path on a short
 * clock instead of keeping a second copy of the number, exactly as
 * ROOM_IDLE_TIMEOUT_MS does. It is not a Ref-facing setting and must never
 * become one: no per-room override, no provider picker, no calibration UI. The
 * Ref configures nothing.
 */
const BROADCAST_DELAY_MS = Number.isFinite(Number(process.env.BROADCAST_DELAY_MS))
  && process.env.BROADCAST_DELAY_MS !== undefined && process.env.BROADCAST_DELAY_MS !== ''
  ? Number(process.env.BROADCAST_DELAY_MS)
  : 0;

/**
 * How long a detection may wait for a busy room before it is given up on.
 *
 * A detection that comes due while a round is running used to be dropped on the
 * spot. First Down is ~40 of the ~70 calls in a game and its round is only six
 * seconds, so it was the card most often thrown away in a busy stretch —
 * measured at 82% fire rate under hurry-up pacing against 100% at a normal snap
 * pace.
 *
 * It now gets re-offered for a few seconds. Small on purpose: the delay exists
 * so a call lands as the play reaches the television, and a call that cannot
 * fire within a few seconds of its moment is still better lost than fired a
 * minute late. This is the "drop rather than fire late" rule, with just enough
 * slack to survive one short round.
 */
const MAX_LATE_MS = 8_000;

/**
 * Older than this at release time and it is dropped rather than fired late.
 * Calling a first down that happened two minutes ago is just confusing.
 */
const STALE_AFTER_MS = 90_000;

/**
 * How many detections may wait at once. Detections cluster — a scoring drive
 * can produce five first downs in ninety seconds — so the limit exists to stop
 * a backed-up room queueing the whole quarter.
 */
const MAX_QUEUE_DEPTH = 12;

/**
 * A queue of detections waiting out the broadcast delay.
 *
 * Deliberately not wired to anything that declares a card. This session fills
 * the queue, applies the delay, and reports what it WOULD have called; actually
 * declaring is Phase 3 and is one line at the release site. The value of
 * Phases 1 and 2 is being able to run this against real recorded games and read
 * what it would have done before it can affect anyone's night.
 */
class DetectionQueue {
  /**
   * @param {object} [options]
   * @param {number} [options.delayMs]
   * @param {number} [options.staleAfterMs]
   * @param {number} [options.maxDepth]
   * @param {Function} [options.now] injectable clock, so tests need no timers
   */
  constructor(options = {}) {
    this.delayMs = Number.isFinite(options.delayMs) ? options.delayMs : BROADCAST_DELAY_MS;
    this.staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : STALE_AFTER_MS;
    this.maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : MAX_QUEUE_DEPTH;
    this.now = options.now || (() => Date.now());
    this.maxLateMs = Number.isFinite(options.maxLateMs) ? options.maxLateMs : MAX_LATE_MS;
    this.items = [];
    this.stats = {
      queued: 0, released: 0, droppedStale: 0, droppedFull: 0, droppedLate: 0,
    };
  }

  get depth() { return this.items.length; }

  /**
   * Queue everything one play produced.
   *
   * Detections from a single play arrive already ordered bigger-event-first and
   * are queued in that order, so they run sequentially through the normal
   * single-round path. If the queue goes stale and drops something, what is
   * lost is the First Down rather than the Touchdown.
   *
   * @returns {{ queued: Array, droppedFull: Array }}
   */
  push(detections, at = this.now()) {
    const list = (Array.isArray(detections) ? detections : [detections])
      .filter((d) => d && d.cardId)
      .sort(byPriority);

    const queued = [];
    const droppedFull = [];
    for (const detection of list) {
      if (this.items.length >= this.maxDepth) {
        this.stats.droppedFull += 1;
        droppedFull.push(detection);
        continue;
      }
      const item = { ...detection, detectedAt: at, releaseAt: at + this.delayMs };
      this.items.push(item);
      this.stats.queued += 1;
      queued.push(item);
    }
    return { queued, droppedFull };
  }

  /**
   * Everything due at `at`, oldest first, with stale entries discarded.
   *
   * Returns them in the order they should RUN. The caller fires them one at a
   * time through the existing declaration path — no forked game loop, no
   * multi-card round.
   */
  release(at = this.now()) {
    const due = [];
    const stale = [];
    const waiting = [];

    for (const item of this.items) {
      if (item.releaseAt > at) { waiting.push(item); continue; }
      if (at - item.detectedAt > this.staleAfterMs) { stale.push(item); continue; }
      due.push(item);
    }

    this.items = waiting;
    this.stats.released += due.length;
    this.stats.droppedStale += stale.length;

    // Oldest first so the game is retold in the order it happened; within one
    // instant, bigger event first.
    due.sort((a, b) => a.detectedAt - b.detectedAt || byPriority(a, b));
    return { due, stale };
  }

  /**
   * The room could not take this one yet — a round was already running.
   *
   * Put it back if it is still close enough to its intended moment, otherwise
   * give up on it and say so. Returns whether it was held.
   *
   * `releaseAt` is left untouched so the item is due again on the very next
   * tick; the grace window is measured from that original moment, so retrying
   * can never walk the deadline forward one tick at a time.
   */
  retry(detection, at = this.now()) {
    if (!detection || !detection.cardId) return false;
    const releaseAt = Number.isFinite(detection.releaseAt)
      ? detection.releaseAt : at;
    if (at - releaseAt > this.maxLateMs) {
      this.stats.droppedLate += 1;
      return false;
    }
    if (this.items.length >= this.maxDepth) {
      this.stats.droppedLate += 1;
      return false;
    }
    this.items.push({ ...detection, releaseAt });
    // It was counted on the way out; it must not be counted twice on the way
    // back in, or the Ref's "released" number climbs on retries alone.
    this.stats.released -= 1;
    return true;
  }

  /**
   * The Ref took over. A manual declaration wins and clears what was waiting,
   * so the table is never told about a play the Ref has already moved past.
   */
  clear(reason = 'manual declaration') {
    const dropped = this.items.length;
    this.items = [];
    return { dropped, reason };
  }

  /** What the Ref is shown. A room constantly backed up should be visible. */
  snapshot() {
    return { depth: this.items.length, ...this.stats };
  }
}

module.exports = {
  DetectionQueue,
  BROADCAST_DELAY_MS,
  STALE_AFTER_MS,
  MAX_QUEUE_DEPTH,
  MAX_LATE_MS,
};
