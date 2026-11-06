import { useEffect, useRef, useState } from 'react';
import { companionLine } from '../features/companion.js';

// Side-by-side reading: another open document beside the one you're reading (a translation, the
// original, a study guide). "Follow" keeps it at the same relative position as your reading; off,
// you page through it yourself. Read-only — tracking stays with the main document.
const SPAN = 70; // lines rendered either side of the focus line

export default function CompanionPane({ tab, tabs, onSet, hydrate }) {
  const comp = tab.settings.companion || {};
  const other = tabs.find((t) => t.id !== tab.id && (t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum) === comp.checksum);
  const cdoc = other && !other.lazy ? other.doc : null;
  useEffect(() => { if (other?.lazy) hydrate(other.id); }, [other?.id, other?.lazy, hydrate]);
  const follow = comp.follow !== false;
  const target = cdoc ? companionLine(tab.settings.wordIndex || 0, tab.doc.words.length, cdoc) : 0;
  const [manual, setManual] = useState(null);
  const focus = follow || manual == null ? target : manual;
  const focusRef = useRef(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center' }); }, [focus, cdoc]);
  const choices = tabs.filter((t) => t.id !== tab.id && (t.lazy ? t.settings?.contentChecksum : t.doc?.contentChecksum));
  const nameOf = (t) => (t.lazy ? t.fileName : t.doc?.fileName) || 'Untitled';
  const lines = cdoc ? cdoc.lines.slice(Math.max(0, focus - SPAN), focus + SPAN + 1) : [];
  const first = Math.max(0, focus - SPAN);
  return (
    <div className="companion-pane">
      <div className="companion-bar">
        <select value={comp.checksum || ''} aria-label="Document to read beside this one"
          onChange={(e) => onSet({ ...comp, checksum: e.target.value || null })}>
          <option value="">— pick an open document —</option>
          {choices.map((t) => { const cs = t.lazy ? t.settings.contentChecksum : t.doc.contentChecksum; return <option key={t.id} value={cs}>{nameOf(t)}</option>; })}
        </select>
        <label className="inline-check" title="Keep it at the same relative position as what you're reading">
          <input type="checkbox" checked={follow} onChange={(e) => { setManual(target); onSet({ ...comp, follow: e.target.checked }); }} /> Follow
        </label>
        {!follow && cdoc && (
          <>
            <button onClick={() => setManual(Math.max(0, focus - 20))} aria-label="Back a page">▲</button>
            <button onClick={() => setManual(Math.min(cdoc.lines.length - 1, focus + 20))} aria-label="Forward a page">▼</button>
          </>
        )}
        <button className="link-btn" onClick={() => onSet(null)} title="Close side-by-side" aria-label="Close side-by-side">✕</button>
      </div>
      {!choices.length && <p className="settings-note">Open a second document in another tab (a translation, the original…) to read it here beside this one.</p>}
      {other && !cdoc && <p className="settings-note">Loading…</p>}
      <div className="companion-text">
        {lines.map((l, k) => (
          <p key={first + k} ref={first + k === focus ? focusRef : null} className={first + k === focus ? 'here' : ''}>{l.isEmpty ? ' ' : l.text}</p>
        ))}
      </div>
    </div>
  );
}
