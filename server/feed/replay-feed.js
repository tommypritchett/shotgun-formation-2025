/**
 * A recorded game, played back as though it were happening now.
 *
 * This is the piece that makes the feature testable on a Tuesday, so it is
 * written to be the DEFAULT way the system is exercised, not a stub:
 *
 *  - honours the real gaps between plays, so queue behaviour and the 45s
 *    broadcast delay are exercised against realistic spacing
 *  - `speed` multiplies the clock, so a three-hour game runs in ten minutes
 *  - `startAt` jumps into the game, so a test can begin at a two-minute drill
 *    instead of sitting through the opening kickoff
 *
 * Timing comes from the plays' own wallclock where ESPN provides it, and falls
 * back to a fixed gap where it does not — a fixture with no wallclock must
 * still replay rather than emitting everything at once.
 */

const { Feed } = require('./feed');

/** Used when a fixture has no wallclock to derive real spacing from. */
const DEFAULT_GAP_MS = 25_000;
/** No gap is longer than this, so halftime does not stall a test for a minute. */
const MAX_GAP_MS = 120_000;

const sortPlays = (plays) =>
  [...(Array.isArray(plays) ? plays : [])].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

/**
 * Real milliseconds between consecutive plays, from their wallclocks.
 * Returns null when the fixture has no usable timestamps.
 */
const gapsFromWallclock = (plays) => {
  const stamps = plays.map((p) => (p.wallclock ? Date.parse(p.wallclock) : NaN));
  if (stamps.some((s) => !Number.isFinite(s))) return null;
  return stamps.map((s, i) => (i === 0 ? 0 : Math.min(Math.max(s - stamps[i - 1], 0), MAX_GAP_MS)));
};

class ReplayFeed extends Feed {
  /**
   * @param {object} fixture  a captured game (see scripts/capture-fixture.mjs)
   * @param {object} [options]
   * @param {number} [options.speed=1]     20 replays twenty times faster
   * @param {number} [options.startAt=0]   index of the first play to emit
   * @param {Function} [options.setTimeout] injectable, so tests need no real clock
   */
  constructor(fixture, options = {}) {
    super({ league: fixture?.league || 'nfl', gameId: fixture?.gameId || null });
    this.fixture = fixture && typeof fixture === 'object' ? fixture : { plays: [], drives: [] };
    this.speed = Number(options.speed) > 0 ? Number(options.speed) : 1;
    this.startAt = Number.isInteger(options.startAt) ? Math.max(0, options.startAt) : 0;
    this._setTimeout = options.setTimeout || setTimeout;
    this._clearTimeout = options.clearTimeout || clearTimeout;

    this.plays = sortPlays(this.fixture.plays);
    this.gaps = gapsFromWallclock(this.plays);
    this.index = this.startAt;
    this.timer = null;
    /** Drives are emitted as their last play goes by. */
    this.drivesById = new Map(
      (this.fixture.drives || []).filter((d) => d && d.id).map((d) => [String(d.id), d])
    );
    this.emittedDrives = new Set();
  }

  /** Total plays available, so a caller can size a `startAt`. */
  get length() { return this.plays.length; }

  start() {
    if (this.started || this.stopped) return this;
    this.started = true;
    // An empty feed is a real case — a completed game ESPN carries no plays for.
    // It must end cleanly rather than hanging.
    if (this.index >= this.plays.length) {
      this._setTimeout(() => this.stop('no plays'), 0);
      return this;
    }
    this._schedule();
    return this;
  }

  _schedule() {
    if (this.stopped || this.index >= this.plays.length) {
      if (!this.stopped) this.stop('final');
      return;
    }
    const gap = this.gaps ? this.gaps[this.index] : (this.index === this.startAt ? 0 : DEFAULT_GAP_MS);
    const delay = Math.max(0, Math.round(gap / this.speed));
    this.timer = this._setTimeout(() => this._tick(), delay);
  }

  _tick() {
    if (this.stopped) return;
    const play = this.plays[this.index];
    this.index += 1;

    if (play) {
      this.emitPlay(play);
      this.emit('state', {
        period: play.period ?? null,
        clock: play.clock?.display ?? null,
        homeScore: play.homeScore ?? null,
        awayScore: play.awayScore ?? null,
        state: 'in',
      });

      // A drive's result is only meaningful once its plays have gone by, so it
      // is emitted when the next play belongs to a different drive.
      const next = this.plays[this.index];
      if (play.driveId && (!next || next.driveId !== play.driveId)) {
        const drive = this.drivesById.get(String(play.driveId));
        if (drive && !this.emittedDrives.has(drive.id)) {
          this.emittedDrives.add(drive.id);
          this.emit('drive', drive);
        }
      }
    }
    this._schedule();
  }

  stop(reason = 'stopped') {
    if (this.timer) this._clearTimeout(this.timer);
    this.timer = null;
    super.stop(reason);
  }
}

module.exports = { ReplayFeed, DEFAULT_GAP_MS, MAX_GAP_MS };
