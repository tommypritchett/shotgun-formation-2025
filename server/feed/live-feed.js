/**
 * ESPN, polled. The only place in the server that talks to the outside world.
 *
 * `league` is a parameter, not a second integration: `nfl` and
 * `college-football` share the host, the shapes and this code path.
 *
 * These endpoints are undocumented and unversioned. ESPN can rename a field
 * mid-season, so every failure here degrades to "no detections" plus a loud log
 * line, and never to a crash or a wrong call. A Ref can always still call
 * everything by hand.
 */

const { Feed } = require('./feed');
const { normalisePlay, normaliseDrive } = require('./normalise');

const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football';

/** Fast enough to feel live, slow enough to be a polite guest. */
const POLL_INTERVAL_MS = 5_000;
/** Back off hard on errors rather than hammering a service that is unwell. */
const BACKOFF_START_MS = 10_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** Give up on a game that has errored this many times in a row. */
const MAX_CONSECUTIVE_ERRORS = 20;
const REQUEST_TIMEOUT_MS = 10_000;

const fetchJSON = async (url, { timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

class LiveFeed extends Feed {
  constructor({ league = 'nfl', gameId, fetchImpl = fetch, intervalMs = POLL_INTERVAL_MS,
    setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout } = {}) {
    super({ league, gameId });
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this._setTimeout = setT;
    this._clearTimeout = clearT;
    this.timer = null;
    this.consecutiveErrors = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.seenDrives = new Set();
    this.polls = 0;
  }

  get playsUrl() {
    return `${CORE}/${this.league}/events/${this.gameId}/competitions/${this.gameId}/plays?limit=400`;
  }

  get drivesUrl() {
    return `${CORE}/${this.league}/events/${this.gameId}/competitions/${this.gameId}/drives?limit=200`;
  }

  get summaryUrl() {
    return `${SITE}/${this.league}/summary?event=${this.gameId}`;
  }

  start() {
    if (this.started || this.stopped) return this;
    if (!this.gameId) {
      this.emit('error', new Error('LiveFeed needs a gameId'));
      return this;
    }
    this.started = true;
    this._poll();
    return this;
  }

  async _poll() {
    if (this.stopped) return;
    this.polls += 1;
    let ok = false;

    try {
      const playsRaw = await fetchJSON(this.playsUrl, { fetchImpl: this.fetchImpl });
      const items = Array.isArray(playsRaw?.items) ? playsRaw.items : [];
      const plays = items.map(normalisePlay).filter(Boolean)
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

      // Dedupe is in Feed.emitPlay, keyed on ESPN's own play id, so a play
      // fires once ever no matter how many times it appears in a poll.
      for (const play of plays) this.emitPlay(play);

      const last = plays[plays.length - 1];
      if (last) {
        this.emit('state', {
          period: last.period ?? null,
          clock: last.clock?.display ?? null,
          homeScore: last.homeScore ?? null,
          awayScore: last.awayScore ?? null,
          state: 'in',
        });
      }
      ok = true;
    } catch (error) {
      this._onError(error, 'plays');
    }

    // Drives are secondary: 3-and-out and turnover-on-downs live here, but a
    // drives failure must not stop plays from being polled.
    if (ok) {
      try {
        const drivesRaw = await fetchJSON(this.drivesUrl, { fetchImpl: this.fetchImpl });
        const drives = (Array.isArray(drivesRaw?.items) ? drivesRaw.items : [])
          .map(normaliseDrive).filter(Boolean);
        for (const drive of drives) {
          // A drive is only worth emitting once its result is known and final.
          if (!drive.displayResult || this.seenDrives.has(drive.id)) continue;
          this.seenDrives.add(drive.id);
          this.emit('drive', drive);
        }
      } catch (error) {
        this._onError(error, 'drives');
      }
    }

    if (ok) {
      this.consecutiveErrors = 0;
      this.backoffMs = BACKOFF_START_MS;
    }

    if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`🏈 giving up on ${this.league}/${this.gameId} after ${this.consecutiveErrors} consecutive errors`);
      this.stop('feed unavailable');
      return;
    }

    const wait = ok ? this.intervalMs : this.backoffMs;
    if (!ok) this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    if (!this.stopped) this.timer = this._setTimeout(() => this._poll(), wait);
  }

  _onError(error, what) {
    this.consecutiveErrors += 1;
    // Loud, with the game named, so a missed call is diagnosable on Monday.
    console.error(`🏈 feed error (${what}) for ${this.league}/${this.gameId}: ${error?.message || error}`);
    this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }

  stop(reason = 'stopped') {
    if (this.timer) this._clearTimeout(this.timer);
    this.timer = null;
    super.stop(reason);
  }
}

/**
 * The `groups` a league needs on the scoreboard call, when the caller does not
 * name one.
 *
 * College MUST send it. Asked without `groups`, ESPN's college scoreboard
 * returns only games involving a ranked team — so the picker showed a
 * ranked-only slate and unchecking "Ranked only" revealed nothing, because the
 * list had already been narrowed upstream. Measured against the real endpoint
 * on 2026-09-03:
 *
 *   (no groups)        25 events — 25 ranked, 0 unranked
 *   groups=80 (FBS)    99 events — 25 ranked, 74 unranked
 *   groups=50          0 events  (the value the plan suggested)
 *
 * The NFL must NOT send it: `nfl/scoreboard?groups=80` returns 0 events, which
 * would empty the picker on a Sunday. Hence a per-league map rather than one
 * constant.
 *
 * FCS is 81 and stays reachable by passing `groups` explicitly.
 */
const DEFAULT_GROUPS = { 'college-football': '80' };

/** Today's games, for the picker. Shape-tolerant: a bad row is skipped. */
const listGames = async (league, { date = null, fetchImpl = fetch, groups = null } = {}) => {
  const params = new URLSearchParams({ limit: '500' });
  if (date) params.set('dates', date);
  const useGroups = groups || DEFAULT_GROUPS[league] || null;
  if (useGroups) params.set('groups', String(useGroups));

  const raw = await fetchJSON(`${SITE}/${league}/scoreboard?${params}`, { fetchImpl });
  const events = Array.isArray(raw?.events) ? raw.events : [];

  return events.map((event) => {
    const comp = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const team = (side) => {
      const c = competitors.find((x) => x?.homeAway === side) || {};
      return {
        abbreviation: c.team?.abbreviation ?? null,
        displayName: c.team?.displayName ?? c.team?.name ?? null,
        score: Number.isFinite(Number(c.score)) ? Number(c.score) : null,
        rank: Number.isFinite(Number(c.curatedRank?.current)) && Number(c.curatedRank.current) < 26
          ? Number(c.curatedRank.current) : null,
      };
    };
    const status = event?.status?.type ?? {};
    return {
      id: event?.id ? String(event.id) : null,
      league,
      name: event?.shortName ?? event?.name ?? null,
      // Kickoff, ISO. The picker orders not-yet-started games by this, so a
      // Ref at a bar sees the next kickoff first rather than an alphabet.
      date: event?.date ?? null,
      home: team('home'),
      away: team('away'),
      period: Number.isFinite(Number(event?.status?.period)) ? Number(event.status.period) : null,
      clock: event?.status?.displayClock ?? null,
      state: status.state ?? null,          // 'pre' | 'in' | 'post'
      started: status.state === 'in' || status.state === 'post',
      completed: status.completed === true,
      detail: status.shortDetail ?? null,
    };
  }).filter((g) => g.id);
};

module.exports = {
  LiveFeed, listGames, fetchJSON, DEFAULT_GROUPS,
  POLL_INTERVAL_MS, BACKOFF_START_MS, BACKOFF_MAX_MS, MAX_CONSECUTIVE_ERRORS,
};
