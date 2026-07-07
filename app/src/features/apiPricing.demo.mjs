// Self-check for apiPricing. Run: node app/src/features/apiPricing.demo.mjs
import assert from 'node:assert';
import { anthropicCost, elevenCost, summarizeUsage, fmtUsd, fmtTokens } from './apiPricing.js';

// Anthropic cost = in/1e6*inPrice + out/1e6*outPrice
assert.ok(Math.abs(anthropicCost('claude-sonnet-5', 1_000_000, 1_000_000) - (3 + 15)) < 1e-9);
assert.ok(Math.abs(anthropicCost('claude-opus-4-8', 2_000_000, 0) - 30) < 1e-9);
// unknown model → default (sonnet-ish) pricing, never NaN
assert.ok(anthropicCost('mystery', 1_000_000, 0) > 0 && Number.isFinite(anthropicCost('mystery', 0, 0)));

// ElevenLabs cost scales with characters
assert.ok(elevenCost(1000) > 0 && Math.abs(elevenCost(2000) - 2 * elevenCost(1000)) < 1e-12);

// summarizeUsage aggregation across providers, models, days, sources
const T = Date.parse('2024-05-01T10:00:00Z');
const DAY = 86400000;
const entries = [
  { ts: T, provider: 'anthropic', model: 'claude-sonnet-5', source: 'notes-ai', inTokens: 1000, outTokens: 500, costUsd: anthropicCost('claude-sonnet-5', 1000, 500) },
  { ts: T + 60000, provider: 'anthropic', model: 'claude-opus-4-8', source: 'trackyread-ai', inTokens: 2000, outTokens: 1000, costUsd: anthropicCost('claude-opus-4-8', 2000, 1000) },
  { ts: T + DAY, provider: 'elevenlabs', model: 'eleven_multilingual_v2', source: 'audiobook', chars: 5000, costUsd: elevenCost(5000) },
];
const s = summarizeUsage(entries);
assert.equal(s.calls, 3);
assert.equal(s.anthropic.calls, 2);
assert.equal(s.anthropic.inTokens, 3000);
assert.equal(s.anthropic.outTokens, 1500);
assert.equal(s.elevenlabs.calls, 1);
assert.equal(s.elevenlabs.chars, 5000);
assert.ok(Math.abs(s.total - (s.anthropic.cost + s.elevenlabs.cost)) < 1e-9);
assert.equal(Object.keys(s.byModel).length, 3);
assert.equal(Object.keys(s.byDay).length, 2); // two distinct days
assert.equal(Object.keys(s.bySource).length, 3);
assert.equal(s.byModel['claude-opus-4-8'].calls, 1);

// formatters
assert.equal(fmtUsd(0), '$0.00');
assert.equal(fmtUsd(0.004), '<$0.01');
assert.equal(fmtUsd(1.239), '$1.24');
assert.equal(fmtTokens(1500), '1.5k');
assert.equal(fmtTokens(2_500_000), '2.50M');
assert.equal(fmtTokens(42), '42');

console.log('apiPricing.demo: all assertions passed ✅');
