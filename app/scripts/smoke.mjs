// Boot smoke test: build output actually RUNS. Serves dist via `vite preview`, drives the app in a
// real browser (the machine's installed Chrome/Edge via playwright-core — no browser downloads, so
// this works on GitHub runners too), and fails on ANY console error or uncaught page error.
// Flow: boot → open a dropped .txt → line rows render → play a moment → Help opens. `npm run smoke`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4321;
const URL_ = `http://localhost:${PORT}/Tachyread/`;
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Serve the built app (vite preview exits cleanly on SIGTERM/kill).
const server = spawn('npx vite preview --port ' + PORT + ' --strictPort', { cwd: appDir, stdio: 'ignore', shell: true });
const killServer = () => { try { server.kill(); } catch { /* noop */ } };
process.on('exit', killServer);

async function waitFor(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Preview server never came up at ${url}`);
}

function fail(msg) { console.error(`SMOKE FAIL: ${msg}`); killServer(); process.exit(1); }

try {
  await waitFor(URL_);
  // Try installed browsers in order; whichever launches first wins.
  let browser = null;
  for (const channel of ['chrome', 'msedge', 'chromium']) {
    try { browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true }); break; } catch { /* next */ }
  }
  if (!browser) { console.log('SKIP: no installed Chrome/Edge/Chromium available for the smoke test.'); killServer(); process.exit(0); }

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.addInitScript(() => localStorage.setItem('tachyread-disclaimer-ack', '1'));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL_, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('.menu-bar', { timeout: 15000 });

  // Open a document via drop, see it render.
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'smoke.txt', { type: 'text/plain' }));
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  }, Array.from({ length: 60 }, (_, i) => `Smoke test line ${i + 1} with several plain words.`).join('\n'));
  await page.waitForSelector('.line-pane-list .line-row', { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Play briefly, then Help.
  await page.keyboard.press(' ');
  await page.waitForTimeout(1200);
  await page.keyboard.press(' ');
  await page.keyboard.press('F1');
  await page.waitForSelector('.help-nav', { timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await browser.close();
  killServer();
  // Benign noise allowlist (none so far — keep strict; add patterns here only with a comment why).
  const real = errors.filter(() => true);
  if (real.length) fail(`${real.length} console/page error(s):\n  ${real.join('\n  ')}`);
  console.log('smoke: app boots, opens a document, plays, Help renders — 0 console errors');
} catch (e) {
  fail(e?.message || String(e));
}
