import { execSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';

// Build stamp baked in at build time (shown in About). Build number = commit count (monotonic);
// sha = short commit; date = build day. Falls back gracefully outside a git checkout / CI.
function git(cmd, fallback) {
  try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
}
const BUILD_NUMBER = git('rev-list --count HEAD', '0');
const BUILD_SHA = (process.env.GITHUB_SHA || git('rev-parse --short HEAD', 'dev')).slice(0, 7);
const BUILD_DATE = new Date().toLocaleDateString('sv-SE'); // the build machine's local day, YYYY-MM-DD

// House standard: no third-party requests. The camera (MediaPipe) and OCR (Tesseract) engines
// would otherwise download their wasm from cdn.jsdelivr.net; the installed packages already ship
// those files, so they are served from our own site under vendor/ (copied into the build, and
// streamed straight from node_modules by the dev server). Their DATA still comes from outside —
// see PRIVACY.md (MediaPipe models from Google storage, OCR language data from jsdelivr).
const VENDOR = [
  ['node_modules/@mediapipe/tasks-vision/wasm', 'vendor/mediapipe', /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/],
  ['node_modules/tesseract.js/dist', 'vendor/tesseract', /^worker\.min\.js$/],
  ['node_modules/tesseract.js-core', 'vendor/tesseract', /-lstm\.wasm\.js$/], // the app's OCR is LSTM-only
];
const vendorFiles = () => VENDOR.flatMap(([from, to, re]) => readdirSync(from).filter((f) => re.test(f)).map((f) => [path.join(from, f), `${to}/${f}`]));
const vendor = {
  name: 'vendor-wasm',
  configureServer(server) {
    const files = new Map(vendorFiles().map(([src, url]) => [url, src]));
    server.middlewares.use((req, res, next) => {
      const src = files.get(decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, ''));
      if (!src) return next();
      res.setHeader('Content-Type', src.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      createReadStream(src).pipe(res);
    });
  },
  writeBundle({ dir }) {
    for (const [src, url] of vendorFiles()) {
      const out = path.join(dir, url);
      if (!existsSync(path.dirname(out))) mkdirSync(path.dirname(out), { recursive: true });
      cpSync(src, out);
    }
  },
};

// https://vitejs.dev/config/
export default defineConfig({
    // version.json beside the app: the running page compares it with its own build to offer a reload.
    plugins: [plugin(), vendor, { name: 'version-json', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_NUMBER, sha: BUILD_SHA, date: BUILD_DATE }) }); } }],
    define: {
        __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
        __BUILD_SHA__: JSON.stringify(BUILD_SHA),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    server: {
        port: 52593,
    },
    // Workers are spawned as module workers ({ type: 'module' }); build them as ES modules too so
    // libraries that use import.meta (kokoro-js / Transformers.js) keep it.
    worker: { format: 'es' },
})