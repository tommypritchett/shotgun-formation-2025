/**
 * The Ref must not give up the whistle before the server agrees.
 *
 * `handleSelectNewHost` used to emit `assignNewHost` and then immediately drop
 * its own host status and close the sheet. If the server refused — because the
 * target had dropped out — the Ref's own screen dropped the whistle anyway.
 * Nobody at the table then believed they were Ref, only the Ref can declare,
 * and the game stopped: from the exact code path meant to prevent that.
 *
 * Host status changes ONLY when the server says so. Since Session 13 that is
 * one piece of state — `hostId` — and `isHost` is derived from it, so the rule
 * is now: nothing but a server event may call `setHostId`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'App.js'),
  'utf8'
);

/** The handler's CODE, with comments stripped — prose about a past bug is not
 *  the bug. */
const handler = () => {
  const at = APP.indexOf('const handleSelectNewHost');
  expect(at, 'handleSelectNewHost has been renamed — update this test').toBeGreaterThan(-1);
  return APP.slice(at, APP.indexOf('\n};', at))
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
};

describe('handing the whistle over', () => {
  it('does not drop host status optimistically', () => {
    expect(
      /setHostId\(/.test(handler()),
      'handleSelectNewHost sets hostId itself. If the server refuses '
        + 'the handoff, the Ref loses the whistle and nobody has it — which is the '
        + 'failure this whole path exists to prevent. Let the newHost handler do it.'
    ).toBe(false);
  });

  it('still asks the server', () => {
    expect(handler()).toMatch(/socket\.emit\('assignNewHost'/);
  });

  it('does not close the sheet before the answer arrives', () => {
    expect(
      /setIsHostSelection\(\s*false\s*\)/.test(handler()),
      'the sheet closes on tap, so a refusal leaves no way to see the error or '
        + 'pick somebody else'
    ).toBe(false);
  });

  it('leaves host status to the newHost handler', () => {
    const at = APP.indexOf("socket.on('newHost'");
    expect(at, 'no newHost handler').toBeGreaterThan(-1);
    expect(APP.slice(at, at + 400)).toMatch(/setHostId\(\s*newHostId\s*\)/);
  });

  it('keeps isHost derived, so it can never disagree with the badge', () => {
    // Two booleans about the same fact drift. One id does not.
    expect(APP).not.toMatch(/useState\(false\);?\s*\/\/?.*isHost/);
    expect(APP, 'isHost must be computed from hostId, not stored separately')
      .toMatch(/const isHost = Boolean\(hostId\) && hostId === socket\.id/);
  });
});

describe('the handoff sheet lists everyone', () => {
  const sheet = () => {
    const at = APP.indexOf('aria-label="Select a new Ref"');
    return APP.slice(at, APP.indexOf('</div>', APP.indexOf('</>', at)));
  };

  it('shows away players rather than hiding them', () => {
    const s = sheet();
    expect(s, 'still filters away players out — that reads as "they left the game"')
      .not.toMatch(/filter\(\([^)]*\)\s*=>[^)]*!p\.disconnected\)/);
    expect(s, 'no AWAY label').toMatch(/AWAY/);
  });

  it('makes them unselectable', () => {
    expect(sheet()).toMatch(/disabled=\{!!player\.disconnected\}|disabled\b/);
  });

  it('keeps an empty state for when nobody is available', () => {
    expect(sheet()).toMatch(/Everyone else is away|Nobody else/);
  });
});
