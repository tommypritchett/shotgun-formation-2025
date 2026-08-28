/**
 * How players are assigned a character and an accent ring.
 *
 * ⚠️ THIS LOGIC LIVES HERE, NOT IN components/Avatars.js, ON PURPOSE.
 *
 * `components/Avatars.js` is regenerated and dropped into the repo wholesale
 * whenever the character sheet changes. That has now silently reverted work
 * twice: the first drop deleted the `CAN` export and broke the build, and the
 * second reverted the ring-collision fix below. `CanMark.js` was moved out for
 * the first reason and survived the second drop untouched — so the same split
 * is applied here.
 *
 * The rule: `components/Avatars.js` is DATA (the AVATARS array, nothing else).
 * Anything that thinks lives in this file.
 */
import { AVATARS } from '../components/Avatars';

/**
 * The ring palette, derived from the sheet so it grows with it. These are the
 * only colours allowed for player identity — amber, neon and red are reserved
 * for deck semantics (Standard / Wild / the 40-drink cards).
 */
export const RING_COLORS = AVATARS.map((a) => a.ring);

/** Stable, case- and whitespace-insensitive hash of a player name. */
export function hashName(name) {
  const s = String(name || '').trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Assign a character to every player, deterministic by name, so the same
 * person is the same character in every game they ever play.
 *
 * Nobody shares a character while there are enough to go round. Past that,
 * sharing is unavoidable and the RING is what still tells two players apart —
 * so the ring must be unique among the players sharing a character. Hashing
 * the ring independently is NOT enough: it lets two players collide on the
 * character and the ring at once, which is precisely the case the ring exists
 * to prevent. With 13 players and 10 characters, Player9 and Player13 both
 * landed on Victory Pour with ring #FF8FB1.
 */
export function assignAvatars(players = []) {
  const n = AVATARS.length;
  const taken = new Set();
  /** avatar index -> ring indices already handed out for that character */
  const ringsUsed = new Map();
  const out = {};

  [...players]
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    .forEach((p) => {
      const key = String(p?.name || '');
      const h = hashName(key);

      // Character: your own hash first, stepping on only if it is spoken for.
      let idx = h % n;
      for (let step = 0; step < n && taken.has(idx); step += 1) idx = (idx + 1) % n;
      if (taken.size < n) taken.add(idx);

      // Ring: your own hash first, stepped on until unique among the players
      // sharing this character.
      const used = ringsUsed.get(idx) || new Set();
      let ring = (h >> 5) % n;
      for (let step = 0; step < n && used.has(ring); step += 1) ring = (ring + 1) % n;
      used.add(ring);
      ringsUsed.set(idx, used);

      out[key] = { ...AVATARS[idx], index: idx, ring: RING_COLORS[ring], ringIndex: ring };
    });
  return out;
}

/** Single-player lookup when the roster is not to hand. Prefer assignAvatars. */
export function avatarFor(name) {
  const h = hashName(name);
  const a = AVATARS[h % AVATARS.length];
  return { ...a, ring: RING_COLORS[(h >> 5) % RING_COLORS.length] };
}

export { AVATARS };
