/**
 * Every modal must have a way out.
 *
 * Two were reported from live play: "Keep my hand" at the quarter break did
 * nothing, and the Ref could not back out of Declare Action. They turned out to
 * be the SAME bug — `closeModal(type)` is a switch that handles three types and
 * falls through to `default: break` for everything else, so both call sites
 * were buttons wired to a function that silently did nothing.
 *
 * These tests read App.js rather than rendering it: the modals live inside a
 * component that opens a real socket at module load, and the thing worth
 * pinning is structural anyway — a close handler that has no case is a dead
 * button no matter what the UI does around it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
  'utf8'
);

/** The switch body of `closeModal`. */
const closeModalBody = () => {
  const start = APP.indexOf('const closeModal = (modalType)');
  expect(start, 'closeModal has been renamed — update this test').toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('\n};', start));
};

describe('closeModal handles everything it is called with', () => {
  const called = [...APP.matchAll(/closeModal\('([^']+)'\)/g)].map((m) => m[1]);
  const handled = [...closeModalBody().matchAll(/case '([^']+)':/g)].map((m) => m[1]);

  it('is actually called somewhere', () => {
    expect(called.length).toBeGreaterThan(0);
  });

  it.each([...new Set(called)])(
    'closeModal(%s) has a matching case, so the button is not dead',
    (type) => {
      expect(
        handled,
        `closeModal('${type}') falls through to default: break — the control that `
          + 'calls it does nothing at all. This is exactly how "Keep my hand" and '
          + 'the Declare Action scrim shipped broken.'
      ).toContain(type);
    }
  );
});

describe('the modals a player can open all offer a way out', () => {
  /** Grab the JSX block for a modal, keyed by its aria-label. */
  const block = (label) => {
    const at = APP.indexOf(`aria-label="${label}"`);
    expect(at, `no modal labelled "${label}"`).toBeGreaterThan(-1);
    // back up to the opening of the conditional, forward to the end of the sheet
    const from = APP.lastIndexOf('{', APP.lastIndexOf('<>', at));
    return APP.slice(from, APP.indexOf('</div>\n          </>', at) + 40);
  };

  it('Declare Action can be dismissed without declaring anything', () => {
    const b = block('Declare action');
    expect(b, 'no tap-outside-to-dismiss').toMatch(/scrim on"\s+onClick=/);
    // Specifically an explicit control, not just the scrim: a Ref who has
    // opened this by accident should not have to know that tapping the dark
    // area backs out. The literal label is asserted so this cannot pass on
    // some unrelated word elsewhere in the block.
    expect(b, 'no explicit close control').toMatch(/>\s*Never mind\s*</);
  });

  it('the wild swap can be declined', () => {
    expect(block('Swap a wild card')).toMatch(/Keep my hand/);
  });

  it('the host picker can be cancelled', () => {
    const b = block('Select a new Ref');
    expect(b).toMatch(/scrim on"\s+onClick=/);
    expect(b).toMatch(/Cancel/);
  });
});
