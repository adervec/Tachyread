import { execSync } from 'node:child_process';
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
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [plugin()],
    define: {
        __BUILD_NUMBER__: JSON.stringify(BUILD_NUMBER),
        __BUILD_SHA__: JSON.stringify(BUILD_SHA),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    },
    server: {
        port: 52593,
    }
})