/**
 * ESPN's shapes stop here.
 *
 * These endpoints are undocumented and unversioned. A field can be renamed
 * mid-season, so every read is optional and every failure degrades to `null`
 * rather than throwing. Nothing downstream — the detector, the queue, the
 * socket layer — ever sees an ESPN object, which means a shape change is a
 * quiet loss of detections and a Ref who can still call everything by hand.
 *
 * Deliberately not a class and deliberately pure: fixtures are captured through
 * these same functions, so what the tests assert against is what the live poller
 * produces.
 *
 * CommonJS, because `server.js` is CommonJS and requires this directly. Adding
 * `"type": "module"` to package.json to make this ESM would break the server.
 */

/** Number, or null. Never NaN, never undefined, never a string. */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const str = (value) => (typeof value === 'string' && value.trim() ? value : null);

/**
 * ESPN references teams by URL rather than by id:
 *   .../seasons/2025/teams/29?lang=en
 * The id is the only part that matters and it is stable within a game.
 */
const teamIdFromRef = (ref) => {
  const url = ref && typeof ref === 'object' ? ref.$ref : ref;
  if (typeof url !== 'string') return null;
  const match = url.match(/\/teams\/(\d+)/);
  return match ? match[1] : null;
};

/** Pull the numeric tail off any core-API $ref (drives, plays). */
const idFromRef = (ref) => {
  const url = ref && typeof ref === 'object' ? ref.$ref : ref;
  if (typeof url !== 'string') return null;
  const match = url.match(/\/(\d+)(?:\?|$)/);
  return match ? match[1] : null;
};

const side = (raw) => {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    down: num(s.down),
    distance: num(s.distance),
    yardsToEndzone: num(s.yardsToEndzone),
    teamId: teamIdFromRef(s.team),
  };
};

/**
 * One play, normalised.
 *
 * Returns null for anything without an id — an unidentifiable play cannot be
 * deduped, and a play that fires twice is worse than one that never fires.
 */
const normalisePlay = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id) || (raw.id != null ? String(raw.id) : null);
  if (!id) return null;

  const type = raw.type && typeof raw.type === 'object' ? raw.type : {};
  const clock = raw.clock && typeof raw.clock === 'object' ? raw.clock : {};
  const period = raw.period && typeof raw.period === 'object' ? raw.period : {};

  return {
    id,
    // The array is NOT ordered by sequenceNumber — an Official Timeout can be
    // listed before the touchdown it followed. Everything downstream sorts on
    // this, so it must be a number.
    sequence: num(raw.sequenceNumber) ?? 0,
    period: num(period.number),
    clock: { seconds: num(clock.value), display: str(clock.displayValue) },
    typeId: str(type.id) || (type.id != null ? String(type.id) : null),
    typeText: str(type.text),
    text: str(raw.text) || str(raw.alternativeText),
    shortText: str(raw.shortText),
    awayScore: num(raw.awayScore),
    homeScore: num(raw.homeScore),
    scoreValue: num(raw.scoreValue),
    scoringPlay: raw.scoringPlay === true,
    yards: num(raw.statYardage),
    isPenalty: raw.isPenalty === true,
    isTurnover: raw.isTurnover === true,
    start: side(raw.start),
    end: side(raw.end),
    teamId: teamIdFromRef(raw.team),
    driveId: idFromRef(raw.drive),
    wallclock: str(raw.wallclock),
  };
};

/** One drive, normalised. Drive-level is what 3-and-out needs. */
const normaliseDrive = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id) || (raw.id != null ? String(raw.id) : null);
  if (!id) return null;

  return {
    id,
    sequence: num(raw.sequenceNumber) ?? 0,
    teamId: teamIdFromRef(raw.team),
    endTeamId: teamIdFromRef(raw.endTeam),
    result: str(raw.result),
    displayResult: str(raw.displayResult) || str(raw.shortDisplayResult),
    isScore: raw.isScore === true,
    offensivePlays: num(raw.offensivePlays),
    yards: num(raw.yards),
    description: str(raw.description),
  };
};

module.exports = { normalisePlay, normaliseDrive, teamIdFromRef };
