/**
 * Route entry for the walkthrough.
 *
 * There is no router in this app and adding one would be a new dependency,
 * which this branch does not do. The path check lives here instead, and
 * `index.js` picks between the app and the demo at mount.
 *
 * The server needs no change: `server.js` already ends with a catch-all that
 * serves `index.html` for any unmatched path, so /how-to-play loads the SPA and
 * the client decides what to render.
 */
export const DEMO_PATH = '/how-to-play';

/** True when the current URL is the walkthrough. */
export const isDemoRoute = (pathname = '') =>
  String(pathname).replace(/\/+$/, '').toLowerCase() === DEMO_PATH;

export { default as Demo } from './Demo';
