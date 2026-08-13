import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { initPwaInstall } from './features/pwaInstall.js';

// Capture the install prompt BEFORE React mounts — Chrome fires beforeinstallprompt once, early,
// and a missed event means no in-app install offer for the whole page load.
initPwaInstall();

createRoot(document.getElementById('root')).render(<App />);

// Let the maker's app portal (adervec.github.io — same origin as this Pages site) know Tachyread is
// installed, by stamping a timestamp under a shared localStorage key it reads. Only written when
// actually running as an installed app: a normal browser tab proves nothing about installation.
try {
  const modes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
  if (navigator.standalone === true || modes.some((m) => window.matchMedia?.(`(display-mode: ${m})`)?.matches)) {
    const key = 'portal-installed';
    const reg = JSON.parse(localStorage.getItem(key) || '{}');
    reg['Tachyread'] = Date.now();
    localStorage.setItem(key, JSON.stringify(reg));
  }
} catch { /* ignore — private mode, storage full, or unparseable registry */ }

// Register the service worker (PWA install + offline) only in production builds, so the dev server's
// HMR isn't intercepted. Scope is the app's base path, so it works under /Tachyread/ on Pages.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
