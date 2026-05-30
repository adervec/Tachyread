import { useEffect, useMemo, useState } from 'react';
import { orpIndex } from '../document/readerDocument.js';

export default function FootnoteOverlay({ tab, onClose }) {
  const fn = useMemo(() => findFootnoteAtCurrent(tab), [tab]);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const words = fn?.body ? fn.body.split(/\s+/).filter(Boolean) : [];

  useEffect(() => {
    if (!playing || !words.length) return;
    const wpm = tab.settings.wpm || 250;
    const ms = 60000 / wpm;
    const t = setTimeout(() => {
      setIdx((i) => {
        if (i + 1 >= words.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, ms);
    return () => clearTimeout(t);
  }, [playing, idx, words.length, tab.settings.wpm]);

  if (!fn) {
    return (
      <div className="footnote-overlay">
        <div className="ftnh">
          <span>Footnote</span>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="ftnb">No footnote found at the current word.</div>
      </div>
    );
  }

  return (
    <div className="footnote-overlay">
      <div className="ftnh">
        <span>Footnote [{fn.number}]</span>
        <span>
          <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play SPRITZ'}</button>{' '}
          <button onClick={onClose}>Close (Esc)</button>
        </span>
      </div>
      {playing && words[idx] ? (
        <div style={{ fontSize: 36, textAlign: 'center', padding: '12px 0' }}>
          {(() => {
            const w = words[idx];
            const o = orpIndex(w.length);
            return (
              <>
                {w.slice(0, o)}
                <span style={{ color: 'var(--orp-fg)', fontWeight: 'bold' }}>{w[o]}</span>
                {w.slice(o + 1)}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="ftnb">{fn.body || '(no body text — only the marker was located)'}</div>
      )}
    </div>
  );
}

function findFootnoteAtCurrent(tab) {
  const { doc, settings } = tab;
  if (!doc.footnotes || doc.footnotes.size === 0) return null;
  const wi = settings.wordIndex;
  for (const fn of doc.footnotes.values()) {
    if (fn.anchors.includes(wi)) return fn;
  }
  // Search within +/- 3 words for a nearby marker
  for (const fn of doc.footnotes.values()) {
    if (fn.anchors.some((a) => Math.abs(a - wi) <= 3)) return fn;
  }
  return null;
}
