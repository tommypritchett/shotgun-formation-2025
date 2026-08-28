/**
 * One poller per GAME, not per room.
 *
 * Eight rooms watching the Chiefs share one subscription. The registry is
 * refcounted by room: the poller starts when the first room attaches and stops
 * when the last one detaches — including when that "detach" is the Session 14
 * reaper closing an idle room, which is why `releaseAllForRoom` exists and why
 * `purgeRoomState` calls it.
 *
 * State lives here rather than inside the feed so that a feed can be swapped
 * (replay for live) without the rooms noticing.
 */

/** Detections held for release, and the counters the Ref is shown. */
const emptyStats = () => ({
  detected: 0, released: 0, droppedStale: 0, droppedFull: 0, suggested: 0,
});

class Watchers {
  constructor({ createFeed } = {}) {
    /** key -> { key, league, gameId, feed, rooms:Set, state, stats, queue } */
    this.games = new Map();
    /** roomCode -> key */
    this.byRoom = new Map();
    this.createFeed = createFeed;
  }

  static key(league, gameId) { return `${league}:${gameId}`; }

  get(league, gameId) { return this.games.get(Watchers.key(league, gameId)) || null; }

  forRoom(roomCode) {
    const key = this.byRoom.get(roomCode);
    return key ? this.games.get(key) || null : null;
  }

  /** Every room watching this game. */
  roomsWatching(league, gameId) {
    const entry = this.get(league, gameId);
    return entry ? [...entry.rooms] : [];
  }

  /**
   * Attach a room. Creates the feed on the first room and reuses it after.
   * A room may watch only one game, so attaching elsewhere detaches first.
   */
  attach(roomCode, league, gameId, options = {}) {
    if (!roomCode || !league || !gameId) return null;
    const existing = this.forRoom(roomCode);
    const key = Watchers.key(league, gameId);
    if (existing && existing.key !== key) this.release(roomCode);

    let entry = this.games.get(key);
    if (!entry) {
      entry = {
        key, league, gameId: String(gameId),
        feed: null, rooms: new Set(),
        state: { period: null, clock: null, homeScore: null, awayScore: null, status: null },
        stats: emptyStats(),
        queue: [],
      };
      this.games.set(key, entry);
      if (typeof this.createFeed === 'function') {
        entry.feed = this.createFeed({ league, gameId, entry, ...options });
      }
    }
    entry.rooms.add(roomCode);
    this.byRoom.set(roomCode, key);
    return entry;
  }

  /**
   * Detach a room. Stops the poller when the last room leaves — a game nobody
   * is watching must not keep an instance awake.
   */
  release(roomCode) {
    const key = this.byRoom.get(roomCode);
    if (!key) return false;
    this.byRoom.delete(roomCode);

    const entry = this.games.get(key);
    if (!entry) return false;
    entry.rooms.delete(roomCode);
    if (entry.rooms.size === 0) {
      if (entry.feed && typeof entry.feed.stop === 'function') entry.feed.stop('no rooms watching');
      this.games.delete(key);
    }
    return true;
  }

  /** Teardown seam: a reaped room cannot leave a poller running. */
  releaseAllForRoom(roomCode) { return this.release(roomCode); }

  /** Stop everything. Used at shutdown and by tests. */
  stopAll(reason = 'shutting down') {
    for (const entry of this.games.values()) {
      if (entry.feed && typeof entry.feed.stop === 'function') entry.feed.stop(reason);
    }
    this.games.clear();
    this.byRoom.clear();
  }

  get size() { return this.games.size; }
}

module.exports = { Watchers, emptyStats };
