/**
 * When the play TYPE and a boolean flag disagree, believe the type.
 *
 * Three misses found by reading every blank line of five real games, and they
 * are one fault rather than three: every rule that leaned on a boolean was
 * trusting a field that ESPN sets reliably in the NFL and unreliably in college.
 *
 *   college `Interception`   -> isTurnover: false   (0 of 3 flagged)
 *   NFL `Fumble Recovery (Own)` holding a sack -> the type says fumble, the
 *                               text says "sacked", and no flag says either
 *   college penalties inside another play type -> isPenalty: false, ~1 a game
 *                               (the NFL flags 23 of 23)
 *
 * The type is not always richer than the flag — a negated interception is
 * re-typed by ESPN as `Penalty` and must stay silent — so the rule is
 * "prefer the type, but negation still wins over both".
 *
 * Every case here is a real play, named by game and clock so it can be checked
 * against the ESPN play-by-play.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { detectPlay } = require(path.join(ROOT, 'server/feed/detect.js'));

const fixture = (league, id) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', league, `${id}.json`), 'utf8'));

/** Find one real play and return the cards it produces. */
const cardsFor = (league, id, match) => {
  const game = fixture(league, id);
  const play = [...game.plays].sort((a, b) => a.sequence - b.sequence).find(match);
  expect(play, 'the play this test is built on has gone from the fixture').toBeTruthy();
  return { play, cards: detectPlay(play, { league }).map((c) => c.cardId) };
};

describe('a college interception is a turnover', () => {
  it('fires on the pick that ended SMU 26 - MIA 20 (Q5 0:00)', () => {
    // type: "Interception", isTurnover: false. The NFL sets the flag on its
    // own `Pass Interception Return`; college does not set it at all.
    const { play, cards } = cardsFor('college-football', '401754581',
      (p) => p.typeText === 'Interception' && p.period === 5);
    expect(play.isTurnover, 'fixture changed: college now flags interceptions').toBe(false);
    expect(cards).toContain('Turnover');
  });

  it('fires on the other two college picks as well', () => {
    for (const [id, league] of [['401754581', 'college-football'], ['401752889', 'college-football']]) {
      const game = fixture(league, id);
      const picks = game.plays.filter((p) => p.typeText === 'Interception');
      expect(picks.length, `${id} has no interception to test`).toBeGreaterThan(0);
      for (const pick of picks) {
        expect(detectPlay(pick, { league }).map((c) => c.cardId), `${id} @ ${pick.clock?.display}`)
          .toContain('Turnover');
      }
    }
  });

  it('still stays silent on a pick a penalty wiped out', () => {
    // CAR 7 - NO 17, Q1 9:31. ESPN re-types this one as `Penalty` and reports
    // isTurnover false. Negation beats the type, or this fires wrongly.
    const { cards } = cardsFor('nfl', '401772877',
      (p) => /INTERCEPTED/i.test(p.text || '') && /No Play/i.test(p.text || ''));
    expect(cards).not.toContain('Turnover');
    expect(cards).toContain('Penalty');
  });

  it('does not turn a player recovering his own fumble into a turnover', () => {
    // `Fumble Recovery (Own)` must not match the way `(Opponent)` does.
    const game = fixture('nfl', '401772636');
    const own = game.plays.filter((p) => p.typeText === 'Fumble Recovery (Own)');
    expect(own.length).toBeGreaterThan(0);
    for (const p of own) {
      expect(detectPlay(p, { league: 'nfl' }).map((c) => c.cardId)).not.toContain('Turnover');
    }
  });
});

describe('a sack is a sack whatever the play is typed as', () => {
  it('fires on the D.Jones sack-fumble in IND 31 - ATL 25 (Q3 11:40)', () => {
    // "D.Jones sacked at ATL 30 for -10 yards. FUMBLES, and recovers at ATL 31."
    // Typed `Fumble Recovery (Own)`, so a type-only rule never saw it.
    const { play, cards } = cardsFor('nfl', '401772636',
      (p) => p.typeText === 'Fumble Recovery (Own)' && /sacked/i.test(p.text || ''));
    expect(play.typeText).toBe('Fumble Recovery (Own)');
    expect(cards).toContain('Sacks');
  });

  it('still fires on an ordinary sack, and on a strip sack', () => {
    const game = fixture('nfl', '401772636');
    for (const type of ['Sack', 'Sack Opp Fumble Recovery']) {
      const p = game.plays.find((x) => x.typeText === type);
      if (!p) continue;
      expect(detectPlay(p, { league: 'nfl' }).map((c) => c.cardId), type).toContain('Sacks');
    }
  });

  it('does not fire on a sack a penalty wiped out', () => {
    const cards = detectPlay({
      id: 'x', sequence: 1, typeText: 'Penalty', isPenalty: true, yards: 5,
      text: 'Q.Back sacked at LA 20 for -7 yards.PENALTY on LA-T.Ackle, Holding - No Play.',
      start: { down: 2, distance: 7, yardsToEndzone: 60, teamId: '1' },
      end: { down: 2, distance: 2, yardsToEndzone: 55, teamId: '1' },
    }, { league: 'nfl' }).map((c) => c.cardId);
    expect(cards).not.toContain('Sacks');
  });
});

describe('an accepted penalty counts even when college forgets the flag', () => {
  it('fires on the OSU kick-catch interference (OSU 38 - PSU 14, Q4 12:23)', () => {
    // "...fair catch by #5 D.Ross at PSU10 PENALTY OSU Kick Catch Interference
    //  (#13 M.Lockhart) 15 yards from PSU10 to PSU25" — enforced, isPenalty false.
    const { play, cards } = cardsFor('college-football', '401752889',
      (p) => /Kick Catch Interference/i.test(p.text || ''));
    expect(play.isPenalty, 'fixture changed: college now flags this').toBe(false);
    expect(cards).toContain('Penalty');
  });

  it('does not fire on a declined penalty', () => {
    // A declined flag changes nothing, so there is nothing to drink to. Both
    // leagues write it differently, so both are covered.
    for (const [league, text] of [
      ['nfl', 'Q.Back pass to R.End for 14 yards.Penalty on D-E.End, Illegal Use of Hands, declined.'],
      ['college-football', '(02:22) Shotgun #11 C.Beck pass incomplete deep left PENALTY MIA Holding declined'],
    ]) {
      const cards = detectPlay({
        id: 'd1', sequence: 1, typeText: 'Pass Incompletion', isPenalty: false, yards: 0, text,
        start: { down: 2, distance: 10, yardsToEndzone: 60, teamId: '1' },
        end: { down: 3, distance: 10, yardsToEndzone: 60, teamId: '1' },
      }, { league }).map((c) => c.cardId);
      expect(cards, league).not.toContain('Penalty');
    }
  });

  it('keeps an accepted penalty when a second one on the same play was declined', () => {
    // CAR 7 - NO 17, Q2 4:09. Offensive holding ENFORCED at NO 26, and a second
    // holding declined. A bare search for "declined" throws away the one that
    // stood — which is how the first cut of this fix broke a working call.
    const { play, cards } = cardsFor('nfl', '401772877',
      (p) => /enforced/i.test(p.text || '') && /declined/i.test(p.text || ''));
    expect(play.text).toMatch(/declined/i);
    expect(cards).toContain('Penalty');
  });

  it('does not fire on offsetting penalties', () => {
    const cards = detectPlay({
      id: 'o1', sequence: 1, typeText: 'Pass Incompletion', isPenalty: true, yards: 0,
      text: 'Penalty on SF-G.Kittle, Illegal Shift, offsetting.Penalty on LA-J.Verse, offsetting.',
      start: { down: 4, distance: 4, yardsToEndzone: 60, teamId: '1' },
      end: { down: 4, distance: 4, yardsToEndzone: 60, teamId: '1' },
    }, { league: 'nfl' }).map((c) => c.cardId);
    expect(cards).not.toContain('Penalty');
  });
});

describe('college targeting', () => {
  it('fires Disqualified on the real UGA - MSST targeting call', () => {
    // The rule required the words "disqualified" or "ejected". ESPN writes
    // neither. What it actually writes is:
    //
    //   PENALTY MSU Targeting (#13 J.Manning) 15 yards ... NO PLAY.
    //   The previous play is under automatic review - "Targeting". CALL UPHELD
    //
    // Targeting upheld on review IS the ejection — that is what the review
    // decides. So the card was incapable of ever firing on real data, exactly
    // as 2 PT Conversion was before the fixtures caught it.
    const { play, cards } = cardsFor('college-football', '401752762',
      (p) => /targeting/i.test(p.text || ''));
    expect(play.text).toMatch(/CALL UPHELD/i);
    expect(play.text).not.toMatch(/disqualif|eject/i);
    expect(cards).toContain('Disqualified');
  });

  it('does not fire when the targeting call is overturned', () => {
    const cards = detectPlay({
      id: 't2', sequence: 1, typeText: 'Penalty', isPenalty: false, yards: 0,
      text: 'The previous play is under automatic review - "Targeting". CALL OVERTURNED',
      start: { down: 2, distance: 10, yardsToEndzone: 60, teamId: '1' },
      end: { down: 2, distance: 10, yardsToEndzone: 60, teamId: '1' },
    }, { league: 'college-football' }).map((c) => c.cardId);
    expect(cards).not.toContain('Disqualified');
  });

  it('still refuses targeting in the NFL, where ejections are not reported', () => {
    const game = fixture('college-football', '401752762');
    const play = game.plays.find((p) => /targeting/i.test(p.text || ''));
    expect(detectPlay(play, { league: 'nfl' }).map((c) => c.cardId)).not.toContain('Disqualified');
  });
});
