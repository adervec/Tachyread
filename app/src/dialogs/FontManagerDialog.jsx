import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import {
  SYSTEM_FONTS, BUNDLED, GOOGLE_FAMILIES, CATEGORY_LABELS, fontStack, primaryFamily,
  loadFontEntry, queryInstalledFonts, LOCAL_FONTS_SUPPORTED, ensureGoogleFont,
} from '../state/fonts.js';

const PREVIEW = 'The quick brown fox jumps over the lazy dog — 0123456789';

// Families with published readability evidence or a design brief targeting legibility.
// Score 3 = designed for readability studies / low-vision & dyslexia briefs; 2 = strong
// screen-legibility track record; 1 = generally regarded as comfortable for long reading.
const READABILITY = {
  'lexend': 3, 'atkinson hyperlegible': 3, 'opendyslexic': 3, 'sitka': 3, 'sitka text': 3,
  'verdana': 2, 'georgia': 2, 'literata': 2, 'source serif 4': 2, 'charter': 2, 'bitter': 2,
  'garamond': 2, 'eb garamond': 2, 'merriweather': 2, 'inter': 2, 'open sans': 2, 'clear sans': 2,
  'palatino': 1, 'cambria': 1, 'calibri': 1, 'nunito': 1, 'lato': 1, 'source sans 3': 1,
  'work sans': 1, 'crimson pro': 1, 'lora': 1, 'tahoma': 1, 'segoe ui': 1, 'noto sans': 1, 'noto serif': 1,
};
export function readabilityScore(name) {
  return READABILITY[String(name || '').toLowerCase()] || 0;
}
const READ_BADGE = { 3: '★★★', 2: '★★', 1: '★' };

// Font Manager: one reading font per tab (Fast Reader word, Lines pane, everywhere text is read),
// chosen from every source the app knows — system, bundled libre, device-installed (Chromium),
// Google Fonts (only when opted in). Search, favorites (global, synced), and sorting by
// readability (curated: Lexend / Atkinson Hyperlegible / Sitka / Verdana / Garamond etc.).
export default function FontManagerDialog({ tab, global, onPatchSettings, onPatchGlobal, onClose }) {
  const googleEnabled = !!global.enableGoogleFonts;
  const favorites = useMemo(() => new Set(global.fontFavorites || []), [global.fontFavorites]);
  const current = tab?.settings?.fontFamily || '';
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('readability'); // readability | name | source
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [localFonts, setLocalFonts] = useState(null);
  const [localStatus, setLocalStatus] = useState('');
  const [custom, setCustom] = useState('');

  const all = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const list of [BUNDLED, SYSTEM_FONTS, localFonts || [], googleEnabled ? GOOGLE_FAMILIES : []]) {
      for (const f of list) {
        const key = f.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(f);
      }
    }
    return out;
  }, [localFonts, googleEnabled]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Advanced search: plain text matches the name; "cat:serif" / "cat:sans" / "cat:mono" /
    // "cat:a11y" filters by category; "src:bundled|system|local|google" by source.
    const terms = q.split(/\s+/).filter(Boolean);
    let list = all.filter((f) => terms.every((t) => {
      if (t.startsWith('cat:')) return (f.cat || '') === t.slice(4);
      if (t.startsWith('src:')) return (f.source || '') === t.slice(4);
      return f.name.toLowerCase().includes(t);
    }));
    if (onlyFavs) list = list.filter((f) => favorites.has(f.name));
    const bySort = {
      readability: (a, b) => readabilityScore(b.name) - readabilityScore(a.name) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      source: (a, b) => (a.source || '').localeCompare(b.source || '') || a.name.localeCompare(b.name),
    };
    // Favorites always float to the top within the chosen sort.
    return [...list].sort((a, b) => (favorites.has(b.name) - favorites.has(a.name)) || bySort[sort](a, b));
  }, [all, query, sort, onlyFavs, favorites]);

  // Load visible previews lazily as the list renders (Google families fetch from the CDN).
  useEffect(() => { shown.slice(0, 40).forEach((f) => loadFontEntry(f, googleEnabled)); }, [shown, googleEnabled]);

  function choose(entry) {
    loadFontEntry(entry, googleEnabled);
    onPatchSettings({ fontFamily: fontStack(entry) });
  }
  function toggleFav(name) {
    const next = new Set(favorites);
    if (next.has(name)) next.delete(name); else next.add(name);
    onPatchGlobal({ fontFavorites: [...next] });
  }
  async function loadLocal() {
    if (!LOCAL_FONTS_SUPPORTED) { setLocalStatus('Installed-font access needs Chrome/Edge.'); return; }
    setLocalStatus('Requesting permission…');
    const list = await queryInstalledFonts();
    if (!list) { setLocalStatus('Permission denied or unavailable.'); return; }
    setLocalFonts(list);
    setLocalStatus(`${list.length} installed families added.`);
  }
  function applyCustom() {
    const fam = custom.trim();
    if (!fam) return;
    if (googleEnabled) ensureGoogleFont(fam);
    onPatchSettings({ fontFamily: `'${fam.replace(/'/g, '')}', sans-serif` });
    setCustom('');
  }

  const currentName = primaryFamily(current);
  return (
    <Dialog title="Font Manager — one reading font for this tab" onClose={onClose} width={700} buttons={<button onClick={onClose}>Done</button>}>
      <div className="fm-head">
        <div className="fm-current" style={{ fontFamily: current || undefined }}>
          Current: <strong>{currentName || '(theme default)'}</strong>
          {current && <button className="fm-clear" onClick={() => onPatchSettings({ fontFamily: '' })} title="Back to the theme's default font">✕ clear</button>}
        </div>
        <p className="settings-note" style={{ margin: '4px 0 0' }}>
          Applies to the Fast Reader word, the Lines pane, and typing (typing stays monospace unless
          you pick a font here with <code>cat:mono</code>). Search tips: <code>cat:serif</code>, <code>cat:mono</code>, <code>src:bundled</code>.
          ★ = known readability pedigree (Lexend, Atkinson Hyperlegible, Sitka, Verdana, Garamond…).
        </p>
      </div>
      <div className="fm-toolbar">
        <input
          type="text"
          className="fp-search"
          autoFocus
          placeholder="Search fonts… (name, cat:, src:)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="readability">Readability</option>
            <option value="name">Name</option>
            <option value="source">Source</option>
          </select>
        </label>
        <label className="inline-check" title="Show only your favorite fonts">
          <input type="checkbox" checked={onlyFavs} onChange={(e) => setOnlyFavs(e.target.checked)} />
          ♥ favorites
        </label>
      </div>
      <div className="fm-list">
        {shown.map((f) => {
          const selected = currentName.toLowerCase() === primaryFamily(f.css).toLowerCase() || currentName.toLowerCase() === f.name.toLowerCase();
          const score = readabilityScore(f.name);
          return (
            <div key={`${f.source}:${f.name}`} className={`fm-row${selected ? ' selected' : ''}`}>
              <button
                type="button"
                className={`fm-fav${favorites.has(f.name) ? ' on' : ''}`}
                title={favorites.has(f.name) ? 'Unfavorite' : 'Favorite'}
                onClick={() => toggleFav(f.name)}
              >
                {favorites.has(f.name) ? '♥' : '♡'}
              </button>
              <button type="button" className="fm-pick" onMouseEnter={() => loadFontEntry(f, googleEnabled)} onClick={() => choose(f)}>
                <span className="fm-name">
                  {f.name}
                  {score > 0 && <span className="fm-read" title="Readability pedigree">{READ_BADGE[score]}</span>}
                </span>
                <span className="fm-preview" style={{ fontFamily: fontStack(f) }}>{PREVIEW}</span>
              </button>
              <span className="fm-meta">{CATEGORY_LABELS[f.cat] || f.cat || ''}{f.source === 'google' ? ' · CDN' : f.source === 'local' ? ' · installed' : ''}</span>
            </div>
          );
        })}
        {!shown.length && <div className="fp-empty">No matches{onlyFavs ? ' among favorites' : ''}.</div>}
      </div>
      <div className="fp-footer">
        {!localFonts && (
          <button type="button" className="fp-action" onClick={loadLocal} disabled={!LOCAL_FONTS_SUPPORTED}
            title={LOCAL_FONTS_SUPPORTED ? 'Enumerate the fonts installed on this device' : 'Chromium-only feature'}>
            ＋ Use my installed fonts
          </button>
        )}
        {localStatus && <span className="fp-status">{localStatus}</span>}
        {googleEnabled ? (
          <div className="fp-custom">
            <input
              type="text"
              placeholder="…or type any Google family name"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustom(); } }}
            />
            <button type="button" onClick={applyCustom}>Use</button>
          </div>
        ) : (
          <span className="fp-status">Enable Google Fonts in Application Settings for the full CDN library.</span>
        )}
      </div>
    </Dialog>
  );
}
