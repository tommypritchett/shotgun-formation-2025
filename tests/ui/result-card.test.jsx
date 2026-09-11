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
  CARD_W, CARD_H,
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
