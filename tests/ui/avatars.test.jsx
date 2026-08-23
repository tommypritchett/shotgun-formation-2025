/**
 * Avatars must not care how many avatars there are.
 *
 * The sheet went from 8 characters to 10 mid-session, dropped in wholesale.
 * Nothing may hardcode a count: everything derives from AVATARS.length, so the
 * next sheet is a drop-in with no other edits.
 *
 * The rules being pinned here:
 *   - the character is deterministic from the player's NAME, so the same
 *     person is the same character in every game they ever play;
 *   - with <= N players and N characters, nobody shares a character;
 *   - above N sharing is unavoidable, so a per-player accent RING keeps two
 *     players on the same character apart.
 */
import { describe, expect, it } from 'vitest';
// Data comes from the generated file; the LOGIC lives in lib/avatars.js so a
// regenerated sheet cannot revert it. It has twice.
import { AVATARS, assignAvatars, avatarFor, hashName } from '../../client/src/lib/avatars.js';

const roster = (n) => Array.from({ length: n }, (_, i) => ({ name: `Player${i + 1}` }));
const N = AVATARS.length;

describe('the avatar sheet', () => {
  it('exposes a non-trivial set with everything a tile needs', () => {
    expect(N).toBeGreaterThanOrEqual(8);
    for (const a of AVATARS) {
      expect(a.id, 'every avatar needs a stable id').toBeTruthy();
      expect(a.label, 'every avatar needs a human label').toBeTruthy();
      expect(a.src, `${a.id} has no image`).toMatch(/^data:image\//);
      expect(a.ring, `${a.id} has no ring colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('has unique ids and unique ring colours', () => {
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(N);
    expect(new Set(AVATARS.map((a) => a.ring)).size).toBe(N);
  });

  it('does not reserve the deck accents — those mean something else', () => {
    // amber = Standard, neon = Wild, red = the 40-drink monsters.
    const reserved = ['#ffb020', '#8aff3d', '#ff4a33'];
    for (const a of AVATARS) {
      expect(reserved).not.toContain(a.ring.toLowerCase());
    }
  });
});

describe('assignment is deterministic by name', () => {
  it('gives the same person the same character in a different room', () => {
    const a = assignAvatars([{ name: 'Tommy' }, { name: 'Marcus' }, { name: 'Ava' }]);
    const b = assignAvatars([{ name: 'Ava' }, { name: 'Tommy' }, { name: 'Marcus' }]);
    for (const name of ['Tommy', 'Marcus', 'Ava']) {
      expect(b[name].id, `${name} changed character when the roster order changed`)
        .toBe(a[name].id);
    }
  });

  it('ignores case and surrounding whitespace', () => {
    expect(hashName('  Tommy ')).toBe(hashName('tommy'));
  });

  it('is stable across repeated calls', () => {
    const one = assignAvatars(roster(13));
    const two = assignAvatars(roster(13));
    expect(Object.fromEntries(Object.entries(two).map(([k, v]) => [k, v.id])))
      .toEqual(Object.fromEntries(Object.entries(one).map(([k, v]) => [k, v.id])));
  });
});

describe(`a full table of ${N} shares nobody`, () => {
  it('gives every player a distinct character', () => {
    const map = assignAvatars(roster(N));
    const ids = Object.values(map).map((a) => a.id);
    expect(ids).toHaveLength(N);
    expect(new Set(ids).size, 'two players were given the same character').toBe(N);
  });

  it('still assigns everyone below a full table', () => {
    const map = assignAvatars(roster(4));
    expect(new Set(Object.values(map).map((a) => a.id)).size).toBe(4);
  });
});

describe('past a full table, the ring keeps repeats apart', () => {
  // 13 is the maximum the game allows; with 10 characters that is 3 repeats.
  const map = assignAvatars(roster(13));

  it('assigns all 13 players', () => {
    expect(Object.keys(map)).toHaveLength(13);
  });

  it('uses every character before repeating any', () => {
    const counts = {};
    Object.values(map).forEach((a) => { counts[a.id] = (counts[a.id] || 0) + 1; });
    expect(Object.keys(counts).length, 'a character went unused while another repeated').toBe(N);
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(Math.ceil(13 / N));
  });

  it('gives every player sharing a character a DIFFERENT ring', () => {
    const byCharacter = {};
    Object.entries(map).forEach(([name, a]) => {
      (byCharacter[a.id] = byCharacter[a.id] || []).push({ name, ring: a.ring });
    });
    for (const [id, group] of Object.entries(byCharacter)) {
      if (group.length < 2) continue;
      const rings = group.map((g) => g.ring);
      expect(
        new Set(rings).size,
        `${group.map((g) => g.name).join(' and ')} share character "${id}" AND ring ${rings[0]}`
      ).toBe(group.length);
    }
  });

  it('gives every player a ring at all', () => {
    Object.values(map).forEach((a) => expect(a.ring).toMatch(/^#[0-9A-Fa-f]{6}$/));
  });
});

describe('the single-name fallback', () => {
  it('returns a real avatar with a ring', () => {
    const a = avatarFor('Someone');
    expect(a.src).toMatch(/^data:image\//);
    expect(a.ring).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('agrees with assignAvatars when there is no contention', () => {
    expect(assignAvatars([{ name: 'Solo' }]).Solo.id).toBe(avatarFor('Solo').id);
  });
});
