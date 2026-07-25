// Unified self-check runner: discovers every *.test.mjs and *.demo.mjs under src/ and runs each in
// its own node process (so one crash can't take down the suite and module-level state can't leak
// between files). Any nonzero exit or stderr assertion fails the run. Used by `npm test` and CI.
//
// Conventions (ponytail): each feature module ships ONE runnable assert-based self-check that exits
// 0 and prints a single "…: all cases pass"-style line. Files needing browser APIs get a tiny DOM
// shim below — if a check genuinely can't run under node it should print "SKIP: reason" and exit 0.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function findChecks(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) findChecks(p, out);
    else if (/\.(test|demo)\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

const files = findChecks(root).sort();
if (!files.length) { console.error('No self-checks found under src/ — that itself is a failure.'); process.exit(1); }

const failures = [];
let skipped = 0;
const t0 = Date.now();
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 60000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status === 0 && /^SKIP:/m.test(out)) { skipped++; console.log(`⏭  ${rel} — ${out.match(/^SKIP:.*$/m)[0]}`); continue; }
  if (r.status === 0) { console.log(`✅ ${rel}`); continue; }
  failures.push(rel);
  console.log(`❌ ${rel} (exit ${r.status ?? 'signal ' + r.signal})`);
  // Show the tail of the output — that's where the assertion message lives.
  console.log(out.split('\n').slice(-15).map((l) => `   ${l}`).join('\n'));
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${files.length} checks: ${files.length - failures.length - skipped} passed, ${skipped} skipped, ${failures.length} failed (${secs}s)`);
if (failures.length) { console.log('Failed:\n' + failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
