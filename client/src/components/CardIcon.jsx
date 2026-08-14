/**
 * Shotgun Formation — card icon set.
 *
 * 24 marks, one per card. Built from things a football fan already recognises:
 * official referee signals, goalposts, the flag, the chains. Solid fills, never
 * thin outlines — outlines turn to mush at card size and on a phone.
 *
 * These are the SAME marks used on the printed deck. The app and the physical
 * cards must not drift apart.
 *
 * Usage:
 *   <CardIcon name={card.icon} size={72} color="var(--sf-neon)" />
 *
 * `knockout` is the colour punched through solid shapes (football laces, the
 * stripes on the ref card). It should match whatever the icon sits on. Default
 * is the card field colour.
 */

import React from 'react';

const VB = 64;

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

const Ball = ({ x, y, s = 1, rot = -25, ko }) => (
  <g transform={`translate(${x},${y}) rotate(${rot}) scale(${s})`}>
    <ellipse rx="15" ry="9.6" fill="currentColor" />
    <path d="M-9 0h18" stroke={ko} strokeWidth="2.4" strokeLinecap="round" />
    <path d="M-4.5-3v6M0-3v6M4.5-3v6" stroke={ko} strokeWidth="2.2" strokeLinecap="round" />
  </g>
);

const Posts = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x},${y}) scale(${s})`} fill="currentColor">
    <rect x="-3" y="2" width="6" height="24" rx="3" />
    <rect x="-22" y="-2" width="44" height="6" rx="3" />
    <rect x="-22" y="-26" width="6" height="26" rx="3" />
    <rect x="16" y="-26" width="6" height="26" rx="3" />
  </g>
);

/** pose: 'up' (touchdown signal) | 'safety' | 'point' | 'down' (tackled) */
const Ref = ({ x, y, s = 1, pose = 'up' }) => {
  const arms = {
    up: <path d="M-6-12l-6 1-5-24 7-1.5zM6-12l6 1 5-24-7-1.5z" />,
    safety: (
      <>
        <path d="M-6-12l-7 0-8-16 6-4zM6-12l7 0 8-16-6-4z" />
        <circle cx="0" cy="-34" r="4.5" />
      </>
    ),
    point: <path d="M-6-12l-6 2-4 14 6 2zM6-12l7-1 18-6 1.5 7-19 6z" />,
    down: null,
  }[pose];
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} fill="currentColor">
      {arms}
      <circle cx="0" cy="-20" r="7" />
      <path d="M-6.5 -12h13l1.5 20h-16z" />
      <path d="M-6 8h5l-1 18h-6zM1 8h5l2 18h-6z" />
    </g>
  );
};

const Burst = ({ x, y, s = 1 }) => (
  <g
    transform={`translate(${x},${y}) scale(${s})`}
    stroke="currentColor"
    strokeWidth="3.4"
    strokeLinecap="round"
    fill="none"
  >
    <path d="M0-14v-7M10-10l5-5M14 0h7M10 10l5 5M0 14v7M-10 10l-5 5M-14 0h-7M-10-10l-5-5" />
  </g>
);

const Speed = ({ x, y, d = 1 }) => (
  <g stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" transform={`translate(${x},${y})`}>
    <path d={`M0 -9h${14 * d}`} />
    <path d={`M2 0h${18 * d}`} />
    <path d={`M0 9h${14 * d}`} />
  </g>
);

const Txt = ({ x, y, children, size = 26 }) => (
  <text
    x={x}
    y={y}
    textAnchor="middle"
    fill="currentColor"
    fontFamily="Oswald, sans-serif"
    fontWeight="700"
    fontSize={size}
  >
    {children}
  </text>
);

const Ground = ({ y = 56, o = 0.45 }) => (
  <path d={`M6 ${y}h52`} stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" opacity={o} />
);

/* ------------------------------------------------------------------ */
/* the marks                                                           */
/* ------------------------------------------------------------------ */

const MARKS = {
  /* --- standard deck --- */
  touchdown: () => <Ref x={32} y={34} s={1.05} pose="up" />,

  fieldgoal: (ko) => (
    <>
      <Posts x={32} y={42} />
      <Ball x={32} y={14} s={0.72} rot={-20} ko={ko} />
    </>
  ),

  turnover: (ko) => (
    <>
      <Ball x={32} y={34} s={0.95} rot={-20} ko={ko} />
      <g fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round">
        <path d="M8 22a26 26 0 0 1 20-12" />
        <path d="M56 42a26 26 0 0 1-20 12" />
      </g>
      <path d="M28 4l4 7-8 1z" fill="currentColor" />
      <path d="M36 60l-4-7 8-1z" fill="currentColor" />
    </>
  ),

  sack: (ko) => (
    <>
      <g transform="rotate(-52 30 36)">
        <Ref x={30} y={36} s={0.92} pose="down" />
      </g>
      <Ball x={50} y={17} s={0.6} rot={15} ko={ko} />
      <Burst x={16} y={17} s={0.72} />
    </>
  ),

  penalty: () => (
    <>
      <g fill="currentColor">
        <rect x="12" y="8" width="5.5" height="48" rx="2.75" />
        <path d="M17.5 11L52 21.5 17.5 32z" />
      </g>
      <circle cx="15" cy="8" r="5" fill="currentColor" />
    </>
  ),

  /* --- global event --- */
  firstdown: () => (
    <>
      <g fill="currentColor">
        <rect x="8" y="14" width="5.5" height="38" rx="2.75" />
        <rect x="34" y="14" width="5.5" height="38" rx="2.75" />
      </g>
      <path d="M13.5 22h20.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="5 5" />
      <path
        d="M42 33h12m-5-6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="4.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  /* --- wild deck --- */
  big20: (ko) => (
    <>
      <Speed x={6} y={30} />
      <Ball x={42} y={30} s={0.95} rot={-18} ko={ko} />
      <Txt x={32} y={60} size={17}>20+</Txt>
    </>
  ),

  big50: (ko) => (
    <>
      <Speed x={4} y={28} />
      <Ball x={42} y={28} s={0.95} rot={-18} ko={ko} />
      <Txt x={32} y={60} size={17}>50+</Txt>
    </>
  ),

  threeout: (ko) => (
    <>
      <Txt x={20} y={42} size={34}>3</Txt>
      <path
        d="M38 32h16m-6-7l7 7-7 7"
        stroke="currentColor"
        strokeWidth="4.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Ball x={45} y={15} s={0.5} rot={-20} ko={ko} />
    </>
  ),

  turnoverdowns: () => (
    <>
      <Txt x={26} y={40} size={20}>4TH</Txt>
      <path d="M42 40L58 56M58 40L42 56" stroke="currentColor" strokeWidth="5.4" strokeLinecap="round" />
      <path d="M8 50h50" stroke="currentColor" strokeWidth="3" opacity=".4" strokeLinecap="round" />
    </>
  ),

  missedfg: (ko) => (
    <>
      <Posts x={32} y={44} s={0.92} />
      <Ball x={54} y={14} s={0.62} rot={-20} ko={ko} />
      <path
        d="M40 40q8-16 14-22"
        stroke="currentColor"
        strokeWidth="3.4"
        fill="none"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
    </>
  ),

  missedpat: (ko) => (
    <>
      <Posts x={28} y={44} s={0.8} />
      <Ball x={53} y={18} s={0.55} rot={-20} ko={ko} />
      <Txt x={52} y={58} size={11}>PAT</Txt>
    </>
  ),

  onsidea: (ko) => (
    <>
      <Ball x={16} y={44} s={0.8} rot={-8} ko={ko} />
      <path
        d="M26 42q14-22 30-14"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
      <path d="M50 22l8 6-7 6" fill="currentColor" />
      <Ground />
    </>
  ),

  onsider: (ko) => (
    <>
      <Ball x={32} y={32} s={1} rot={-20} ko={ko} />
      <g fill="currentColor">
        <path d="M32 14L24.5 2h15zM32 50l-7.5 12h15zM14 32L2 24.5v15zM50 32l12-7.5v15z" />
      </g>
    </>
  ),

  fake: (ko) => (
    <>
      <Ball x={32} y={40} s={0.95} rot={-20} ko={ko} />
      <g fill="currentColor">
        <path d="M10 16c8-6 36-6 44 0 2 8-4 14-10 12-3-1-3-5-6-5h-12c-3 0-3 4-6 5-6 2-12-4-10-12z" />
      </g>
      <circle cx="21" cy="21" r="3.4" fill={ko} />
      <circle cx="43" cy="21" r="3.4" fill={ko} />
    </>
  ),

  twopt: (ko) => (
    <>
      <Txt x={22} y={46} size={40}>2</Txt>
      <Ball x={46} y={24} s={0.72} rot={-20} ko={ko} />
      <Ground />
    </>
  ),

  doink: (ko) => (
    <>
      <g fill="currentColor">
        <rect x="14" y="10" width="7" height="46" rx="3.5" />
        <rect x="10" y="30" width="24" height="6.5" rx="3.25" />
      </g>
      <Ball x={43} y={20} s={0.72} rot={-30} ko={ko} />
      <Burst x={26} y={20} s={0.86} />
    </>
  ),

  blocked: (ko) => (
    <>
      <g fill="currentColor">
        <path d="M22 56V34c0-3 5-3 5 0v-6c0-3 5-3 5 0v-2c0-3 5-3 5 0v3c0-3 5-3 5 0v18c0 6-4 9-9 9z" />
        <path d="M16 40c0-4 5-4 6-1l3 8-6 3z" />
      </g>
      <Ball x={24} y={14} s={0.68} rot={-25} ko={ko} />
      <Burst x={38} y={16} s={0.62} />
    </>
  ),

  safety: (ko) => (
    <>
      <rect x="4" y="8" width="26" height="50" rx="2.5" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <g stroke="currentColor" strokeWidth="2.4" opacity=".45">
        <path d="M4 20L30 9M4 32L30 21M4 44L30 33M4 56L30 45" />
      </g>
      <g transform="rotate(-55 42 36)">
        <Ref x={42} y={36} s={0.8} pose="down" />
      </g>
      <Ball x={20} y={30} s={0.5} rot={20} ko={ko} />
      <Burst x={46} y={14} s={0.6} />
    </>
  ),

  deftd: () => (
    <>
      <Txt x={14} y={47} size={40}>D</Txt>
      <Ref x={46} y={36} s={0.76} pose="up" />
      <Ground y={58} />
    </>
  ),

  sttd: (ko) => (
    <>
      <Ball x={12} y={44} s={0.72} rot={-15} ko={ko} />
      <path d="M20 42q16-26 36-24" stroke="currentColor" strokeWidth="4.4" fill="none" strokeLinecap="round" />
      <path d="M48 12l10 6-9 7z" fill="currentColor" />
      <Ground />
      <path d="M50 8v20" stroke="currentColor" strokeWidth="3" strokeDasharray="4 4" />
    </>
  ),

  dq: (ko) => (
    <>
      <Ref x={22} y={36} s={0.86} pose="down" />
      <g fill="currentColor">
        <rect x="38" y="10" width="20" height="27" rx="3" />
      </g>
      <path d="M43 18l10 11M53 18l-10 11" stroke={ko} strokeWidth="3.4" strokeLinecap="round" />
    </>
  ),

  record: (ko) => (
    <>
      <g fill="currentColor">
        <path d="M20 8h24v14c0 7-5 12-12 12s-12-5-12-12z" />
        <path d="M14 10h6v9c-4-1-6-4-6-9zM44 10h6c0 5-2 8-6 9z" />
        <rect x="28" y="34" width="8" height="9" />
        <rect x="19" y="43" width="26" height="7" rx="2" />
      </g>
      <path d="M30 8l-4 14 8-4-4 12" stroke={ko} strokeWidth="2.6" fill="none" strokeLinejoin="round" />
    </>
  ),

  pentdback: () => (
    <>
      <Ref x={24} y={36} s={0.86} pose="up" />
      <g fill="currentColor">
        <rect x="42" y="16" width="4.5" height="34" rx="2.25" />
        <path d="M46.5 18L64 24 46.5 30z" />
      </g>
      <path d="M12 12L52 52" stroke="var(--sf-blood, #FF4A33)" strokeWidth="5" strokeLinecap="round" />
    </>
  ),

  /* --- ref / rules (physical deck only, but useful in-app) --- */
  house: (ko) => (
    <>
      <g fill="currentColor">
        <path d="M32 8L56 28h-7v24H15V28H8z" />
        <rect x="26" y="36" width="12" height="16" rx="1.5" fill={ko} />
      </g>
      <path d="M20 58h24" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
    </>
  ),

  refcard: (ko) => (
    <>
      <g fill="currentColor">
        <rect x="12" y="8" width="40" height="48" rx="4" />
      </g>
      <g stroke={ko} strokeWidth="4.6">
        <path d="M20 8v48M28.5 8v48M37 8v48M45.5 8v48" />
      </g>
    </>
  ),
};

export const ICON_NAMES = Object.keys(MARKS);

/**
 * @param {string} name    key from card.icon
 * @param {number} size    rendered px, square
 * @param {string} color   any CSS colour; defaults to inheriting currentColor
 * @param {string} knockout colour punched through solid shapes
 */
export default function CardIcon({
  name,
  size = 64,
  color,
  knockout = 'var(--sf-card-field, #0A0D12)',
  title,
  ...rest
}) {
  const mark = MARKS[name];
  if (!mark) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[CardIcon] unknown icon "${name}"`);
    }
    return null;
  }
  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={color ? { color } : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {mark(knockout)}
    </svg>
  );
}
