// Languages (house standard 20). Tachyread is written in English; the other 16 languages are machine
// translated (CoworkSyncHub/i18n.mjs: extract → todo → translate → merge → check) into
// public/locales/<lang>.json, which the shared font.js loads. Write the English straight in the code:
//   t('Saved {n} books', { n })      t.n('{n} book', '{n} books', count)
// The English IS the key, so never build a sentence by concatenation, and keep keys literal (a
// label passed through a variable is listed in an i18n-keys comment, A | B, so the scan sees it).
// main.jsx loads the app only after the dictionary is ready, so module-level labels translate too.
// Outside the browser (node self-checks) this falls back to the English.
const interp = (s, p) => (p ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(p, k) ? String(p[k]) : m)) : String(s));
const shared = () => (typeof window !== 'undefined' ? window.appFont : null);

export function t(key, params) {
  const f = shared();
  return f?.t ? f.t(key, params) : interp(key, params);
}
t.n = (one, other, n, params) => {
  const f = shared();
  return f?.t?.n ? f.t.n(one, other, n, params) : interp(n === 1 ? one : other, { n, ...params });
};
