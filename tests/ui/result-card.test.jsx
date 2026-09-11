/**
 * The end-of-game result card.
 *
 * This is the artefact people post. It is looked at for about one second, at
 * thumbnail size, by people who have never seen the game — so the things that
 * can ruin it are layout failures, not logic ones: a name running off the
 * edge, ten players overflowing the frame, or the whole thing quietly
 * rendering in Helvetica because a webfont had not loaded.
 *
 * `drawResultCard` takes a context-like object rather than a canvas, so every
 * draw call can be recorded and the layout asserted. jsdom has no canvas at
 * all, so this is also the only way to test it here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  drawResultCard, renderResultCard, fitText, rankForCard, listBottom,
  CARD_W, CARD_H, SIZES, layoutFor, STORY_SAFE,
} from '../../client/src/lib/result-card.js';
import { canShareFiles, shareResultCard } from '../../client/src/lib/share-result.js';
import { SITE_LABEL } from '../../client/src/lib/site.js';

/**
 * A canvas context that records instead of drawing.
 *
 * `measureText` derives width from the CURRENT font size, not a constant. A
 * fixed per-character width made a 37-character name at 46px "fit" a box it
 * would overflow in any real browser, so the truncation test passed against
 * code that never truncated.
 */
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
    fillText: (s, x, y) => calls.text.push({
      s: String(s), x, y, align: ctx.textAlign, font: ctx.font,
    }),
    scale() {},
  };
  return ctx;
};

const players = (n, over = {}) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Player${i + 1}`, totalDrinks: i, totalShotguns: 0, ...over,
}));

describe('what the card says', () => {
  it('carries the wordmark, the room code and the domain', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: players(3), roomCode: '48213' });
    const said = ctx.calls.text.map((t) => t.s);
    expect(said).toContain('SHOTGUN');
    expect(said).toContain('FORMATION');
    expect(said).toContain('ROOM 48213');
    expect(said).toContain(SITE_LABEL.toUpperCase());
  });

  it('lists every player with BOTH numbers', () => {
    const ctx = recorder();
    const roster = [
      { id: 'a', name: 'Ava', totalDrinks: 4, totalShotguns: 2 },
      { id: 'b', name: 'Ben', totalDrinks: 7, totalShotguns: 0 },
    ];
    drawResultCard(ctx, { players: roster, roomCode: '11111' });
    const said = ctx.calls.text.map((t) => t.s);
    expect(said).toContain('Ava');
    expect(said).toContain('Ben');
    expect(said).toContain('2');   // Ava's shotguns
    expect(said).toContain('4');   // Ava's drinks
    expect(said).toContain('7');   // Ben's drinks
  });

  it('orders by total drunk, counting a shotgun as ten', () => {
    const ranked = rankForCard([
      { name: 'Low', totalDrinks: 9, totalShotguns: 0 },
      { name: 'High', totalDrinks: 0, totalShotguns: 1 },
    ]);
    expect(ranked.map((p) => p.name)).toEqual(['High', 'Low']);
  });

  it('does not invent a room line when there is no room code', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: players(2), roomCode: '' });
    expect(ctx.calls.text.some((t) => /^ROOM/.test(t.s))).toBe(false);
  });
});

describe('nothing overflows the frame', () => {
  for (const n of [2, 3, 6, 8, 10]) {
    it(`fits ${n} players`, () => {
      const ctx = recorder();
      drawResultCard(ctx, { players: players(n), roomCode: '48213' });

      // The list must end above the footer.
      expect(listBottom(n), `${n} players overflow past the footer`)
        .toBeLessThan(CARD_H - 150);

      for (const t of ctx.calls.text) {
        expect(t.y, `"${t.s}" is drawn below the card`).toBeLessThanOrEqual(CARD_H);
        expect(t.y, `"${t.s}" is drawn above the card`).toBeGreaterThan(0);
        expect(t.x, `"${t.s}" is drawn outside the card`).toBeGreaterThanOrEqual(0);
        expect(t.x, `"${t.s}" is drawn past the right edge`).toBeLessThanOrEqual(CARD_W);
      }
    });
  }

  it('truncates a very long name instead of running it into the numbers', () => {
    const ctx = recorder();
    const long = 'Bartholomew Fitzgerald-Wellington III';
    drawResultCard(ctx, {
      players: [{ id: 'x', name: long, totalDrinks: 3, totalShotguns: 1 }],
      roomCode: '48213',
    });
    const drawn = ctx.calls.text.find((t) => t.s.startsWith('Bartholomew'));
    expect(drawn, 'the long name was not drawn at all').toBeTruthy();
    expect(drawn.s.length, 'the name was not truncated').toBeLessThan(long.length);
    expect(drawn.s.endsWith('…'), 'truncated without an ellipsis').toBe(true);
  });

  it('leaves a name that fits completely alone', () => {
    const ctx = recorder();
    ctx.font = '600 46px x';
    expect(fitText(ctx, 'Ava', 10_000)).toBe('Ava');
  });
});

describe('the awkward totals', () => {
  it('renders a table where nobody drank anything', () => {
    const ctx = recorder();
    drawResultCard(ctx, {
      players: players(3, { totalDrinks: 0, totalShotguns: 0 }), roomCode: '48213',
    });
    const zeroes = ctx.calls.text.filter((t) => t.s === '0');
    expect(zeroes.length, 'zero totals did not render').toBeGreaterThanOrEqual(6);
  });

  it('renders shotguns with no leftover drinks', () => {
    const ctx = recorder();
    drawResultCard(ctx, {
      players: [{ id: 'a', name: 'Ava', totalDrinks: 0, totalShotguns: 3 }],
      roomCode: '48213',
    });
    const said = ctx.calls.text.map((t) => t.s);
    expect(said).toContain('3');
    expect(said).toContain('0');
  });

  it('survives a missing name or missing totals', () => {
    const ctx = recorder();
    expect(() => drawResultCard(ctx, {
      players: [{ id: 'a' }, { id: 'b', name: null }], roomCode: '48213',
    })).not.toThrow();
  });
});

describe('fonts', () => {
  it('waits for document.fonts.ready before drawing', async () => {
    let resolved = false;
    const doc = {
      fonts: { ready: Promise.resolve().then(() => { resolved = true; }) },
      createElement: () => {
        // If this runs before the font promise settles, the card ships in the
        // wrong typeface and nobody notices on a warm cache.
        expect(resolved, 'drew before document.fonts.ready settled').toBe(true);
        return { width: 0, height: 0, getContext: () => null };
      },
    };
    await renderResultCard({ players: players(2), roomCode: '1' }, doc);
  });

  it('does not draw at all when fonts are unavailable', async () => {
    const created = vi.fn();
    const out = await renderResultCard(
      { players: players(2), roomCode: '1' },
      { createElement: created },   // no `fonts`
    );
    expect(out).toBeNull();
    expect(created, 'created a canvas with no font support').not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when there is no 2d context', async () => {
    const doc = {
      fonts: { ready: Promise.resolve() },
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    };
    await expect(renderResultCard({ players: players(2) }, doc)).resolves.toBeNull();
  });
});

describe('sharing, and what happens when it is not available', () => {
  const blob = { size: 1 };

  it('uses the file share when the browser really supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav = { share, canShare: () => true };
    expect(await shareResultCard({ blob }, {}, nav)).toBe('shared');
    expect(share).toHaveBeenCalled();
  });

  it('falls back to the image when canShare says no', async () => {
    const nav = { share: vi.fn(), canShare: () => false };
    expect(await shareResultCard({ blob }, {}, nav)).toBe('image');
    expect(nav.share, 'called share() when canShare was false').not.toHaveBeenCalled();
  });

  it('falls back to the image when the share sheet throws or is cancelled', async () => {
    const nav = { share: vi.fn().mockRejectedValue(new Error('cancelled')), canShare: () => true };
    expect(await shareResultCard({ blob }, {}, nav)).toBe('image');
  });

  it('reports nothing to show when the render failed', async () => {
    const nav = { share: vi.fn(), canShare: () => true };
    expect(await shareResultCard(null, {}, nav)).toBe('none');
    expect(nav.share).not.toHaveBeenCalled();
  });

  it('does not claim file sharing on a browser with share but not canShare', async () => {
    // Desktop Chrome: has share(), refuses files. Checking share() alone would
    // take the good path and throw for a whole class of user.
    expect(canShareFiles({ share: () => {} })).toBe(false);
    expect(canShareFiles(null)).toBe(false);
    expect(canShareFiles({ share: () => {}, canShare: () => { throw new Error('no'); } }))
      .toBe(false);
  });
});


/**
 * The 9:16 story card.
 *
 * Instagram and Snapchat overlay chrome on a Story — profile row and close
 * button at the top, reply bar at the bottom. Anything in the top or bottom
 * ~10% sits under a UI element on somebody's phone, and the URL is the only
 * part of the image doing commercial work. So "does it survive the crop" is
 * the property under test, not "does it render".
 */
describe('the story card, 9:16', () => {
  it('is 1080x1920', () => {
    expect(SIZES.story).toEqual({ w: 1080, h: 1920 });
    const L = layoutFor('story');
    expect(L.w).toBe(1080);
    expect(L.h).toBe(1920);
  });

  it('keeps EVERYTHING inside the safe band, at every table size', () => {
    for (const n of [2, 3, 6, 8, 10]) {
      const ctx = recorder();
      drawResultCard(ctx, { players: players(n), roomCode: '48213', size: 'story' });
      const L = layoutFor('story');
      for (const t of ctx.calls.text) {
        expect(t.y, `${n}p: "${t.s}" sits under the top chrome`)
          .toBeGreaterThanOrEqual(L.safeTop);
        expect(t.y, `${n}p: "${t.s}" sits under the reply bar`)
          .toBeLessThanOrEqual(L.safeBottom);
      }
    }
  });

  it('keeps the URL — the only commercial element — well inside the crop', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: players(6), roomCode: '48213', size: 'story' });
    const L = layoutFor('story');
    const url = ctx.calls.text.find((t) => /SHOTGUNFORMATION/i.test(t.s));
    expect(url, 'the URL is not on the card').toBeTruthy();
    expect(url.y).toBeLessThanOrEqual(L.safeBottom);
    expect(url.y).toBeGreaterThan(L.h * 0.75);   // anchored low, but not under the bar
  });

  it('reserves a tenth of the height at each end', () => {
    expect(STORY_SAFE).toBe(0.10);
    const L = layoutFor('story');
    expect(L.safeTop).toBe(192);
    expect(L.safeBottom).toBe(1728);
  });

  it('stays inside the horizontal safe area too', () => {
    const ctx = recorder();
    drawResultCard(ctx, {
      players: [{ id: 'x', name: 'Bartholomew Fitzgerald-Wellington III', totalDrinks: 9, totalShotguns: 4 }],
      roomCode: '48213', size: 'story',
    });
    const L = layoutFor('story');
    for (const t of ctx.calls.text) {
      expect(t.x, `"${t.s}" is outside the horizontal safe area`)
        .toBeGreaterThanOrEqual(L.w * 0.05 - 1);
      expect(t.x, `"${t.s}" is outside the horizontal safe area`)
        .toBeLessThanOrEqual(L.w * 0.95 + 1);
    }
  });

  it('fits ten players in the taller frame', () => {
    expect(listBottom(10, 'story')).toBeLessThan(layoutFor('story').safeBottom);
  });

  it('still draws the feed size unchanged', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: players(3), roomCode: '1' });   // default = feed
    expect(ctx.calls.rect[0]).toMatchObject({ w: CARD_W, h: CARD_H });
  });

  it('takes a heading, so a mid-game card is not labelled FINAL', () => {
    const ctx = recorder();
    drawResultCard(ctx, { players: players(3), roomCode: '1', size: 'story', title: 'RIGHT NOW' });
    const said = ctx.calls.text.map((t) => t.s);
    expect(said).toContain('RIGHT NOW');
    expect(said, 'a live snapshot claimed to be the final result').not.toContain('FINAL');
  });
});

/**
 * The anonymity rule, made STRUCTURAL rather than remembered.
 *
 * Round Results are anonymous by deliberate product decision — "X drank N",
 * never "X gave Y" (FOLLOW_UPS.md P1) — and a share card is the most public
 * surface in the product. The card is fed a ROSTER, and a roster has no notion
 * of who poured what, so there is nothing for it to leak.
 */
describe('a share card cannot leak who poured what', () => {
  it('draws nothing but names and the two totals', () => {
    const ctx = recorder();
    drawResultCard(ctx, {
      players: [
        { id: 'a', name: 'Ava', totalDrinks: 4, totalShotguns: 1 },
        { id: 'b', name: 'Ben', totalDrinks: 2, totalShotguns: 0 },
      ],
      roomCode: '48213', size: 'story',
    });
    const allowed = new Set([
      'SHOTGUN', 'FORMATION', 'FINAL', 'SG', 'DR', 'ROOM 48213',
      'SHOTGUNFORMATION.COM', 'Ava', 'Ben', '1', '2', '4', '0',
    ]);
    for (const t of ctx.calls.text) {
      expect(allowed.has(t.s), `the card drew "${t.s}", which is not a name or a total`)
        .toBe(true);
    }
  });

  it('ignores pour attribution even when it is handed some', () => {
    // If a caller ever passes richer rows, the card must still not render them.
    const ctx = recorder();
    drawResultCard(ctx, {
      players: [{
        id: 'a', name: 'Ava', totalDrinks: 4, totalShotguns: 0,
        gaveTo: 'Ben', receivedFrom: 'Marcus', pours: [{ to: 'Ben', n: 4 }],
      }],
      roomCode: '48213', size: 'story',
    });
    const said = ctx.calls.text.map((t) => t.s).join(' | ');
    expect(said, 'pour attribution reached the card').not.toMatch(/Ben|Marcus|gave/i);
  });
});
