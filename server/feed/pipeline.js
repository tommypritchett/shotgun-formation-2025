/**
 * feed -> detector -> queue, and what the room is told.
 *
 * ⚠️ NOTHING HERE DECLARES A CARD. Deliberately, and it is one line to change.
 *
 * The value of Phases 1 and 2 is being able to run this against real recorded
 * games, repeatedly, and read what it WOULD have done before it can affect
 * anyone's night. Wiring the declaration in at the same time destroys that. The
 * release step calls `onRelease`, and in this session the only thing the server
 * passes is a broadcast that says "this is what I would have called".
 *
 * Phase 3 replaces that callback with the Ref's own declaration path — the same
 * `isActionInProgress` guard, the same round lifecycle, the same finalizeRound.
 * Not a parallel one. This codebase has been bitten repeatedly by two paths that
 * were meant to do the same thing.
 */

const { detectPlay, detectDrive } = require('./detect');
const { DetectionQueue } = require('./queue');
const { modeFor, AUTO } = require('./cards');

/** How often the queue is checked for anything due. */
const RELEASE_TICK_MS = 1_000;

/**
 * Attach a detector and a queue to a feed.
 *
 * @param {object} feed      anything implementing the Feed interface
 * @param {object} handlers
 * @param {Function} handlers.onDetected  (detections, play) — immediately, for the log
 * @param {Function} handlers.onRelease   (detection) — after the broadcast delay
 * @param {Function} handlers.onState     (state) — score/period/clock for the header
 * @param {object} [options]
 */
const runPipeline = (feed, handlers = {}, options = {}) => {
  const {
    onDetected = () => {}, onRelease = () => {}, onState = () => {}, onEnd = () => {},
  } = handlers;

  const queue = new DetectionQueue(options.queue);
  const league = feed.league || 'nfl';
  const setT = options.setInterval || setInterval;
  const clearT = options.clearInterval || clearInterval;

  let previous = null;

  const handle = (detections, play) => {
    if (!detections.length) return;
    // Carry ESPN's own one-line summary of the play — "Tyler Allgeier 1 Yd
    // Rush", "Michael Penix Jr. Pass Complete for 13 Yds to Drake London". The
    // detector's `reason` is built for logs and reads like a type name; this
    // reads like football, and it is what the room is shown when the round
    // starts, so they know WHY they are drinking.
    const summary = play && typeof play.shortText === 'string' ? play.shortText.trim() : null;
    if (summary) detections.forEach((d) => { d.summary = summary; });
    // Suggestions are not queued: they go to the Ref now, with the same delay
    // applied by the client's countdown rather than held server-side.
    const auto = detections.filter((d) => modeFor(d.cardId) === AUTO);
    onDetected(detections, play);
    if (auto.length) queue.push(auto);
  };

  feed.on('play', (play) => {
    let found = [];
    try {
      found = detectPlay(play, { previous, league });
    } catch (error) {
      // A detector throw must never take the feed with it.
      console.error(`🏈 detector threw on play ${play?.id}: ${error?.message}`);
    }
    previous = play;
    handle(found, play);
  });

  feed.on('drive', (drive) => {
    let found = [];
    try {
      found = detectDrive(drive);
    } catch (error) {
      console.error(`🏈 detector threw on drive ${drive?.id}: ${error?.message}`);
    }
    handle(found, null);
  });

  feed.on('state', onState);
  feed.on('error', () => {});   // already logged in the feed; must not be fatal

  let ended = false;
  let endInfo = null;

  const tick = setT(() => {
    const { due } = queue.release();
    // One at a time, in order. The caller runs them sequentially through the
    // normal single-round path; there is no multi-card round.
    //
    // A handler that returns `false` is saying "every room that wanted this was
    // mid-round". That used to lose the call outright, which fell hardest on
    // First Down — the most common card and the shortest round. It now goes
    // back on the queue for a few seconds and is re-offered next tick;
    // `queue.retry` gives up on anything past its grace window, so this can
    // never turn into firing a minute late.
    for (const detection of due) {
      const took = onRelease(detection);
      // Never hold anything back once the feed has ended. At that point the
      // queue is draining a game that has stopped, and re-offering a call the
      // room was too busy for only delays letting go of the room.
      if (took === false && !ended) queue.retry(detection);
    }

    // The feed ending does NOT mean the queue is empty. At the final whistle
    // there can still be a broadcast delay's worth of detections waiting, and
    // the room has not seen those plays on television yet. Keep releasing until
    // the queue drains, then stop.
    if (ended && queue.depth === 0) {
      clearT(tick);
      onEnd(endInfo);
    }
  }, options.tickMs || RELEASE_TICK_MS);
  if (tick && typeof tick.unref === 'function') tick.unref();

  feed.on('end', (info) => {
    ended = true;
    endInfo = info;
    // If nothing is waiting, finish immediately; otherwise the tick above does.
    if (queue.depth === 0) {
      clearT(tick);
      onEnd(info);
    }
  });

  return {
    queue,
    stop() {
      clearT(tick);
      if (typeof feed.stop === 'function') feed.stop('pipeline stopped');
    },
  };
};

module.exports = { runPipeline, RELEASE_TICK_MS };
