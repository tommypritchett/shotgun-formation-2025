/**
 * The Session 20 redesign: a podium instead of a table.
 *
 * The card is looked at for a second, at thumbnail size, by somebody who has
 * never played. So the things worth pinning are the ones that carry meaning
 * at that size — who won, what the two numbers ARE, and whether the frame is
 * full — plus the one rule the redesign could most easily have broken, which
 * is that a tie must not crown anybody.
 *
 * The recorder here carries the same five methods the original card needed,
 * deliberately: the drawing must degrade to text on a context with no path
 * API, and a test that handed it a full canvas mock would not prove that.
 */
import { describe, expect, it } from 'vitest';
import {
  drawResultCard, listPlan, listBottom, layoutFor, isTied,
} from '../../client/src/lib/result-card.js';

const recorder = (ratio = 0.55) => {
  const calls = { text: [], rect: [] };
  const fontSize = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font || '');
    return m ? Number(m[1]) : 16;
  };
  const ctx = {
    calls,
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect: (x, y, w, h) => calls.rect.push({ x, y, w, h }),
    measureText: (s) => ({ width: String(s).length * fontSize() * ratio }),
    fillText: (s, x, y) => calls.text.push({ s: String(s), x, y, align: ctx.textAlign, font: ctx.font }),
    scale() {},
  };
  return ctx;
};

const roster = (n, scores = null) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`,
  name: `Player${i + 1}`,
  totalShotguns: scores ? scores[i].sg : 0,
  totalDrinks: scores ? scores[i].dr : 10 - i,
}));

const said = (ctx) => ctx.calls.text.map((t) => t.s);

describe('the winner is unmistakable', () => {
  it('labels first place WINNER', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: roster(4), roomCode: '48213', size: 'story' });
    expect(said(ctx)).toContain('WINNER');
  });

  it('says WINNER exactly once, however many played', () => {
    for (const n of [2, 3, 6, 10]) {
      const ctx = recorder();
      drawResultCard(ctx, { players: roster(n), roomCode: '48213', size: 'story' });
      expect(said(ctx).filter((s) => s === 'WINNER')).toHaveLength(1);
    }
  });
});

describe('a tie crowns nobody', () => {
  // Two First Down rounds give everyone the same total, so this is routine.
  const tiedPair = [
    { id: 'a', name: 'Ava', totalShotguns: 1, totalDrinks: 2 },
    { id: 'b', name: 'Ben', totalShotguns: 1, totalDrinks: 2 },
  ];

  it('recognises a shared top score', () => {
    expect(isTied(tiedPair)).toBe(true);
    expect(isTied([
      { totalShotguns: 1, totalDrinks: 3 },
      { totalShotguns: 1, totalDrinks: 2 },
    ])).toBe(false);
  });

  it('counts a shotgun as ten when deciding whether it is a tie', () => {
    // 1 shotgun == 10 drinks, so these two are level.
    expect(isTied([
      { totalShotguns: 1, totalDrinks: 0 },
      { totalShotguns: 0, totalDrinks: 10 },
    ])).toBe(true);
  });

  it('draws no WINNER label when the top is shared', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: tiedPair, roomCode: '48213', size: 'story' });
    expect(said(ctx), 'a tie was crowned').not.toContain('WINNER');
  });

  it('still lists everybody and both totals', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: tiedPair, roomCode: '48213', size: 'story' });
    expect(said(ctx)).toContain('Ava');
    expect(said(ctx)).toContain('Ben');
  });
});

describe('the two columns say what they are', () => {
  it('spells out SHOTGUNS and DRINKS instead of SG and DR', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: roster(3), roomCode: '48213', size: 'story' });
    const s = said(ctx);
    expect(s).toContain('SHOTGUNS');
    expect(s).toContain('DRINKS');
    expect(s, 'the internal shorthand is still on the card').not.toContain('SG');
    expect(s, 'the internal shorthand is still on the card').not.toContain('DR');
  });

  it('carries the line that answers a stranger cold', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: roster(3), roomCode: '48213', size: 'story' });
    expect(said(ctx)).toContain('NO APP · NO SIGNUP');
  });

  it('keeps the tagline BELOW the URL, and both inside the safe band', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: roster(3), roomCode: '48213', size: 'story' });
    const L = layoutFor('story');
    const url = ctx.calls.text.find((t) => /SHOTGUNFORMATION/i.test(t.s));
    const tag = ctx.calls.text.find((t) => t.s === 'NO APP · NO SIGNUP');
    expect(tag.y).toBeGreaterThan(url.y);
    expect(tag.y).toBeLessThanOrEqual(L.safeBottom);
  });
});

describe('the frame is full at every table size', () => {
  it('uses most of the space between heading and footer', () => {
    for (const n of [2, 3, 6, 8, 10]) {
      const plan = listPlan(n, 'story');
      const zone = plan.zone.bottom - plan.zone.top;
      const fill = plan.total / zone;
      // 2 players is the sparsest case there is and still fills ~80%.
      expect(fill, `${n} players fill only ${(fill * 100).toFixed(0)}% of the frame`)
        .toBeGreaterThan(0.78);
      expect(fill, `${n} players overflow the zone`).toBeLessThanOrEqual(1.001);
    }
  });

  it('never starts the list on top of the FINAL STANDINGS heading', () => {
    // The first version did exactly this: the zone top was a guessed offset
    // from the wordmark and the winner block landed over the heading.
    const L = layoutFor('story');
    for (const n of [2, 3, 6, 8, 10]) {
      expect(listPlan(n, 'story').top,
        `${n} players: the list starts above the heading`).toBeGreaterThan(L.headingY);
    }
  });

  it('keeps the list clear of the footer legend', () => {
    const L = layoutFor('story');
    for (const n of [2, 3, 6, 8, 10]) {
      expect(listBottom(n, 'story')).toBeLessThan(L.legendY);
    }
  });

  it('gives first place more room than the rest', () => {
    const plan = listPlan(6, 'story');
    expect(plan.heights[0]).toBeGreaterThan(plan.heights[1]);
    expect(plan.heights[1]).toBeGreaterThan(plan.heights[3]);
  });
});

describe('it still draws on a context with no path API', () => {
  it('renders every name and total with only fillText and fillRect', () => {
    // The recorder has no beginPath, arc, roundRect or createRadialGradient.
    // Losing the podium shapes is acceptable; throwing is not.
    const ctx = recorder();
    expect(() => drawResultCard(ctx, {
      players: roster(10), roomCode: '48213', size: 'story',
    })).not.toThrow();
    for (let i = 1; i <= 10; i += 1) expect(said(ctx)).toContain(`Player${i}`);
  });

  it('draws the background before anything else', () => {
    // A test elsewhere reads calls.rect[0] to prove the frame size, and the
    // field texture is also drawn with fillRect — so the order matters.
    const ctx = recorder();
    drawResultCard(ctx, { players: roster(3), roomCode: '1', size: 'story' });
    expect(ctx.calls.rect[0]).toMatchObject({ x: 0, y: 0, w: 1080, h: 1920 });
  });
});
