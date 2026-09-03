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
 * 45s: seven seconds past cable, a little early for YouTube TV, generous for an
 * antenna.
 *
 * The env override exists so the tests can exercise THIS code path on a short
 * clock instead of keeping a second copy of the number, exactly as
 * ROOM_IDLE_TIMEOUT_MS does. It is not a Ref-facing setting and must never
 * become one: no per-room override, no provider picker, no calibration UI. The
 * Ref configures nothing.
 */
const BROADCAST_DELAY_MS = Number(process.env.BROADCAST_DELAY_MS) || 45_000;

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
    this.items = [];
    this.stats = { queued: 0, released: 0, droppedStale: 0, droppedFull: 0 };
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
};
