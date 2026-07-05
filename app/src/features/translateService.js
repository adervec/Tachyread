// Translation-service layer for the reading features (the "translate" obscure mode + the side-by-side
// parallel view). Provider-agnostic: each provider is a request builder + response parser, so the
// callers only see translateText(cfg, text). PURE builders/parsers (fetch isolated in translateText)
// — see translateService.demo.mjs.
//
// Providers:
//  • MyMemory       — free, keyless, rate-limited; the zero-setup default so translation "just works".
//  • Google Cloud Translation v2 — API key; the quality/volume option (CORS-friendly from a browser).
//  • LibreTranslate — self-hosted or public endpoint, optional key; the private/offline-ish option.
// ponytail: DeepL omitted — its API sends no CORS headers, so a browser app can't call it directly.

export const TRANSLATE_PROVIDERS = [
  { id: 'mymemory', label: 'MyMemory (free · no key · rate-limited)', needsKey: false, needsEndpoint: false },
  { id: 'google', label: 'Google Cloud Translation (API key)', needsKey: true, needsEndpoint: false },
  { id: 'libre', label: 'LibreTranslate (your endpoint · optional key)', needsKey: false, needsEndpoint: true },
];

// Common target languages for the pickers (code → label). Not exhaustive on purpose.
export const TARGET_LANGS = [
  ['ja', 'Japanese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['tr', 'Turkish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ar', 'Arabic'],
  ['hi', 'Hindi'], ['el', 'Greek'], ['he', 'Hebrew'], ['hr', 'Croatian'], ['en', 'English'],
];

export function translateConfigured(cfg) {
  const p = cfg?.translateProvider || 'mymemory';
  if (p === 'google') return !!(cfg?.translateKey || '').trim();
  if (p === 'libre') return !!(cfg?.translateEndpoint || '').trim();
  return true; // mymemory needs nothing
}

// The fetch spec for one translation call. `source` may be '' → provider auto-detects where it can
// (MyMemory has no autodetect, so it falls back to English as the assumed source).
export function buildRequest(provider, { text, source, target, key, endpoint }) {
  if (provider === 'google') {
    return {
      url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key || '')}`,
      init: {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, target, ...(source ? { source } : {}), format: 'text' }),
      },
    };
  }
  if (provider === 'libre') {
    return {
      url: `${String(endpoint || '').replace(/\/+$/, '')}/translate`,
      init: {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: source || 'auto', target, format: 'text', ...(key ? { api_key: key } : {}) }),
      },
    };
  }
  // mymemory (default)
  const pair = `${source || 'en'}|${target}`;
  return { url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`, init: undefined };
}

export function parseResponse(provider, json) {
  if (provider === 'google') {
    if (json?.error) throw new Error(json.error.message || 'Google Translation error.');
    const t = json?.data?.translations?.[0]?.translatedText;
    if (t == null) throw new Error('Unexpected Google Translation response.');
    return t;
  }
  if (provider === 'libre') {
    if (json?.error) throw new Error(json.error);
    if (json?.translatedText == null) throw new Error('Unexpected LibreTranslate response.');
    return json.translatedText;
  }
  if (Number(json?.responseStatus) !== 200) throw new Error(json?.responseDetails || 'MyMemory error.');
  return json.responseData?.translatedText ?? '';
}

// Persistent-cache key for one translated string (djb2 over the text).
export function cacheKey(cfg, text) {
  let h = 5381;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${cfg.translateProvider || 'mymemory'}:${cfg.translateSource || 'auto'}:${cfg.translateTarget || ''}:${h.toString(16)}`;
}

// One live translation call. cfg: { translateProvider, translateKey, translateEndpoint,
// translateTarget, translateSource }. Throws on any provider/network error.
export async function translateText(cfg, text) {
  const provider = cfg.translateProvider || 'mymemory';
  const { url, init } = buildRequest(provider, {
    text, source: cfg.translateSource || '', target: cfg.translateTarget || 'ja',
    key: (cfg.translateKey || '').trim(), endpoint: (cfg.translateEndpoint || '').trim(),
  });
  const r = await fetch(url, init);
  let json;
  try { json = await r.json(); } catch (e) { throw new Error(`Translation service returned a non-JSON response (${r.status}).`, { cause: e }); }
  if (!r.ok && provider !== 'mymemory') {
    // Providers put the message in the body; surface it (mymemory reports errors inside a 200).
    try { return parseResponse(provider, json); } catch (e) { throw new Error(`${e.message} (${r.status})`, { cause: e }); }
  }
  return parseResponse(provider, json);
}
