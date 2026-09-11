/**
 * The attention cues: two sounds, a flashing tab title, a vibration.
 *
 * ── What I could and could not verify ────────────────────────────────────
 *
 * These tests assert the SHAPE of the sounds — frequencies, envelopes,
 * lengths, gain — and the autoplay-unlock discipline. They cannot assert that
 * the two are distinguishable through a pocket over a television, which is the
 * actual requirement. That needs a human and a real phone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROUND_START, ROUND_END, DEFAULT_GAIN, unlockAudio, audioContext,
  play, soundEnabled, setSoundEnabled, __resetAudio,
} from '../../client/src/lib/sounds.js';
import { canVibrate, vibrate, createTitleFlasher } from '../../client/src/lib/attention.js';

/** A recording AudioContext: enough surface for the module, nothing more. */
const fakeAudio = (state = 'running') => {
  const events = [];
  const ctx = {
    state,
    currentTime: 0,
    resume: vi.fn(() => { ctx.state = 'running'; }),
    createOscillator: () => {
      const osc = {
        type: '', connect() {}, start(t) { events.push(['start', t]); },
        stop(t) { events.push(['stop', t]); },
        frequency: {
          setValueAtTime: (v, t) => events.push(['freq', v, t]),
          linearRampToValueAtTime: (v, t) => events.push(['freqRamp', v, t]),
        },
      };
      return osc;
    },
    createGain: () => ({
      connect() {},
      gain: {
        setValueAtTime: (v, t) => events.push(['gain', v, t]),
        linearRampToValueAtTime: (v, t) => events.push(['gainRamp', v, t]),
      },
    }),
    destination: {},
    events,
  };
  return ctx;
};

const withWindow = (ctx) => ({ AudioContext: function AC() { return ctx; } });

beforeEach(() => { __resetAudio(); });
afterEach(() => { __resetAudio(); vi.useRealTimers(); });

describe('the two sounds are actually different', () => {
  it('start is low and square, end is high and sine', () => {
    expect(ROUND_START.type).toBe('square');
    expect(ROUND_END.type).toBe('sine');
    expect(ROUND_START.freq).toBeLessThan(ROUND_END.freq);
  });

  it('they are far enough apart in pitch to read as two sounds', () => {
    // More than two octaves. If they turn out too close in a real room this
    // is the first constant to pull further apart.
    expect(ROUND_END.freq / ROUND_START.freq).toBeGreaterThanOrEqual(4);
  });

  it('start buzzes, end does not', () => {
    expect(ROUND_START.pulses).toBeGreaterThan(1);
    expect(ROUND_END.pulses).toBe(1);
  });

  it('end falls in pitch — the resolving part', () => {
    expect(ROUND_END.freqTo).toBeLessThan(ROUND_END.freq);
  });

  it('both are short, 150-400ms', () => {
    for (const s of [ROUND_START, ROUND_END]) {
      expect(s.ms).toBeGreaterThanOrEqual(150);
      expect(s.ms).toBeLessThanOrEqual(400);
    }
  });

  it('ships at a low default gain, not muted', () => {
    expect(DEFAULT_GAIN).toBeGreaterThan(0);
    expect(DEFAULT_GAIN).toBeLessThanOrEqual(0.2);
  });

  it('adds no audio files to the bundle', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    // Comments stripped: the file EXPLAINS why there are no .mp3s, so the
    // word appears in its own documentation. Same trap as the alert() and
    // "no real clubs" scanners.
    const src = fs.readFileSync(
      path.resolve(here, '..', '..', 'client/src/lib/sounds.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(src, 'an audio asset crept in').not.toMatch(/\.mp3|\.wav|\.ogg|new Audio\(/);
    // ...and the scanner still fires on real code.
    expect(/new Audio\(/.test("const a = new Audio('x.mp3');")).toBe(true);
  });
});

describe('the autoplay unlock, which is what silently fails', () => {
  it('does not create a context at module load', () => {
    // A context created before a user gesture starts suspended on iOS and
    // every sound fails with no error and nothing to debug.
    expect(audioContext(), 'a context existed before any gesture').toBeNull();
  });

  it('creates one on the gesture, and resumes a suspended one', () => {
    const ctx = fakeAudio('suspended');
    const out = unlockAudio(withWindow(ctx));
    expect(out).toBe(ctx);
    expect(ctx.resume, 'a suspended context was left suspended').toHaveBeenCalled();
  });

  it('is safe to call repeatedly', () => {
    const ctx = fakeAudio();
    const win = withWindow(ctx);
    expect(unlockAudio(win)).toBe(unlockAudio(win));
  });

  it('refuses to play before the unlock', () => {
    expect(play(ROUND_START, { enabled: true }), 'played with no context').toBe(false);
  });

  it('refuses to play while the context is still suspended', () => {
    const ctx = fakeAudio('suspended');
    ctx.resume = vi.fn();          // a resume that has not taken effect yet
    unlockAudio(withWindow(ctx));
    ctx.state = 'suspended';
    expect(play(ROUND_START, { enabled: true })).toBe(false);
  });

  it('survives a browser with no Web Audio at all', () => {
    expect(unlockAudio({})).toBeNull();
    expect(unlockAudio(null)).toBeNull();
  });
});

describe('playing', () => {
  it('schedules an oscillator with the spec it was given', () => {
    const ctx = fakeAudio();
    unlockAudio(withWindow(ctx));
    expect(play(ROUND_START, { enabled: true })).toBe(true);
    const freqs = ctx.events.filter((e) => e[0] === 'freq').map((e) => e[1]);
    expect(freqs).toContain(ROUND_START.freq);
    expect(ctx.events.some((e) => e[0] === 'start')).toBe(true);
    expect(ctx.events.some((e) => e[0] === 'stop')).toBe(true);
  });

  it('cuts the envelope into pulses for the buzz', () => {
    const ctx = fakeAudio();
    unlockAudio(withWindow(ctx));
    play(ROUND_START, { enabled: true });
    const rises = ctx.events.filter((e) => e[0] === 'gainRamp' && e[1] > 0);
    expect(rises.length, 'the start sound is a single beep, not a buzz')
      .toBeGreaterThanOrEqual(ROUND_START.pulses);
  });

  it('does not play when the device has turned sound off', () => {
    const ctx = fakeAudio();
    unlockAudio(withWindow(ctx));
    expect(play(ROUND_START, { enabled: false })).toBe(false);
    expect(ctx.events).toHaveLength(0);
  });

  it('never throws, whatever happens', () => {
    const ctx = fakeAudio();
    ctx.createOscillator = () => { throw new Error('audio hardware gone'); };
    unlockAudio(withWindow(ctx));
    expect(() => play(ROUND_START, { enabled: true })).not.toThrow();
    expect(play(ROUND_START, { enabled: true })).toBe(false);
  });
});

describe('the toggle', () => {
  const store = ({ broken = false } = {}) => {
    const map = new Map();
    return {
      getItem: (k) => { if (broken) throw new Error('no'); return map.has(k) ? map.get(k) : null; },
      setItem: (k, v) => { if (broken) throw new Error('no'); map.set(k, v); },
    };
  };

  it('is ON by default — a sound nobody has heard cannot be tuned', () => {
    expect(soundEnabled(store())).toBe(true);
  });

  it('remembers OFF per device', () => {
    const s = store();
    setSoundEnabled(false, s);
    expect(soundEnabled(s)).toBe(false);
    setSoundEnabled(true, s);
    expect(soundEnabled(s)).toBe(true);
  });

  it('stays on when storage is unavailable', () => {
    expect(soundEnabled(store({ broken: true }))).toBe(true);
    expect(soundEnabled(null)).toBe(true);
    expect(() => setSoundEnabled(false, store({ broken: true }))).not.toThrow();
  });
});

describe('vibration is feature-detected, never assumed', () => {
  it('is off on a browser without it — which is every iPhone', () => {
    expect(canVibrate({})).toBe(false);
    expect(canVibrate(null)).toBe(false);
    expect(vibrate([60], {}), 'called vibrate on a browser without it').toBe(false);
  });

  it('buzzes where it exists', () => {
    const nav = { vibrate: vi.fn(() => true) };
    expect(vibrate([60, 50, 60], nav)).toBe(true);
    expect(nav.vibrate).toHaveBeenCalledWith([60, 50, 60]);
  });

  it('does not throw if the call is refused', () => {
    const nav = { vibrate: () => { throw new Error('blocked'); } };
    expect(vibrate([60], nav)).toBe(false);
  });
});

describe('the tab title flashes only while nobody is looking', () => {
  it('does nothing while the tab is visible', () => {
    const doc = { hidden: false, title: 'Shotgun Formation' };
    const f = createTitleFlasher(doc);
    expect(f.start('Round!')).toBe(false);
    expect(doc.title, 'flashed a title at somebody who was looking at it')
      .toBe('Shotgun Formation');
  });

  it('alternates while hidden', () => {
    vi.useFakeTimers();
    const doc = { hidden: true, title: 'Shotgun Formation' };
    const f = createTitleFlasher(doc);
    f.start('Round!', 100);
    expect(doc.title).toBe('Round!');
    vi.advanceTimersByTime(100);
    expect(doc.title).toBe('Shotgun Formation');
    vi.advanceTimersByTime(100);
    expect(doc.title).toBe('Round!');
  });

  it('restores the ORIGINAL title on stop, whatever it was', () => {
    vi.useFakeTimers();
    const doc = { hidden: true, title: 'Something else entirely' };
    const f = createTitleFlasher(doc);
    f.start('Round!', 100);
    vi.advanceTimersByTime(250);
    f.stop();
    expect(doc.title).toBe('Something else entirely');
    expect(f.running).toBe(false);
  });

  it('does not stack timers if started twice', () => {
    vi.useFakeTimers();
    const doc = { hidden: true, title: 'T' };
    const f = createTitleFlasher(doc);
    f.start('A', 100);
    f.start('B', 100);
    vi.advanceTimersByTime(100);
    expect(doc.title, 'a second start clobbered the first').toBe('T');
    f.stop();
    expect(doc.title).toBe('T');
  });

  it('survives having no document', () => {
    const f = createTitleFlasher(null);
    expect(f.start('x')).toBe(false);
    expect(() => f.stop()).not.toThrow();
  });
});

describe('nothing here asks for a permission', () => {
  it('never touches Notification or a service worker', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const dir = path.resolve(here, '..', '..', 'client/src/lib');
    for (const f of ['sounds.js', 'attention.js']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      expect(src, `${f} asks for a permission`)
        .not.toMatch(/Notification|requestPermission|serviceWorker|pushManager/);
    }
  });
});

/**
 * The wiring. Structural, because the thing that goes wrong here is not a
 * wrong value — it is the AudioContext being created in the wrong PLACE, which
 * no unit test can hear.
 */
describe('where the unlock happens', () => {
  const app = () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const url = require('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return fs.readFileSync(path.resolve(here, '..', '..', 'client/src/App.js'), 'utf8');
  };

  it('unlocks on a real gesture, not at module load', () => {
    const src = app();
    expect(src).toMatch(/const unlockOnGesture = \(\) => \{ unlockAudio\(\); \}/);
    // Create/join taps and the age gate — all real taps, all before a round.
    expect(src, 'create/join does not unlock audio').toMatch(/unlockOnGesture\(\);\s*\n\s*if \(ageOk\)/);
    expect(src, 'passing the age gate does not unlock audio')
      .toMatch(/onPass=\{\(\) => \{\s*\n\s*unlockOnGesture\(\);/);
  });

  it('plays the START sound only for a real card, not the clear', () => {
    // `declaredCard` is also broadcast as null to END a round; treating that
    // as a start would buzz twice per round.
    const src = app();
    const at = src.indexOf("socket.on('declaredCard'");
    expect(src.slice(at, at + 400)).toMatch(/if \(cardType\) \{[\s\S]*?playRoundStart/);
  });

  it('plays the END sound when the round finalizes', () => {
    const src = app();
    const at = src.indexOf('if (roundFinalized === true) {');
    expect(src.slice(at, at + 300)).toMatch(/playRoundEnd/);
  });

  it('stops the title flashing when the round ends', () => {
    const src = app();
    const at = src.indexOf('if (roundFinalized === true) {');
    expect(src.slice(at, at + 300)).toMatch(/flasherRef\.current\.stop\(\)/);
  });

  it('clears the flash when the tab is looked at', () => {
    expect(app()).toMatch(/visibilitychange/);
  });
});
