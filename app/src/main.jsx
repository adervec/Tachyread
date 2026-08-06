import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { initPwaInstall } from './features/pwaInstall.js';

// Capture the install prompt BEFORE React mounts — Chrome fires beforeinstallprompt once, early,
// and a missed event means no in-app install offer for the whole page load.
initPwaInstall();

createRoot(document.getElementById('root')).render(<App />);

// Register the service worker (PWA install + offline) only in production builds, so the dev server's
// HMR isn't intercepted. Scope is the app's base path, so it works under /Tachyread/ on Pages.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
