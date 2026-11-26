import { render } from 'preact';
import { App } from './ui/App';
import { startRangeFill } from './ui/rangeFill';
import './ui/tokens.css';
import './ui/base.css';
import './ui/layout.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
startRangeFill();

// Offline support. Registered after load so it never competes with the first paint.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is optional; the site works without it.
    });
  });
}
