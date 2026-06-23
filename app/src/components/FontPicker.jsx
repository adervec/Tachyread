import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SYSTEM_FONTS, BUNDLED, GOOGLE_FAMILIES, CATEGORY_LABELS, fontStack, primaryFamily,
  loadFontEntry, queryInstalledFonts, LOCAL_FONTS_SUPPORTED, ensureGoogleFont,
} from '../state/fonts.js';

const PREVIEW = 'Aa Bb Cc — The quick brown fox 0123';

// A searchable font picker with live previews. Outputs a full CSS font-family stack (family +
// generic fallback) via onChange, so the value drops straight into --serif-family / --sans-family.
// Sources: always-available system fonts, bundled libre fonts, the device's installed fonts (on
// request, Chromium), and — only when `googleEnabled` — the Google Fonts CDN library plus any
// family typed by hand. Privacy note: Google families load from Google's servers when previewed.
export default function FontPicker({ value, onChange, googleEnabled = false, defaultCategory }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [localFonts, setLocalFonts] = useState(null); // null until requested
  const [localStatus, setLocalStatus] = useState('');
  const [custom, setCustom] = useState('');
  const rootRef = useRef(null);

  const current = primaryFamily(value) || '(theme default)';

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (!rootRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Build the grouped, filtered option set. Google + local groups only appear when relevant.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f) => !q || f.name.toLowerCase().includes(q);
    const g = [];
    g.push({ key: 'system', label: 'System & web-safe', items: SYSTEM_FONTS.filter(match) });
    g.push({ key: 'bundled', label: 'Bundled (offline, libre)', items: BUNDLED.filter(match) });
    if (localFonts) g.push({ key: 'local', label: `Installed on this device (${localFonts.length})`, items: localFonts.filter(match) });
    if (googleEnabled) g.push({ key: 'google', label: 'Google Fonts (loads from CDN)', items: GOOGLE_FAMILIES.filter(match) });
    return g.filter((grp) => grp.items.length);
  }, [query, localFonts, googleEnabled]);

  function choose(entry) {
    loadFontEntry(entry, googleEnabled);
    onChange(fontStack(entry));
    setOpen(false);
    setQuery('');
  }

  async function loadLocal() {
    if (!LOCAL_FONTS_SUPPORTED) { setLocalStatus('Not supported in this browser (try Chrome/Edge).'); return; }
    setLocalStatus('Requesting permission…');
    const list = await queryInstalledFonts();
    if (!list) { setLocalStatus('Permission denied or unavailable.'); return; }
    setLocalFonts(list);
    setLocalStatus(`${list.length} families loaded.`);
  }

  function applyCustom() {
    const fam = custom.trim();
    if (!fam) return;
    if (googleEnabled) ensureGoogleFont(fam);
    const generic = defaultCategory === 'serif' ? 'serif' : 'sans-serif';
    onChange(`'${fam.replace(/'/g, '')}', ${generic}`);
    setCustom('');
    setOpen(false);
  }

  return (
    <div className="font-picker" ref={rootRef}>
      <button
        type="button"
        className="font-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        style={{ fontFamily: value || undefined }}
        title={value || ''}
      >
        <span className="fp-current">{current}</span>
        <span className="fp-caret">▾</span>
      </button>

      {open && (
        <div className="font-picker-panel">
          <input
            type="text"
            className="fp-search"
            autoFocus
            placeholder="Search fonts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="fp-list">
            {groups.map((grp) => (
              <div key={grp.key} className="fp-group">
                <div className="fp-group-label">{grp.label}</div>
                {grp.items.map((entry) => {
                  const selected = primaryFamily(value).toLowerCase() === primaryFamily(entry.css).toLowerCase();
                  return (
                    <button
                      type="button"
                      key={`${grp.key}:${entry.name}`}
                      className={`fp-option${selected ? ' selected' : ''}`}
                      // Previewing a Google family pulls it from the CDN; bundled/system/local are local.
                      onMouseEnter={() => loadFontEntry(entry, googleEnabled)}
                      onClick={() => choose(entry)}
                    >
                      <span className="fp-name">{entry.name}</span>
                      <span className="fp-preview" style={{ fontFamily: fontStack(entry) }}>{PREVIEW}</span>
                      {entry.cat && <span className="fp-cat">{CATEGORY_LABELS[entry.cat] || entry.cat}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {!groups.length && <div className="fp-empty">No matches.</div>}
          </div>

          <div className="fp-footer">
            {!localFonts && (
              <button type="button" className="fp-action" onClick={loadLocal} disabled={!LOCAL_FONTS_SUPPORTED}
                title={LOCAL_FONTS_SUPPORTED ? 'Enumerate the fonts installed on this device' : 'Chromium-only feature'}>
                ＋ Use my installed fonts
              </button>
            )}
            {localStatus && <span className="fp-status">{localStatus}</span>}
            {googleEnabled && (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
