/**
 * Two short sounds, generated — no audio files.
 *
 * Somebody flicks to another app for ten seconds and a round starts. That is
 * the case this covers. Web Push was ruled out by the owner: it does not work
 * in an ordinary iOS Safari tab without adding the site to the Home Screen
 * first, which means asking a stranger to install a pseudo-app and grant a
 * permission, in a product whose promise is "no app, no signup".
 *
 * ── Why an oscillator and not an .mp3 ────────────────────────────────────
 *
 *  - nothing added to a bundle phones on cellular are already waiting on
 *  - no decode latency, no first-play stall
 *  - and the one that matters: pitch, length and volume are CONSTANTS below,
 *    tunable in one line after the first real game night
 *
 * ── THESE NUMBERS ARE EXPECTED TO BE TUNED ───────────────────────────────
 *
 * They have not been heard in a room yet. The two must be unmistakable from
 * each other through a pocket, once, over a television and nine people
 * talking — so they differ in pitch direction, waveform, length AND texture,
 * not just one of those:
 *
 *   ROUND_START  a BUZZ. Low, square, and deliberately amplitude-modulated
 *                into two pulses — the "look at your phone" sound. Square wave
 *                is rich in harmonics, which is what survives a trouser pocket.
 *   ROUND_END    a RESOLVING TONE. Higher, sine, smooth, falling in pitch —
 *                the "that's done" sound. No modulation, so it reads as one
 *                soft note against the start's rattle.
 *
 * If they turn out too similar in a real room, the first thing to change is
 * START_FREQ vs END_FREQ_FROM — pull them further apart before touching
 * anything else.
 */

/** Round starting: low, square, buzzing. ~260ms. */
export const ROUND_START = {
  type: 'square',
  freq: 110,          // Hz — low A, felt as much as heard
  freqTo: 98,         // falls slightly, which reads as insistent rather than musical
  ms: 260,
  pulses: 2,          // amplitude-modulated into two bursts: the "buzz"
  attack: 0.005,
  release: 0.06,
};

/** Round over: higher, sine, falling, smooth. ~340ms. */
export const ROUND_END = {
  type: 'sine',
  freq: 660,          // Hz — E5, well clear of the start's 110
  freqTo: 440,        // falls a fifth: the "resolving" part
  ms: 340,
  pulses: 1,
  attack: 0.02,
  release: 0.22,      // long tail, so it fades rather than stops
};

/**
 * Default gain.
 *
 * Low on purpose: audible from a pocket, not startling in a quiet room. Ships
 * ON at this level rather than muted — a sound nobody has heard cannot be
 * tuned, and the first real party is the test.
 */
export const DEFAULT_GAIN = 0.15;

const KEY = 'shotgunFormation_soundOn';

let ctx = null;

/** localStorage, or null if touching it throws at all. */
const safeStorage = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

/** On by default; off only if this device has explicitly turned it off. */
export const soundEnabled = (store = safeStorage()) => {
  if (!store) return true;
  try {
    return store.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

export const setSoundEnabled = (on, store = safeStorage()) => {
  if (!store) return;
  try {
    store.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Nothing to do. They get the default next load.
  }
};

/**
 * Create or resume the AudioContext, ON A USER GESTURE.
 *
 * This is the part that silently does not work if it is done anywhere else.
 * Browsers block audio until the user has interacted with the page and iOS
 * Safari is the strictest: a context created before a gesture starts
 * `suspended` and every sound fails with no error, no warning and nothing to
 * debug. So this is called from joining a room and from passing the age gate —
 * both real taps, both before any round can start.
 *
 * Safe to call repeatedly.
 */
export const unlockAudio = (win = (typeof window !== 'undefined' ? window : null)) => {
  if (!win) return null;
  const AC = win.AudioContext || win.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

/** The live context, if audio has been unlocked. Never creates one. */
export const audioContext = () => ctx;

/** Test seam. */
export const __resetAudio = () => { ctx = null; };

/**
 * Play one of the two sounds.
 *
 * Fails silently and returns false if audio is unavailable, locked or off.
 * A missed sound must never be an error a player can see.
 */
export const play = (spec, { gain = DEFAULT_GAIN, enabled = null } = {}) => {
  if (!spec) return false;
  const on = enabled === null ? soundEnabled() : enabled;
  if (!on) return false;
  const ac = ctx;
  if (!ac || ac.state !== 'running') return false;

  try {
    const now = ac.currentTime;
    const dur = spec.ms / 1000;

    const osc = ac.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, now);
    if (spec.freqTo && spec.freqTo !== spec.freq) {
      osc.frequency.linearRampToValueAtTime(spec.freqTo, now + dur);
    }

    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, now);

    // A pulse count > 1 chops the envelope into bursts, which is what makes
    // the start sound a BUZZ rather than a beep.
    const n = Math.max(1, spec.pulses || 1);
    const slot = dur / n;
    for (let i = 0; i < n; i += 1) {
      const t0 = now + i * slot;
      amp.gain.setValueAtTime(0, t0);
      amp.gain.linearRampToValueAtTime(gain, t0 + spec.attack);
      amp.gain.linearRampToValueAtTime(0, t0 + slot * 0.92);
    }
    amp.gain.linearRampToValueAtTime(0, now + dur + spec.release);

    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + spec.release);
    return true;
  } catch {
    return false;
  }
};

export const playRoundStart = (opts) => play(ROUND_START, opts);
export const playRoundEnd = (opts) => play(ROUND_END, opts);

export default {
  ROUND_START, ROUND_END, DEFAULT_GAIN,
  unlockAudio, audioContext, play, playRoundStart, playRoundEnd,
  soundEnabled, setSoundEnabled,
};
