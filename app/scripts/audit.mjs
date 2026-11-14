// CI supply-chain gate (house standard 22): `npm audit`, failing on any high or critical advisory
// except the ones listed here, each with the reason it cannot reach a reader. A package that is
// flagged only because it depends on an allowed one passes too; any advisory of its own fails.
// Run: node scripts/audit.mjs
import { execSync } from 'node:child_process';

const ALLOWED = {
  // Node-only image library that @huggingface/transformers (voice models) declares. The browser build
  // replaces it with an empty stub ("sharp (ignored)" in the worker bundles), and no fix exists yet.
  sharp: 'not in the browser build',
};

let out;
try { out = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = e.stdout; }
const vulns = JSON.parse(out || '{}').vulnerabilities || {};
const onlyAllowed = (name, seen = new Set()) => {
  if (ALLOWED[name]) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const via = vulns[name]?.via || [];
  return via.length > 0 && via.every((v) => typeof v === 'string' && onlyAllowed(v, seen));
};
const bad = Object.entries(vulns).filter(([name, v]) => ['high', 'critical'].includes(v.severity) && !onlyAllowed(name));
for (const [name, v] of Object.entries(vulns)) if (['high', 'critical'].includes(v.severity) && onlyAllowed(name)) console.log(`allowed: ${name} (${v.severity}) — ${ALLOWED[name] || 'only via an allowed package'}`);
if (bad.length) {
  for (const [name, v] of bad) console.log(`FAIL: ${name} (${v.severity}) via ${(v.via || []).map((x) => (typeof x === 'string' ? x : x.title)).join(' | ')}`);
  process.exit(1);
}
console.log('npm audit: no high or critical advisories outside the allow-list');
