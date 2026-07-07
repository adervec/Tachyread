// Rough cost estimates + aggregation for the API-spend dashboard. Prices are APPROXIMATE public
// list rates and change over time / by plan — the dashboard labels the figures "estimated". Pure;
// see apiPricing.demo.mjs.

// USD per MILLION tokens (input / output).
export const ANTHROPIC_PRICES = {
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};
const DEFAULT_ANTHROPIC = { in: 3, out: 15 };

export function anthropicCost(model, inTok = 0, outTok = 0) {
  const p = ANTHROPIC_PRICES[model] || DEFAULT_ANTHROPIC;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

// ElevenLabs bills in credits (≈ 1 credit per character on most plans). A rough $/char just for a
// ballpark spend figure — real cost depends entirely on your subscription tier.
export const ELEVEN_USD_PER_CHAR = 0.00018; // ≈ $0.18 per 1,000 characters
export function elevenCost(chars = 0) { return chars * ELEVEN_USD_PER_CHAR; }

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// Aggregate a list of usage records into dashboard-ready totals.
export function summarizeUsage(entries) {
  const s = {
    anthropic: { calls: 0, inTokens: 0, outTokens: 0, cost: 0 },
    elevenlabs: { calls: 0, chars: 0, cost: 0 },
    byModel: {}, // model -> { provider, calls, inTokens, outTokens, chars, cost }
    bySource: {}, // feature label -> { calls, cost }
    byDay: {},   // 'YYYY-MM-DD' -> { cost, calls }
    total: 0,
    calls: 0,
  };
  for (const e of entries || []) {
    const cost = e.costUsd || 0;
    s.total += cost;
    s.calls++;
    const day = dayOf(e.ts || 0);
    const d = s.byDay[day] || { cost: 0, calls: 0 };
    d.cost += cost; d.calls++; s.byDay[day] = d;
    const m = s.byModel[e.model] || { provider: e.provider, calls: 0, inTokens: 0, outTokens: 0, chars: 0, cost: 0 };
    m.calls++; m.inTokens += e.inTokens || 0; m.outTokens += e.outTokens || 0; m.chars += e.chars || 0; m.cost += cost;
    s.byModel[e.model] = m;
    const src = e.source || 'other';
    const sc = s.bySource[src] || { calls: 0, cost: 0 };
    sc.calls++; sc.cost += cost; s.bySource[src] = sc;
    if (e.provider === 'elevenlabs') {
      s.elevenlabs.calls++; s.elevenlabs.chars += e.chars || 0; s.elevenlabs.cost += cost;
    } else {
      s.anthropic.calls++; s.anthropic.inTokens += e.inTokens || 0; s.anthropic.outTokens += e.outTokens || 0; s.anthropic.cost += cost;
    }
  }
  return s;
}

export const fmtUsd = (n) => (n >= 0.005 ? '$' + n.toFixed(2) : n > 0 ? '<$0.01' : '$0.00');
export const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));
