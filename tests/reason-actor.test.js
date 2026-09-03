/**
 * Who a clause belongs to.
 *
 * ESPN writes a penalty as "<offender> <N> Yd Pnlty", and the offender is
 * sometimes a team abbreviation and sometimes a person — whose name may carry a
 * suffix. The formatter took exactly the two words before the yardage, which is
 * right for "Mekhi Blackmon" and wrong for everything else:
 *
 *   "...to Michael Pittman Jr. ATL 5 Yd Pnlty"  ->  "Jr. ATL 5 Yd penalty"
 *   "...to James Proche II SEA 5 Yd Pnlty"      ->  "II SEA 5 Yd penalty"
 *   "Michael Penix Jr. 15 Yd Pnlty"             ->  "Penix Jr. 15 Yd penalty"
 *
 * The first two read as gibberish and the third quietly loses a first name.
 * Every string below is real text from the fixtures, not invented.
 */
import { describe, expect, it } from 'vitest';
import { formatReason } from '../client/src/lib/round-source.js';

describe('the actor in front of a penalty', () => {
  it('takes the team when the penalty is on a team', () => {
    // The bug in the long-drive recording: "Jr." is the tail of the RECEIVER's
    // name, and belongs to the previous clause entirely.
    expect(formatReason(
      'Daniel Jones Pass Complete for 6 Yds to Michael Pittman Jr. ATL 5 Yd Pnlty',
      'Penalty',
    )).toBe('ATL 5 Yd penalty');
  });

  it('is not confused by a two-letter suffix either', () => {
    expect(formatReason(
      'Cam Ward Pass Complete for 4 Yds to James Proche II SEA 5 Yd Pnlty',
      'Penalty',
    )).toBe('SEA 5 Yd penalty');
  });

  it('keeps a whole name when the penalty is on a person with a suffix', () => {
    expect(formatReason(
      'Michael Penix Jr. Incomplete Pass Michael Penix Jr. 15 Yd Pnlty',
      'Penalty',
    )).toBe('Michael Penix Jr. 15 Yd penalty');
  });

  it('keeps a three-part suffix name', () => {
    expect(formatReason(
      'Jessie Bates III 3 Yd Interception Return Jessie Bates III 15 Yd Pnlty',
      'Penalty',
    )).toBe('Jessie Bates III 15 Yd penalty');
  });

  it('handles a penalty with nothing in front of it but the team', () => {
    expect(formatReason('IND 5 Yd Pnlty', 'Penalty')).toBe('IND 5 Yd penalty');
  });

  it('still takes a plain two-word name', () => {
    // The case that already worked, and must keep working.
    expect(formatReason(
      'Michael Penix Jr. Incomplete Pass, Intended For Darnell Mooney Mekhi Blackmon 20 Yd Pnlty',
      'Penalty',
    )).toBe('Mekhi Blackmon 20 Yd penalty');
  });

  it('applies the same rule to a return', () => {
    // Returns and turnovers used the identical two-word regex, so they carry
    // the identical fault. One fix, not three.
    expect(formatReason(
      'Bradley Pinion 61 Yd Kickoff Ameer Abdullah 20 Yd Kickoff Return',
      'Big Play 20+',
    )).toBe('Ameer Abdullah 20 Yd Kickoff Return');
  });
});
