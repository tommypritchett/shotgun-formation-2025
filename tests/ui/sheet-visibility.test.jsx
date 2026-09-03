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

  it('the rule it depends on is still in the stylesheet', () => {
    // If `.sheet` stops being a translated bottom sheet, the two tests above
    // are testing a class that no longer means anything.
    const css = fs.readFileSync(path.join(ROOT, 'client/src/styles/game.css'), 'utf8');
    expect(css).toMatch(/\.sheet\{[^}]*transform:translateY\(110%\)/);
    expect(css).toMatch(/\.sheet\.on\{transform:translateY\(0\)\}/);
  });
});
