/**
 * The detector, card by card, in both directions.
 *
 * Every card that fires must also be shown NOT to fire on its near miss — a
 * 19-yard gain is not Big Play 20+, a touchdown called back is not a Touchdown.
 * One-directional tests on a detector are close to worthless: it is trivial to
 * write a rule that fires on everything and passes every "does it fire" test.
 *
 * The plays here are hand-built minimal objects, so each test names exactly the
 * field it depends on. Whole-game behaviour lives in detector-fixtures.test.js.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay, detectDrive } = require(path.join(ROOT, 'server/feed/detect.js'));
const { MODES, modeFor, AUTO, SUGGEST, NEVER } = require(path.join(ROOT, 'server/feed/cards.js'));

/** A play with every field present and nothing interesting happening. */
const play = (over = {}) => ({
  id: 'p1', sequence: 100, period: 1,
  clock: { seconds: 600, display: '10:00' },
  typeId: '5', typeText: 'Rush', text: 'A.Runner up the middle for 3 yards.',
  shortText: null, awayScore: 0, homeScore: 0, scoreValue: 0, scoringPlay: false,
  yards: 3, isPenalty: false, isTurnover: false,
  start: { down: 1, distance: 10, yardsToEndzone: 60, teamId: '1' },
  end: { down: 2, distance: 7, yardsToEndzone: 57, teamId: '1' },
  teamId: '1', driveId: 'd1', wallclock: null,
  ...over,
});

const ids = (detections) => detections.map((d) => d.cardId);
const detect = (over, context) => detectPlay(play(over), context);

describe('card ids match the client deck exactly', () => {
  // These ids are the wire value. `Sacks` plural, `Blocked Kicks` plural,
  // `Fake Punt/FG` with no spaces. A mismatch fails silently, which is why this
  // reads the real file rather than a copy.
  const source = fs.readFileSync(path.join(ROOT, 'client/src/data/cards.js'), 'utf8');
  const deck = [...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);

  it('knows every card in the deck', () => {
    expect(deck.length).toBeGreaterThan(20);
    for (const id of deck) {
      expect(MODES[id], `card "${id}" is in the deck but has no detector mode`).toBeDefined();
    }
  });

  it('invents no card the deck does not have', () => {
    for (const id of Object.keys(MODES)) {
      expect(deck, `detector knows "${id}", which is not in client/src/data/cards.js`)
        .toContain(id);
    }
  });

  it('keeps Tier C unfireable', () => {
    expect(modeFor('Doink')).toBe(NEVER);
    expect(modeFor('Record Broken')).toBe(NEVER);
  });
});

describe('scoring', () => {
  const td = (over = {}) => detect({
    typeText: 'Rushing Touchdown', scoringPlay: true, scoreValue: 6,
    text: 'A.Runner up the middle for 5 yards, TOUCHDOWN.',
    end: { down: -1, distance: 10, yardsToEndzone: 0, teamId: '1' }, ...over,
  });

  it('fires Touchdown', () => expect(ids(td())).toContain('Touchdown'));

  it('does not fire Touchdown on a play that merely mentions one', () => {
    // scoringPlay is post-enforcement, so a called-back touchdown arrives false.
    const out = detect({
      typeText: 'Penalty', scoringPlay: false, isPenalty: true,
      text: 'A.Runner for 5 yards, TOUCHDOWN NULLIFIED.PENALTY on A-B.Blocker, Offensive Holding - No Play.',
    });
    expect(ids(out)).not.toContain('Touchdown');
  });

  it('sorts a defensive score as Defensive TD, not Touchdown', () => {
    const out = td({
      typeText: 'Interception Return Touchdown',
      text: 'B.Back INTERCEPTED by C.Corner. C.Corner for 30 yards, TOUCHDOWN.',
    });
    expect(ids(out)).toContain('Defensive TD');
    expect(ids(out)).not.toContain('Touchdown');
  });

  it('sorts a return score as Special Teams TD', () => {
    const out = td({
      typeText: 'Kickoff Return Touchdown',
      text: 'D.Returner kickoff return for 99 yards, TOUCHDOWN.',
    });
    expect(ids(out)).toContain('Special Teams TD');
    expect(ids(out)).not.toContain('Touchdown');
  });

  it('fires Field Goal and Safety off their own types', () => {
    expect(ids(detect({ typeText: 'Field Goal Good', scoringPlay: true, scoreValue: 3 })))
      .toContain('Field Goal');
    expect(ids(detect({ typeText: 'Safety', scoringPlay: true, scoreValue: 2 })))
      .toContain('Safety');
  });

  it('fires 2 PT Conversion only when the attempt SUCCEEDS', () => {
    // The try is not a play of its own: it is appended to the touchdown, and the
    // play still carries scoreValue 6. Wording is the only signal.
    const succeeded = td({
      text: 'T.Back for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. Q.Back pass to R.End is complete. ATTEMPT SUCCEEDS.',
    });
    expect(ids(succeeded)).toContain('2 PT Conversion');

    const failed = td({
      text: 'T.Back for 1 yard, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. Q.Back pass to R.End is incomplete. ATTEMPT FAILS.',
    });
    expect(ids(failed)).not.toContain('2 PT Conversion');
  });

  it('fires Missed PAT off the touchdown play that carries the kick', () => {
    const out = td({ text: 'T.Back for 1 yard, TOUCHDOWN. K.Icker extra point is No Good.' });
    expect(ids(out)).toContain('Missed PAT');
    expect(ids(td({ text: 'T.Back for 1 yard, TOUCHDOWN. K.Icker extra point is GOOD.' })))
      .not.toContain('Missed PAT');
  });
});

describe('turnovers', () => {
  it('fires Turnover on the flag, not on the word', () => {
    expect(ids(detect({ isTurnover: true, typeText: 'Pass Interception Return' })))
      .toContain('Turnover');
  });

  it('does not fire on an interception a penalty wiped out', () => {
    // Real case: ESPN reports isTurnover false once the penalty is enforced.
    const out = detect({
      isTurnover: false, isPenalty: true, typeText: 'Penalty',
      text: 'Q.Back pass INTERCEPTED by C.Corner.PENALTY on D-R.Rusher, Roughing the Passer, 15 yards - No Play.',
    });
    expect(ids(out)).not.toContain('Turnover');
  });

  it('does not mistake a player called Downs for a turnover on downs', () => {
    // This is exactly how a text rule would have gone wrong.
    const out = detect({ text: '(Shotgun) D.Jones pass short right to J.Downs for 7 yards.' });
    expect(ids(out)).not.toContain('Turnover on Downs');
  });

  it('finds Turnover on Downs at drive level, where it is actually named', () => {
    expect(ids(detectDrive({ id: 'd9', displayResult: 'Downs', offensivePlays: 4 })))
      .toContain('Turnover on Downs');
    expect(ids(detectDrive({ id: 'd9', displayResult: 'Punt', offensivePlays: 4 })))
      .not.toContain('Turnover on Downs');
  });
});

describe('yardage', () => {
  it('fires Big Play 20+ at 20 and not at 19', () => {
    expect(ids(detect({ yards: 20 }))).toContain('Big Play 20+');
    expect(ids(detect({ yards: 19 }))).not.toContain('Big Play 20+');
  });

  it('fires Big Play 50+ at 50, and not both bands at once', () => {
    const out = ids(detect({ yards: 55 }));
    expect(out).toContain('Big Play 50+');
    expect(out).not.toContain('Big Play 20+');
  });

  it('never reads penalty yardage as a gain', () => {
    // A 20-yard pass interference on an INCOMPLETE pass. statYardage is 20.
    const out = detect({
      isPenalty: true, yards: 20, typeText: 'Penalty',
      text: 'Q.Back pass incomplete deep left.PENALTY on D-M.Back, Defensive Pass Interference, 20 yards - No Play.',
      start: { down: 2, distance: 6, yardsToEndzone: 66, teamId: '1' },
      end: { down: 1, distance: 10, yardsToEndzone: 46, teamId: '1' },
    });
    expect(ids(out)).not.toContain('Big Play 20+');
    expect(ids(out)).toContain('Penalty');
  });
});

describe('first down', () => {
  const firstDown = (over) => detect({
    start: { down: 3, distance: 4, yardsToEndzone: 60, teamId: '1' },
    end: { down: 1, distance: 10, yardsToEndzone: 48, teamId: '1' },
    yards: 12, ...over,
  });

  it('fires when the same team gets a new set', () => {
    expect(ids(firstDown())).toContain('First Down');
  });

  it('does not fire when the ball changed hands', () => {
    // A punt also produces a 1st down — for the other team.
    const out = firstDown({
      typeText: 'Punt',
      end: { down: 1, distance: 10, yardsToEndzone: 75, teamId: '2' },
    });
    expect(ids(out)).not.toContain('First Down');
  });

  it('does not fire on a kickoff', () => {
    const out = detect({
      typeText: 'Kickoff',
      start: { down: 0, distance: 0, yardsToEndzone: 0, teamId: '1' },
      end: { down: 1, distance: 10, yardsToEndzone: 75, teamId: '2' },
    });
    expect(ids(out)).not.toContain('First Down');
  });

  it('does not fire on a clock stoppage carrying the down forward', () => {
    // ESPN puts timeouts and the two-minute warning in the play list, and they
    // repeat the CURRENT down and distance. An Official Timeout on 1st-and-10
    // looks exactly like a play that ended on 1st-and-10. Measured against the
    // box scores this was 6 to 13 phantom first downs per game.
    for (const typeText of ['Official Timeout', 'Timeout', 'Two-minute warning', 'End Period']) {
      const out = detect({
        typeText, yards: 0,
        start: { down: 1, distance: 10, yardsToEndzone: 60, teamId: '1' },
        end: { down: 1, distance: 10, yardsToEndzone: 60, teamId: '1' },
      });
      expect(ids(out), `${typeText} produced a card`).toEqual([]);
    }
  });

  it('counts a touchdown that crossed the line to gain', () => {
    // end.down is -1 on a score, so the ordinary rule never sees it, but the
    // official box score counts the first down. Worth 3 to 10 a game.
    const out = detect({
      typeText: 'Passing Touchdown', scoringPlay: true, scoreValue: 6, yards: 37,
      text: 'Q.Back pass deep middle to W.Out for 37 yards, TOUCHDOWN.',
      start: { down: 1, distance: 10, yardsToEndzone: 37, teamId: '1' },
      end: { down: -1, distance: 10, yardsToEndzone: 0, teamId: '1' },
    });
    expect(ids(out)).toContain('First Down');
  });

  it('does not count a touchdown that did not reach the sticks', () => {
    const out = detect({
      typeText: 'Rushing Touchdown', scoringPlay: true, scoreValue: 6, yards: 2,
      text: 'A.Runner up the middle for 2 yards, TOUCHDOWN.',
      start: { down: 3, distance: 8, yardsToEndzone: 2, teamId: '1' },
      end: { down: -1, distance: 10, yardsToEndzone: 0, teamId: '1' },
    });
    expect(ids(out)).not.toContain('First Down');
  });

  it('does not fire on a kick, even when the ids say one team', () => {
    // On a blocked kick ESPN can name the same team on both sides of the play
    // although possession changed, which reads as a phantom first down.
    const out = detect({
      typeText: 'Blocked Field Goal', yards: 0,
      text: 'K.Icker 48 yard field goal is BLOCKED, recovered by D-N.Tackle.',
      start: { down: 4, distance: 7, yardsToEndzone: 30, teamId: '1' },
      end: { down: 1, distance: 10, yardsToEndzone: 70, teamId: '1' },
    });
    expect(ids(out)).not.toContain('First Down');
  });

  it('does not fire when a penalty took the first down away', () => {
    // Down and distance are already post-enforcement in both leagues, so this
    // needs no text parsing: the down simply never reaches 1.
    const out = detect({
      isPenalty: true, yards: 10, typeText: 'Penalty',
      text: 'Q.Back pass complete for 11 yards.PENALTY on A-P.Guard, Holding, 10 yards. NO PLAY',
      start: { down: 3, distance: 11, yardsToEndzone: 60, teamId: '1' },
      end: { down: 3, distance: 21, yardsToEndzone: 70, teamId: '1' },
    });
    expect(ids(out)).not.toContain('First Down');
    expect(ids(out)).toContain('Penalty');
  });
});

describe('penalties', () => {
  it('fires on an accepted penalty', () => {
    expect(ids(detect({ isPenalty: true }))).toContain('Penalty');
  });

  it('does not fire on a declined one', () => {
    // ESPN sets isPenalty false when the penalty is declined, which is right:
    // a declined flag changes nothing, so there is nothing to drink to.
    const out = detect({
      isPenalty: false,
      text: 'Q.Back pass to R.End for 14 yards.Penalty on D-E.End, Illegal Use of Hands, declined.',
    });
    expect(ids(out)).not.toContain('Penalty');
  });

  it('suggests Penalty Calls TD Back when a score is wiped out', () => {
    const out = detect({
      isPenalty: true, scoringPlay: false,
      text: 'A.Runner for 40 yards, TOUCHDOWN.PENALTY on A-B.Blocker, Offensive Holding - No Play.',
    });
    expect(ids(out)).toContain('Penalty Calls TD Back');
    expect(modeFor('Penalty Calls TD Back')).toBe(SUGGEST);
  });
});

describe('the Tier B set', () => {
  it('suggests rather than auto-fires', () => {
    for (const id of ['3 n Out', 'Blocked Kicks', 'Onside Attempt', 'Onside Recovered',
      'Fake Punt/FG', 'Penalty Calls TD Back', 'Disqualified']) {
      expect(modeFor(id), `${id} should be a suggestion`).toBe(SUGGEST);
    }
  });

  it('finds 3 n Out only on three plays and a punt', () => {
    expect(ids(detectDrive({ id: 'd1', offensivePlays: 3, displayResult: 'Punt' })))
      .toContain('3 n Out');
    expect(ids(detectDrive({ id: 'd2', offensivePlays: 4, displayResult: 'Punt' })))
      .not.toContain('3 n Out');
    expect(ids(detectDrive({ id: 'd3', offensivePlays: 3, displayResult: 'Touchdown' })))
      .not.toContain('3 n Out');
  });

  it('finds blocked kicks and onside kicks in the text', () => {
    expect(ids(detect({ typeText: 'Blocked Field Goal', text: 'K.Icker field goal is BLOCKED.' })))
      .toContain('Blocked Kicks');
    expect(ids(detect({ typeText: 'Kickoff', text: 'K.Icker onside kick recovered by A-T.Eam.' })))
      .toEqual(expect.arrayContaining(['Onside Attempt', 'Onside Recovered']));
  });

  it('offers Disqualified in college and never in the NFL', () => {
    const targeting = {
      text: 'Personal foul, targeting, #55 L.Backer disqualified from the game.',
      isPenalty: true,
    };
    expect(ids(detect(targeting, { league: 'college-football' }))).toContain('Disqualified');
    expect(ids(detect(targeting, { league: 'nfl' }))).not.toContain('Disqualified');
  });
});

describe('multi-card plays', () => {
  it('orders them bigger event first, so a stale drop loses the small one', () => {
    const out = ids(detect({
      typeText: 'Passing Touchdown', scoringPlay: true, scoreValue: 6, yards: 60,
      text: 'Q.Back pass deep right to W.Out for 60 yards, TOUCHDOWN.',
      end: { down: -1, distance: 10, yardsToEndzone: 0, teamId: '1' },
    }));
    expect(out[0]).toBe('Touchdown');
    expect(out).toContain('Big Play 50+');
    expect(out.indexOf('Touchdown')).toBeLessThan(out.indexOf('Big Play 50+'));
  });

  it('puts First Down last, because it is the cheapest thing to lose', () => {
    const out = ids(detect({
      isPenalty: true, yards: 5,
      text: 'PENALTY on D-N.Guard, Encroachment, 5 yards.',
      start: { down: 4, distance: 1, yardsToEndzone: 60, teamId: '1' },
      end: { down: 1, distance: 10, yardsToEndzone: 55, teamId: '1' },
    }));
    expect(out).toEqual(['Penalty', 'First Down']);
  });

  it('never returns the same card twice for one play', () => {
    const out = ids(detect({
      typeText: 'Rushing Touchdown', scoringPlay: true, scoreValue: 6,
      text: 'A.Runner for 5 yards, TOUCHDOWN. TOUCHDOWN.',
      end: { down: -1, distance: 10, yardsToEndzone: 0, teamId: '1' },
    }));
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('malformed input', () => {
  // The endpoints are undocumented and unversioned. A shape change must
  // degrade to no detections, never a crash and never a wrong call.
  it('returns nothing rather than throwing', () => {
    for (const bad of [null, undefined, {}, { id: null }, 'nonsense', 42, []]) {
      expect(() => detectPlay(bad)).not.toThrow();
      expect(detectPlay(bad)).toEqual([]);
    }
    for (const bad of [null, undefined, {}, 'nonsense']) {
      expect(() => detectDrive(bad)).not.toThrow();
      expect(detectDrive(bad)).toEqual([]);
    }
  });

  it('survives a play with every optional field missing', () => {
    const bare = { id: 'x1', sequence: 1, start: {}, end: {} };
    expect(() => detectPlay(bare)).not.toThrow();
    expect(detectPlay(bare)).toEqual([]);
  });

  it('marks every detection with a mode, so nothing can fire by accident', () => {
    const out = detect({ typeText: 'Rushing Touchdown', scoringPlay: true, scoreValue: 6 });
    for (const d of out) {
      expect([AUTO, SUGGEST]).toContain(d.mode);
      expect(d.playId).toBeTruthy();
      expect(d.reason).toBeTruthy();
    }
  });
});
