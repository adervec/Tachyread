// Optional AI in the Notes suite via the Anthropic API, called directly from the browser with the
// user's own key (enabled by the `anthropic-dangerous-direct-browser-access` header). The key stays
// on-device and is never synced. Whatever text you send (document excerpts, your notes) goes to
// Anthropic's servers and spends your own API credits.
import { recordApiUsage } from '../state/storage.js';
import { anthropicCost } from './apiPricing.js';

const BASE = 'https://api.anthropic.com/v1/messages';

export function anthropicConfigured(key) { return !!(key && key.trim()); }

export const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest / cheapest' },
];

// messages: [{ role: 'user'|'assistant', content: string }]. Returns the assistant's reply text.
// `source` labels the call in the API-spend dashboard (which feature spent the tokens).
export async function askClaude(messages, { key, model = 'claude-sonnet-5', system = '', maxTokens = 1024, source = 'ai' } = {}) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: {
      'x-api-key': (key || '').trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: system || undefined, messages }),
  });
  if (!r.ok) {
    let detail = `Anthropic error ${r.status}`;
    if (r.status === 401) detail = 'Invalid Anthropic API key.';
    else if (r.status === 429) detail = 'Anthropic rate limit / quota reached.';
    else { try { const e = await r.json(); detail = e?.error?.message || detail; } catch { /* non-JSON */ } }
    throw new Error(detail);
  }
  const j = await r.json();
  const u = j.usage || {};
  recordApiUsage({
    provider: 'anthropic', model, source,
    inTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    outTokens: u.output_tokens || 0,
    costUsd: anthropicCost(model, u.input_tokens || 0, u.output_tokens || 0),
  });
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
