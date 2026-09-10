import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Demo, isDemoRoute } from './demo';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
/**
 * /how-to-play renders the scripted walkthrough instead of the game.
 *
 * A path check rather than a router: adding react-router would be a new
 * dependency, which this branch does not do. `server.js` already serves
 * index.html for any unmatched path, so no server change was needed either —
 * and the demo opens no socket, so it runs with the game server switched off.
 *
 * `<App />` is reached by exactly the same call it always was; nothing about
 * the game's mount changed.
 */
root.render(
  // Temporarily disable StrictMode to prevent mobile refresh issues
  isDemoRoute(window.location.pathname) ? <Demo /> : <App />
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
