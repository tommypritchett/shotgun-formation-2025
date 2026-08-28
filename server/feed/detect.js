/**
 * The detector. Plays in, cards out. Pure.
 *
 * No sockets, no timers, no server state — the whole point is that a recorded
 * game can be run through this a thousand times on a Tuesday. Football happens
 * two days a week; a detector you can only exercise on a Sunday gets debugged
 * in front of ten people who are drinking.
 *
 * ── What ESPN resolves for us, and what it does not ────────────────────────
 *
 * A penalty frequently cancels what happened on the play. Three separate
 * signals, and they are not equally trustworthy:
 *
 *  1. `isTurnover`, `scoringPlay`, `scoreValue` are ALREADY post-enforcement.
 *     A pass intercepted and then wiped out by roughing the passer arrives with
 *     `isTurnover: false`. Verified in fixtures. Trust them; do not re-derive.
 *  2. `start`/`end` down and distance are ALSO post-enforcement, in BOTH
 *     leagues. A 3rd-and-11 completion for 11 yards negated by holding arrives
 *     as `3-11 -> 3-21`. So deriving First Down from the down itself is
 *     inherently negation-aware, and needs no text parsing at all. This is the
 *     most reliable signal in the feed.
 *  3. `statYardage` is NOT a gain from scrimmage when a penalty was accepted —
 *     it is the enforcement. A 20-yard pass interference on an INCOMPLETE pass
 *     arrives with `yards: 20`, which a naive rule reads as Big Play 20+. Real
 *     example, IND/ATL. So yardage-derived cards are suppressed whenever the
 *     play was negated.
 *
 * The negation marker is the literal text "No Play" (NFL: `- No Play.`;
 * college: trailing `NO PLAY`). Present in both, but text is the weakest signal
 * available, so it is used ONLY to suppress, never to fire.
 */

const {
  BIG_PLAY_YARDS, HUGE_PLAY_YARDS, modeFor, byPriority, NEVER,
} = require('./cards');

/** Confidence bands, so a suggestion can be ranked in the UI later. */
const HIGH = 'high';
const MEDIUM = 'medium';

const text = (play) => (play && typeof play.text === 'string' ? play.text : '');
const lower = (play) => text(play).toLowerCase();

/**
 * Did a penalty wipe this play out?
 *
 * Used only to suppress yardage-derived cards. Down/distance and the scoring
 * flags are already enforced by ESPN, so they need no help from this.
 */
const isNegated = (play) => /\bno play\b/i.test(text(play));

/** Offsetting penalties: the down is replayed and nothing stands. */
const isOffsetting = (play) => /\boffsetting\b/i.test(text(play));

/**
 * A new set of downs for the SAME team.
 *
 * Same-team matters: a punt, a turnover or a kickoff also produces a 1st down,
 * but for the other side, and that is not a First Down card.
 */
const gainedFirstDown = (play) => {
  const { start, end } = play;
  if (!start || !end) return false;
  if (end.down !== 1) return false;
  if (start.down === null || start.down < 1) return false;   // kickoffs, PATs
  if (!start.teamId || !end.teamId) return false;
  return start.teamId === end.teamId;
};

const typeIs = (play, ...names) => {
  const t = (play.typeText || '').toLowerCase();
  return names.some((n) => t === n.toLowerCase());
};
const typeHas = (play, ...fragments) => {
  const t = (play.typeText || '').toLowerCase();
  return fragments.some((f) => t.includes(f.toLowerCase()));
};

/** A detection. `reason` is what gets logged so a missed call is diagnosable. */
const card = (cardId, playId, reason, confidence = HIGH) => ({
  cardId, playId, reason, confidence, mode: modeFor(cardId),
});

/**
 * Everything one play is worth.
 *
 * @param {object} play      normalised play (see normalise.js)
 * @param {object} [context] { previous, drive, league }
 * @returns {Array} detections, ordered bigger-event-first, negation applied
 */
const detectPlay = (play, context = {}) => {
  if (!play || typeof play !== 'object' || !play.id) return [];

  const { previous = null, drive = null, league = 'nfl' } = context;
  const out = [];
  const t = lower(play);
  const negated = isNegated(play) || isOffsetting(play);
  const add = (...args) => out.push(card(...args));

  // ── scoring ──────────────────────────────────────────────────────────────
  // `scoringPlay` and `scoreValue` are post-enforcement, so a called-back
  // touchdown never reaches here as a Touchdown.
  const scoringType = (play.typeText || '').toLowerCase();

  if (play.scoringPlay) {
    if (scoringType.includes('touchdown')) {
      if (t.includes('interception return') || t.includes('fumble return')
          || scoringType.includes('interception return touchdown')
          || scoringType.includes('fumble return touchdown')) {
        add('Defensive TD', play.id, `defensive score: ${play.typeText}`);
      } else if (scoringType.includes('kickoff return') || scoringType.includes('punt return')
                 || t.includes('kickoff return') || t.includes('punt return')) {
        add('Special Teams TD', play.id, `return score: ${play.typeText}`);
      } else {
        add('Touchdown', play.id, `${play.typeText} (${play.scoreValue ?? 6})`);
      }
    } else if (scoringType.includes('field goal')) {
      add('Field Goal', play.id, play.typeText);
    } else if (scoringType.includes('safety')) {
      add('Safety', play.id, play.typeText);
    }
  }

  // The two-point try is NOT a play of its own. It is appended to the
  // touchdown's text, and the play still carries `scoreValue: 6` for the
  // touchdown — so a `scoreValue === 2` rule never fires. The only reliable
  // signal is ESPN's own wording:
  //
  //   "...TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ... ATTEMPT SUCCEEDS."
  //   "...TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ... ATTEMPT FAILS."
  //
  // Only a SUCCEEDED try is a card; a failed one is just a missed conversion.
  if (/two-point conversion/i.test(text(play)) && /\battempt succeeds\b/i.test(text(play))) {
    add('2 PT Conversion', play.id, 'two-point conversion succeeded');
  }

  // ── misses and blocks ────────────────────────────────────────────────────
  if (typeHas(play, 'field goal missed') || /field goal is no good|no good/i.test(t)) {
    if (typeHas(play, 'field goal')) add('Missed FG', play.id, play.typeText || 'field goal no good');
  }
  if (typeHas(play, 'extra point missed', 'pat missed')
      || /extra point is no good|extra point failed/i.test(t)) {
    add('Missed PAT', play.id, play.typeText || 'extra point no good');
  }
  if (typeHas(play, 'blocked') || /\bblocked\b/i.test(t)) {
    add('Blocked Kicks', play.id, play.typeText || 'blocked kick', MEDIUM);
  }

  // ── turnovers ────────────────────────────────────────────────────────────
  // Already post-enforcement, so a negated interception does not appear here.
  //
  // Turnover ON DOWNS is deliberately NOT handled here: a failed fourth down is
  // an ordinary incompletion or short run at play level, with `isTurnover`
  // false and nothing in the text to distinguish it. It is only visible as a
  // drive result. See detectDrive. Matching the word "downs" in play text finds
  // players called Downs, which is how this would have gone wrong.
  if (play.isTurnover && !out.some((c) => c.cardId === 'Defensive TD')) {
    add('Turnover', play.id, play.typeText || 'turnover');
  }

  // ── sacks ────────────────────────────────────────────────────────────────
  if (typeIs(play, 'sack') || (typeHas(play, 'sack') && !negated)) {
    if (!negated) add('Sacks', play.id, play.typeText || 'sack');
  }

  // ── yardage ──────────────────────────────────────────────────────────────
  // Suppressed on a negated play: `statYardage` is then the penalty's
  // enforcement, not a gain. A 20-yard DPI on an incomplete pass would
  // otherwise read as Big Play 20+.
  if (!negated && typeof play.yards === 'number' && !play.isPenalty) {
    if (play.yards >= HUGE_PLAY_YARDS) {
      add('Big Play 50+', play.id, `${play.yards} yards`);
    } else if (play.yards >= BIG_PLAY_YARDS) {
      add('Big Play 20+', play.id, `${play.yards} yards`);
    }
  }

  // ── penalty ──────────────────────────────────────────────────────────────
  // `isPenalty` is false for a DECLINED penalty, which is what we want: a
  // declined flag changes nothing, so there is nothing to drink to.
  if (play.isPenalty) {
    add('Penalty', play.id, 'accepted penalty');
  }

  // A touchdown wiped out by a penalty. Sequence reasoning, and the most
  // likely of the Tier B set to misfire — hence suggest, never auto.
  if (play.isPenalty && negated && /touchdown/i.test(t)) {
    add('Penalty Calls TD Back', play.id, 'touchdown negated by penalty', MEDIUM);
  }

  // ── first down ───────────────────────────────────────────────────────────
  // Down/distance is post-enforcement, so a first down wiped out by holding
  // simply never appears. No suppression needed and none applied.
  if (gainedFirstDown(play)) {
    add('First Down', play.id, `${play.start.down}-${play.start.distance} to 1st`);
  }

  // ── special teams oddities (Tier B) ──────────────────────────────────────
  if (/onside/i.test(t)) {
    if (/recovered by/i.test(t) && /onside/i.test(t)) {
      add('Onside Recovered', play.id, 'onside kick recovered', MEDIUM);
    }
    add('Onside Attempt', play.id, 'onside kick attempt', MEDIUM);
  }
  if (/\bfake (punt|field goal|fg)\b/i.test(t)) {
    add('Fake Punt/FG', play.id, 'fake kick', MEDIUM);
  }

  // Ejections. NFL reporting is inconsistent to absent; college targeting is a
  // formal, reviewed, named foul that lands in the play text, so it is only
  // offered there.
  if (league === 'college-football' && /targeting/i.test(t) && /(disqualif|eject)/i.test(t)) {
    add('Disqualified', play.id, 'targeting with ejection', MEDIUM);
  }

  void previous;
  void drive;

  // Never machine-call Tier C, whatever the text looked like.
  const allowed = out.filter((c) => modeFor(c.cardId) !== NEVER);

  // Deduplicate by card, keeping the first reason, then order deterministically
  // so a stale drop loses the first down rather than the touchdown.
  const seen = new Set();
  return allowed.filter((c) => {
    if (seen.has(c.cardId)) return false;
    seen.add(c.cardId);
    return true;
  }).sort(byPriority);
};

/**
 * Drive-level detection.
 *
 * Two cards only exist at this level:
 *
 *  - **3 n Out** — three offensive plays, ends in a punt. Suggested rather than
 *    auto-called because a penalty inside the drive makes the play count lie.
 *  - **Turnover on Downs** — a failed fourth down is indistinguishable from an
 *    ordinary incompletion at play level; the drive result is the only place it
 *    is named. Auto, like the other turnovers.
 */
const detectDrive = (drive) => {
  if (!drive || typeof drive !== 'object' || !drive.id) return [];
  const result = (drive.displayResult || drive.result || '').toLowerCase();
  const found = [];

  if (result === 'downs' || result.includes('on downs')) {
    found.push(card('Turnover on Downs', `drive-${drive.id}`, 'drive ended on downs'));
  }
  if (drive.offensivePlays === 3 && result.includes('punt')) {
    found.push(card('3 n Out', `drive-${drive.id}`, '3 offensive plays, punt', MEDIUM));
  }
  return found.sort(byPriority);
};

/**
 * Run a whole game through the detector, in play order.
 *
 * The plays array is NOT ordered by sequence as it arrives from ESPN — an
 * Official Timeout can be listed before the touchdown it followed — so this
 * sorts before walking.
 */
const detectGame = (fixture) => {
  if (!fixture || typeof fixture !== 'object') return [];
  const league = fixture.league || 'nfl';
  const plays = Array.isArray(fixture.plays) ? [...fixture.plays] : [];
  plays.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  const detections = [];
  let previous = null;
  for (const play of plays) {
    for (const found of detectPlay(play, { previous, league })) {
      detections.push({ ...found, sequence: play.sequence, period: play.period });
    }
    previous = play;
  }
  for (const drive of Array.isArray(fixture.drives) ? fixture.drives : []) {
    for (const found of detectDrive(drive)) {
      detections.push({ ...found, sequence: null, period: null });
    }
  }
  return detections;
};

module.exports = {
  detectPlay, detectDrive, detectGame,
  isNegated, isOffsetting, gainedFirstDown,
  HIGH, MEDIUM,
};
