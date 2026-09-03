/**
 * A sheet without `on` is invisible.
 *
 * `.sheet` is parked at `translateY(110%)` and only slides in when `.on` is
 * added. Both the game picker and the card dial shipped without it: mounted,
 * sized, in the DOM, passing every test that queried their contents — and
 * completely off-screen in the running app.
 *
 * Nothing in a jsdom test can see that, because jsdom does not lay anything
 * out. So this reads the class list, which is the one thing that decides it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import GamePicker from '../../client/src/components/GamePicker.jsx';
import CardDial from '../../client/src/components/CardDial.jsx';

afterEach(cleanup);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('sheets that are rendered are visible', () => {
  it('the game picker slides in', () => {
    const { container } = render(<GamePicker />);
    const sheet = container.querySelector('.sheet');
    expect(sheet, 'the picker is not a sheet any more — update this test').toBeTruthy();
    expect(
      sheet.className.split(/\s+/),
      'the picker renders parked off-screen at translateY(110%)'
    ).toContain('on');
  });

  it('the card dial slides in', () => {
    const { container } = render(<CardDial />);
    const sheet = container.querySelector('.sheet');
    expect(sheet.className.split(/\s+/)).toContain('on');
  });

  /**
   * Session 18. The dial renders four groups of cards plus a Ref-only note —
   * far taller than a phone. `.sheet` is anchored to the bottom and grows
   * UPWARD, so an over-tall sheet pushes its own header, and the close X in
   * it, off the top of the screen. With no overflow rule there was no way to
   * scroll back to it: the owner could open the dial and not get out of it.
   *
   * The picker never showed this because `.gamepicker .gamelist` caps itself
   * at 52vh and scrolls internally. `.carddial` had no such rule.
   */
  it('a sheet taller than the phone can be scrolled', () => {
    const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');
    const rule = /\.sheet\{([^}]*)\}/.exec(css);
    expect(rule, '.sheet rule is gone').toBeTruthy();
    expect(rule[1], '.sheet must cap its height or it grows off the top of the screen')
      .toMatch(/max-height:/);
    expect(rule[1], '.sheet must scroll once it is capped, or the close X is unreachable')
      .toMatch(/overflow-y:auto/);
  });

  it('keeps the close X reachable while the sheet is scrolled', () => {
    const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');
    expect(css, 'the sheet header must stay put, or scrolling hides the way out')
      .toMatch(/\.sheet-head\{[^}]*position:sticky/);
  });

  it('the rule it depends on is still in the stylesheet', () => {
    // If `.sheet` stops being a translated bottom sheet, the two tests above
    // are testing a class that no longer means anything.
    const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');
    expect(css).toMatch(/\.sheet\{[^}]*transform:translateY\(110%\)/);
    expect(css).toMatch(/\.sheet\.on\{transform:translateY\(0\)\}/);
  });
});
