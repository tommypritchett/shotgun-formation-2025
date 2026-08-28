/**
 * Shotguns first, then the drinks.
 *
 * Confirmed by the owner in live play: holding four Turnovers you are given the
 * shotgun to assign and the six drinks are unreachable. The client had one pool
 * and no way to switch.
 */
import { describe, expect, it } from 'vitest';
import { DRINKS, SHOTGUNS, pourPhase } from '../../client/src/lib/phases.js';

const given = (shotguns = {}, drinks = {}) => ({ shotguns, drinks });

describe('the owner\'s case: 4x Turnover = 1 shotgun + 6 drinks', () => {
  it('starts in the shotgun phase', () => {
    const p = pourPhase(1, 6, given());
    expect(p.bucket).toBe(SHOTGUNS);
    expect(p.isShotgun).toBe(true);
    expect(p.remaining).toBe(1);
    expect(p.settled).toBe(false);
  });

  it('rolls over to the drinks once the shotgun is out', () => {
    const p = pourPhase(1, 6, given({ ben: 1 }));
    expect(p.bucket).toBe(DRINKS);
    expect(p.isShotgun).toBe(false);
    expect(p.unit).toBe('drink');
    expect(p.remaining, 'the six drinks were unreachable — this is the bug').toBe(6);
    expect(p.rolledOver, 'the UI needs to announce the change of unit').toBe(true);
  });

  it('counts down through the drinks', () => {
    const p = pourPhase(1, 6, given({ ben: 1 }, { ben: 4 }));
    expect(p.remaining).toBe(2);
    expect(p.settled).toBe(false);
  });

  it('is settled only when all seven units are out', () => {
    const p = pourPhase(1, 6, given({ ben: 1 }, { ben: 4, cy: 2 }));
    expect(p.settled).toBe(true);
    expect(p.remaining).toBe(0);
  });
});

describe('rounds with only one bucket', () => {
  it('a plain drinks round never claims to have rolled over', () => {
    const p = pourPhase(0, 3, given());
    expect(p.bucket).toBe(DRINKS);
    expect(p.rolledOver).toBe(false);
    expect(p.remaining).toBe(3);
  });

  it('a pure shotgun round settles when the shotguns are out', () => {
    expect(pourPhase(2, 0, given({ a: 2 })).settled).toBe(true);
    expect(pourPhase(2, 0, given({ a: 1 })).settled).toBe(false);
  });

  it('owing nothing is settled immediately', () => {
    const p = pourPhase(0, 0, given());
    expect(p.settled).toBe(true);
    expect(p.remaining).toBe(0);
  });
});

describe('undo walks back across the boundary', () => {
  it('takes the drink back first when in the drink phase', () => {
    // One debt, two phases: undoing after the rollover must not silently
    // return a shotgun.
    const p = pourPhase(1, 6, given({ ben: 1 }, { ben: 2 }));
    expect(p.bucket).toBe(DRINKS);
    const after = pourPhase(1, 6, given({ ben: 1 }, { ben: 1 }));
    expect(after.bucket).toBe(DRINKS);
    expect(after.remaining).toBe(5);
  });

  it('returns to the shotgun phase when the last drink is undone', () => {
    const back = pourPhase(1, 6, given({ ben: 1 }, {}));
    expect(back.bucket).toBe(DRINKS);   // the shotgun is still poured
    const undoneShotgun = pourPhase(1, 6, given({}, {}));
    expect(undoneShotgun.bucket).toBe(SHOTGUNS);
    expect(undoneShotgun.remaining).toBe(1);
  });

  it('never goes negative if the server and client disagree', () => {
    const p = pourPhase(1, 6, given({ ben: 3 }, { ben: 99 }));
    expect(p.remaining).toBeGreaterThanOrEqual(0);
    expect(p.settled).toBe(true);
  });
});

/**
 * The same thing through the real component.
 *
 * A 5-card standard hand rarely holds 10+ of one card type — eight browser
 * deals in a row came in under it — which is exactly why this shipped. The
 * phase maths is covered above; this renders the actual assigner in both
 * phases so the wiring is proved too.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import DrinkAssigner from '../../client/src/components/DrinkAssigner.jsx';
import { getCard } from '../../client/src/data/cards.js';

afterEach(cleanup);

const targets = [
  { id: 'a', name: 'Marcus', avatar: '', avatarRing: '#7FB2FF', totalDrinks: 0, totalShotguns: 0 },
  { id: 'b', name: 'Big Mike', avatar: '', avatarRing: '#FF8FB1', totalDrinks: 0, totalShotguns: 0 },
];

/** The owner's case: 4x Turnover = 16 = 1 shotgun + 6 drinks. */
const assigner = (phase, given) => {
  render(
    <DrinkAssigner
      card={getCard('Turnover')}
      copies={4}
      source="The Ref declared"
      secondsLeft={20}
      fraction={1}
      tier="amber"
      passive={false}
      firstDown={false}
      targets={targets}
      given={given}
      pourCount={phase.poured}
      pool={phase.pool}
      isShotgun={phase.isShotgun}
      unit={phase.unit}
      rolledOver={phase.rolledOver}
      shotgunsOwed={phase.shotgunsOwed}
      drinksOwed={phase.drinksOwed}
      sent={false}
      animations={{}}
      onGive={() => {}}
      onUndo={() => {}}
      onLockIn={() => {}}
    />
  );
};

describe('the assigner rolls over on screen', () => {
  it('shows the whole debt, both halves, in the banner', () => {
    assigner(pourPhase(1, 6, { shotguns: {}, drinks: {} }), {});
    expect(document.querySelector('.hold').textContent.replace(/\s+/g, ' '))
      .toMatch(/1 shotgun \+ 6 drinks/);
  });

  it('starts on shotguns', () => {
    const p = pourPhase(1, 6, { shotguns: {}, drinks: {} });
    assigner(p, {});
    expect(document.querySelector('.gridhead .tag').textContent).toMatch(/shotgun/i);
    expect(document.querySelector('.gridhead .hint').textContent).toBe('One tap = one shotgun');
    expect(document.querySelector('.ammo .big').textContent).toBe('1');
  });

  it('announces the change of unit once the shotgun is out', () => {
    const p = pourPhase(1, 6, { shotguns: { a: 1 }, drinks: {} });
    assigner(p, { a: 0 });
    expect(
      document.querySelector('.gridhead .tag').textContent,
      'nothing told the player the unit had changed'
    ).toMatch(/Now your drinks/i);
    expect(document.querySelector('.gridhead .hint').textContent).toBe('One tap = one drink');
    expect(
      document.querySelector('.ammo .big').textContent,
      'the six drinks were unreachable — this is the reported bug'
    ).toBe('6');
  });

  it('reaches Lock In only when all seven units are out', () => {
    const p = pourPhase(1, 6, { shotguns: { a: 1 }, drinks: { a: 6 } });
    assigner(p, { a: 6 });
    expect(p.settled).toBe(true);
    expect(document.querySelector('.lockin')).toBeTruthy();
  });
});


/**
 * The Lock In affordance, now that pouring out no longer ends the round.
 */
describe('when everything is poured but nothing is locked in', () => {
  it('offers Lock In and says the round is waiting', () => {
    const p = pourPhase(0, 3, { shotguns: {}, drinks: { a: 3 } });
    assigner(p, { a: 3 });
    expect(p.remaining).toBe(0);
    expect(document.querySelector('.lockin'), 'no Lock In to press').toBeTruthy();
    expect(document.querySelector('.gridhead .tag').textContent).toMatch(/All poured/i);
    expect(
      document.querySelector('.gridhead .hint').textContent,
      'the hint still explained taps, with nothing left to tap'
    ).toMatch(/waiting/i);
  });

  it('goes back to explaining taps if a pour is undone', () => {
    const p = pourPhase(0, 3, { shotguns: {}, drinks: { a: 2 } });
    assigner(p, { a: 2 });
    expect(document.querySelector('.gridhead .hint').textContent).toBe('One tap = one drink');
  });
});
