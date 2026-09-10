/**
 * "Follow a game" — the walkthrough, and How to Play.
 *
 * One build, two audiences:
 *
 *   /how-to-play          self-paced, with controls, linked from the app
 *   /how-to-play?clean=1  autoplays, every control hidden — this is the URL
 *                         that gets screen-recorded and the one that gets sent
 *                         to people who will judge the project on it
 *
 * ── No server, no socket, no feed ────────────────────────────────────────
 *
 * Everything here is scripted in `script.js` and rendered locally. The route
 * mounts and runs to completion with the game server switched off, on a
 * Tuesday in July, with no fixture file and no network at all. That is a
 * requirement rather than a nicety: it will be opened by strangers on bad wifi,
 * and reliability matters more than fidelity.
 *
 * ── Determinism ──────────────────────────────────────────────────────────
 *
 * The clock is a frame loop accumulating `elapsed` from rAF deltas, and every
 * visible thing is a pure function of `elapsed`. No Math.random, no Date.now.
 * Stepping to beat 8 shows exactly what playing to beat 8 shows, which is what
 * makes `?beat=8` usable for re-shooting the climax without replaying the top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BEATS, SLATE, PLAYERS, HANDS, FOLLOWED_ID, END_CARD, TOTAL_MS } from './script';
import { assignAvatars } from '../lib/avatars';
import { pourDrinks, totalDrinks } from './lines';
import { DRINKS_PER_SHOTGUN } from '../data/cards';
import DemoPicker from './DemoPicker';
import DemoPhone from './DemoPhone';
import DemoFeed from './DemoFeed';
import './demo.css';

const SPEEDS = [1, 2, 3];

/** A fixed room code, so the header reads like a real game. Never dialled. */
const ROOM_CODE = '48213';

/** Cumulative start time of each beat, so elapsed -> beat is a lookup. */
const STARTS = BEATS.reduce((acc, b) => {
  acc.push((acc[acc.length - 1] || 0) + b.ms);
  return acc;
}, []);
const beatStart = (i) => (i === 0 ? 0 : STARTS[i - 1]);

/**
 * The whole stage, derived from a single number.
 *
 * Rebuilt from beat 1 every time rather than mutated forwards, which is what
 * makes stepping BACKWARDS work without a separate undo path — there is only
 * one way state is computed, so there is only one way it can be wrong.
 */
const stageAt = (elapsed) => {
  const state = {
    screen: 'picker',
    pickedId: null,
    hovering: null,
    declared: null,
    showStandings: false,
    score: { away: 14, home: 10 },
    scoreDetail: 'Q2 8:41',
    lines: [],
    caption: null,
    caption2: null,
    totals: {},
    secondsLeft: 0,
    given: {},
    boardTab: 'stand',
    lastRoundCardId: null,
  };
  PLAYERS.forEach((p) => {
    state.totals[p.name] = { drinks: 0, shotguns: 0 };
    state.given[p.name] = { shotguns: {}, drinks: {} };
  });

  const byName = Object.fromEntries(PLAYERS.map((p) => [p.name, p]));
  /** Ten-to-one, once, exactly as the server folds it. */
  const add = (name, drinks) => {
    const t = state.totals[name];
    if (!t) return;
    const raw = t.drinks + drinks;
    t.shotguns += Math.floor(raw / DRINKS_PER_SHOTGUN);
    t.drinks = raw % DRINKS_PER_SHOTGUN;
  };

  let key = 0;
  for (let i = 0; i < BEATS.length; i += 1) {
    const beat = BEATS[i];
    const start = beatStart(i);
    if (elapsed < start) break;
    const into = elapsed - start;
    const live = into < beat.ms;

    Object.assign(state, beat.set || {});
    if (beat.caption) { state.caption = beat.caption; state.caption2 = beat.caption2 || null; }
    else if (beat.set && beat.set.declared !== undefined) { state.caption = null; state.caption2 = null; }

    // A new round is a clean slate for what has been poured.
    if (beat.set && 'declared' in beat.set) {
      PLAYERS.forEach((p) => { state.given[p.name] = { shotguns: {}, drinks: {} }; });
    }

    if (beat.pickAt !== undefined) {
      state.hovering = FOLLOWED_ID;
      state.pickedId = into >= beat.pickAt ? FOLLOWED_ID : null;
    }

    // The round clock, ticking inside the beat like the real one does.
    if (beat.set && beat.set.round) {
      const secs = beat.set.round.seconds;
      state.secondsLeft = live
        ? Math.max(0, Math.ceil(secs - (into / 1000)))
        : 0;
    }

    for (const entry of (beat.feed || [])) {
      key += 1;
      if (into < entry.at) continue;
      state.lines.push({ ...entry, key: `l${key}` });
    }

    // Pours land into the holder's `given` map, which is what drives the
    // real assigner's tallies, and into the recipient's totals.
    for (const pour of (beat.pours || [])) {
      if (into < pour.at) continue;
      const toId = byName[pour.to] && byName[pour.to].id;
      const bucket = pour.shotgun ? 'shotguns' : 'drinks';
      const g = state.given[pour.from];
      if (g && toId) g[bucket][toId] = (g[bucket][toId] || 0) + pour.n;
      add(pour.to, pour.shotgun ? pour.n * DRINKS_PER_SHOTGUN : pour.n);
    }

    // First Down: everyone, once.
    if (beat.everyone && into >= 800) {
      PLAYERS.forEach((p) => add(p.name, beat.everyone));
    }

    if (beat.set && beat.set.declared && beat.set.declared.cardId) {
      state.lastRoundCardId = beat.set.declared.cardId;
    }
  }
  return state;
};

/**
 * What one player's phone shows right now.
 *
 * `owed` is the whole point: the holder gets a pool to hand out, everybody else
 * gets the same component in `passive` mode. That is the real game's behaviour
 * and it is what a new player most needs to see — "what happens when I don't
 * have the card" is most of the game.
 */
const viewFor = (player, stage, roomCode) => {
  const d = stage.declared;
  const hand = HANDS[player.name] || { standard: [], wild: [] };

  /**
   * Copies come from THIS player's own hand, not from the script.
   *
   * In the real game every holder of the declared card pours — a card held by
   * three people opens three assigners, each with its own pool. An earlier
   * version read `copies` off the script and gave the pool to one nominated
   * player, which showed two people the passive screen while the game would
   * have shown them a pool. That is a misrepresentation in an asset whose
   * entire job is to show what the game does, and a test caught it.
   */
  const copiesHeld = d && d.cardId
    ? [...hand.standard, ...hand.wild].filter((id) => id === d.cardId).length
    : 0;
  let owed = { shotguns: 0, drinks: 0 };
  if (copiesHeld > 0) {
    const total = totalDrinks(d.cardId, copiesHeld);
    owed = {
      shotguns: Math.floor(total / DRINKS_PER_SHOTGUN),
      drinks: total % DRINKS_PER_SHOTGUN,
    };
  }
  return {
    declared: d ? { ...d, copies: copiesHeld || d.copies } : d,
    owed,
    given: stage.given[player.name],
    secondsLeft: stage.secondsLeft,
    hand,
    quarter: 2,
    roomCode,
    watching: stage.watching || null,
    boardTab: stage.boardTab,
    lastRoundCardId: stage.lastRoundCardId,
    lastRoundRows: [],
    source: d && d.cardId ? 'The game called it' : null,
  };
};

const clampBeat = (n) => Math.min(BEATS.length, Math.max(1, n || 1));

export default function Demo() {
  const params = useMemo(
    () => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );
  const clean = params.get('clean') === '1';
  const startBeat = params.has('beat') ? clampBeat(Number(params.get('beat'))) : 1;
  const startVertical = params.has('vertical') || params.get('aspect') === '9:16';

  const [elapsed, setElapsed] = useState(() => beatStart(startBeat - 1));
  const [playing, setPlaying] = useState(true);
  // Fast by default: the sequence is a demo, not a tutorial to sit through.
  const [speed, setSpeed] = useState(2);
  const [vertical, setVertical] = useState(startVertical);
  const [captionsOn, setCaptionsOn] = useState(true);

  const raf = useRef(0);
  const last = useRef(null);

  useEffect(() => {
    if (!playing) { last.current = null; return undefined; }
    const tick = (now) => {
      if (last.current === null) last.current = now;
      const delta = now - last.current;
      last.current = now;
      setElapsed((e) => {
        const next = e + delta * speed;
        if (next >= TOTAL_MS) { setPlaying(false); return TOTAL_MS; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);

  const stage = useMemo(() => stageAt(elapsed), [elapsed]);
  const beatIndex = useMemo(() => {
    let i = 0;
    for (let k = 0; k < BEATS.length; k += 1) if (elapsed >= beatStart(k)) i = k;
    return i;
  }, [elapsed]);

  const goToBeat = useCallback((n) => {
    const i = clampBeat(n) - 1;
    last.current = null;
    setElapsed(beatStart(i));
  }, []);

  const avatars = useMemo(() => assignAvatars(PLAYERS), []);
  const players = useMemo(
    () => PLAYERS.map((p) => {
      const a = avatars[p.name] || {};
      return { ...p, avatar: a.src, avatarRing: a.ring };
    }),
    [avatars],
  );

  /**
   * The roster as every screen sees it: avatars, live totals, and who holds
   * the whistle. Built once per frame and shared, because all three phones are
   * looking at the same table.
   */
  const boardPlayers = useMemo(
    () => players.map((p) => ({
      ...p,
      totalDrinks: stage.totals[p.name].drinks,
      totalShotguns: stage.totals[p.name].shotguns,
      isSelf: false,
      isRef: Boolean(p.isRef),
    })),
    [players, stage.totals],
  );

  /** "handing out" vs "drinking" is decided by the hand, like the pool is. */
  const labelFor = (p, st) => {
    const d = st.declared;
    if (!d) return p.name;
    if (d.globalEvent) return `${p.name} — everyone drinks`;
    const hand = HANDS[p.name] || { standard: [], wild: [] };
    const holds = [...hand.standard, ...hand.wild].some((id) => id === d.cardId);
    return holds ? `${p.name} — handing out` : `${p.name} — drinking`;
  };

  const followed = SLATE.find((g) => g.id === FOLLOWED_ID);
  const atEnd = stage.screen === 'end';

  return (
    <div className={`demo${vertical ? ' vertical' : ''}${clean ? ' clean' : ''}`}>
      {/* Header: the game being followed, score and clock. */}
      {stage.screen !== 'picker' && !atEnd ? (
        <header className="dhead">
          <span className="dh-follow">Following</span>
          <span className="dh-teams">
            {followed.away.name} <span className="at">@</span> {followed.home.name}
          </span>
          <span className="dh-score">{stage.score.away}–{stage.score.home}</span>
          <span className="dh-clock">{stage.scoreDetail}</span>
        </header>
      ) : null}

      <main className="dbody">
        {stage.screen === 'picker' ? (
          <DemoPicker games={SLATE} pickedId={stage.pickedId} hovering={stage.hovering} />
        ) : null}

        {stage.screen === 'board' ? (
          <>
            {stage.declared ? (
              <div className="ddeclared" aria-live="polite">
                <span className="dd-what">
                  {stage.declared.globalEvent || stage.declared.cardId}
                </span>
                {stage.declared.holder ? (
                  <span className="dd-who">{stage.declared.holder} is holding it</span>
                ) : (
                  <span className="dd-who">Everyone drinks 1</span>
                )}
              </div>
            ) : null}

            {/* Three REAL screens, side by side. The holder is handing out
                drinks; the other two are on the same component in passive
                mode, which is what the game actually shows them. */}
            <div className="dphones">
              {players.map((p) => (
                <DemoPhone
                  key={p.id}
                  player={p}
                  players={boardPlayers}
                  view={viewFor(p, stage, ROOM_CODE)}
                  label={labelFor(p, stage)}
                />
              ))}
            </div>
          </>
        ) : null}

        {atEnd ? (
          <section className="dend" aria-label="Play Shotgun Formation">
            <h1>{END_CARD.title}</h1>
            <p className="de-line">{END_CARD.line}</p>
            <p className="de-url">{END_CARD.url}</p>
            <p className="de-sub">{END_CARD.sub}</p>
            {!clean ? <a className="de-cta" href="/">{END_CARD.cta}</a> : null}
          </section>
        ) : null}
      </main>

      {stage.screen === 'board' ? <DemoFeed lines={stage.lines} /> : null}

      {captionsOn && stage.caption && !atEnd ? (
        <div className="dcap">
          <p>{stage.caption}</p>
          {stage.caption2 ? <p className="dcap2">{stage.caption2}</p> : null}
        </div>
      ) : null}

      {/* Clean mode hides every control. This is the recording URL. */}
      {!clean ? (
        <footer className="dctl">
          <button type="button" onClick={() => goToBeat(1)}>Restart</button>
          <button type="button" onClick={() => goToBeat(beatIndex)}>‹ Beat</button>
          <button type="button" onClick={() => { last.current = null; setPlaying((p) => !p); }}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => goToBeat(beatIndex + 2)}>Beat ›</button>

          <span className="dctl-rail" aria-label="Progress">
            {BEATS.map((b, i) => (
              <button
                type="button"
                key={b.id}
                className={`rail-b${i === beatIndex ? ' on' : ''}`}
                aria-label={`Beat ${b.n}`}
                aria-current={i === beatIndex ? 'true' : undefined}
                onClick={() => goToBeat(b.n)}
              >
                {b.n}
              </button>
            ))}
          </span>

          <span className="dctl-grp">
            {SPEEDS.map((s) => (
              <button
                type="button" key={s}
                className={speed === s ? 'on' : ''}
                onClick={() => setSpeed(s)}
              >{s}×</button>
            ))}
          </span>

          <button type="button" onClick={() => setVertical((v) => !v)}>
            {vertical ? '9:16' : '16:9'}
          </button>
          <button type="button" onClick={() => setCaptionsOn((c) => !c)}>
            {captionsOn ? 'Captions on' : 'Captions off'}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
