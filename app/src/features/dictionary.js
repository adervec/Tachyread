// Word lookups for the Lines pane's 📖 Define popup. Only the looked-up word leaves the device, and
// only when you ask: English definitions from the free Dictionary API (dictionaryapi.dev), plus a
// Wikipedia summary in the document's language. Both send CORS headers, so no proxy.

// dictionaryapi.dev JSON → up to `maxSenses` parts of speech with their first definitions.
export function parseDictionaryApi(json, { maxSenses = 3, maxDefs = 2 } = {}) {
  if (!Array.isArray(json)) return { phonetic: '', senses: [] };
  const phonetic = json.find((e) => e.phonetic)?.phonetic || json.flatMap((e) => e.phonetics || []).find((p) => p.text)?.text || '';
  const byPos = new Map();
  for (const entry of json) {
    for (const m of entry.meanings || []) {
      const pos = m.partOfSpeech || '';
      const list = byPos.get(pos) || [];
      for (const d of m.definitions || []) if (d.definition && list.length < maxDefs) list.push({ def: d.definition, example: d.example || '' });
      byPos.set(pos, list);
    }
  }
  return { phonetic, senses: [...byPos.entries()].filter(([, d]) => d.length).slice(0, maxSenses).map(([pos, defs]) => ({ pos, defs })) };
}

// Short plain-text gloss for the vocabulary card ("noun: …; verb: …").
export const glossOf = (senses) => senses.map((s) => `${s.pos ? `${s.pos}: ` : ''}${s.defs[0]?.def || ''}`).join('; ').slice(0, 300);

// The bare word to look up: trailing/leading punctuation off, possessive 's dropped.
export const lookupForm = (w) => String(w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/i, '');

export async function lookupWord(word, lang = 'en') {
  const w = lookupForm(word);
  const enc = encodeURIComponent(w);
  const l = /^[a-z]{2,3}$/.test(lang) ? lang : 'en';
  const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [dict, wiki] = await Promise.all([
    l === 'en' ? get(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc}`) : Promise.resolve(null),
    get(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${enc}`),
  ]);
  const { phonetic, senses } = parseDictionaryApi(dict);
  return {
    word: w, phonetic, senses,
    wiki: wiki?.extract && wiki.type !== 'disambiguation' ? { title: wiki.title, extract: wiki.extract, url: wiki.content_urls?.desktop?.page || '' } : null,
  };
}
