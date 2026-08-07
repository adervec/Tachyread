// Guards the PWA install criteria that live in public/manifest.webmanifest (JSON can't carry the
// comments, so the rules are asserted here instead).
//
// The one that actually bit us: a manifest `id` is resolved against the ORIGIN, not the manifest
// URL — so "./" computes to https://adervec.github.io/ for every app on that origin. We host ~9
// GitHub Pages apps there, another one also used "./", and Chrome treated Tachyread as "already
// installed" — no beforeinstallprompt, no install prompt, ever. The id must be path-scoped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const m = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/manifest.webmanifest', import.meta.url)), 'utf8'));

// App identity must be unique on a shared origin: an absolute path with a segment, never "/" or "./".
assert.ok(m.id?.startsWith('/'), `manifest id must be an absolute path, got ${JSON.stringify(m.id)}`);
assert.ok(m.id.length > 1, 'manifest id must not be the origin root — it collides with sibling apps');

// Chrome's other install criteria.
assert.ok(m.name || m.short_name, 'manifest needs name or short_name');
assert.ok(m.start_url, 'manifest needs start_url');
assert.ok(['fullscreen', 'standalone', 'minimal-ui'].includes(m.display), `bad display: ${m.display}`);
assert.ok(!m.prefer_related_applications, 'prefer_related_applications blocks the install prompt');
for (const size of ['192x192', '512x512']) {
  assert.ok(
    m.icons?.some((i) => i.sizes === size && (i.purpose ?? 'any').split(' ').includes('any')),
    `manifest needs a ${size} icon with purpose "any"`,
  );
}

console.log('pwaManifest: all cases pass');
