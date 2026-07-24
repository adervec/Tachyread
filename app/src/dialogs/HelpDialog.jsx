import { useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { HELP_SECTIONS, sectionText } from '../features/helpContent.js';
import { printHtml, slideshowHtml } from '../features/helpExport.js';

// In-app help: navigable sections (the app has grown, so there's a jump-to sidebar) with full-text
// search, and one-click export to PDF (print) or a self-contained narrated slideshow. Content lives
// in features/helpContent.js so the dialog and both exports share one source.
export default function HelpDialog({ onClose }) {
  const [query, setQuery] = useState('');
  const bodyRef = useRef(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_SECTIONS;
    return HELP_SECTIONS.filter((s) => sectionText(s).includes(q));
  }, [query]);

  function jumpTo(id) {
    const el = bodyRef.current?.querySelector(`#help-sec-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function exportPdf() {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(printHtml(HELP_SECTIONS));
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 350);
  }
  function exportSlideshow() {
    const blob = new Blob([slideshowHtml(HELP_SECTIONS)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tachyread-guided-tour.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Dialog
      title="Help"
      onClose={onClose}
      width={860}
      buttons={<>
        <button onClick={exportPdf} title="Open a print-ready version — choose “Save as PDF”">⭳ PDF</button>
        <button onClick={exportSlideshow} title="Download a self-contained narrated slideshow (HTML) with speech narration">⭳ Slideshow</button>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>Close</button>
      </>}
    >
      <input
        type="text"
        className="fp-search"
        autoFocus
        placeholder="Search help… (e.g. scroll, wpm, ocr, gestures, covers)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
      />
      <div className="help-layout">
        <nav className="help-nav" aria-label="Help sections">
          {shown.map((s) => (
            <button key={s.id} className="help-navlink" onClick={() => jumpTo(s.id)}>{s.title}</button>
          ))}
          {!shown.length && <span className="settings-note">No matches</span>}
        </nav>
        <div className="help-body" ref={bodyRef}>
          {shown.map((s) => (
            <section key={s.id} id={`help-sec-${s.id}`} className="help-section">
              <h3>{s.title}</h3>
              {s.intro && <p>{s.intro}</p>}
              {(s.body || []).map((p, i) => <p key={i}>{p}</p>)}
              {s.groups && (
                <div className="help-keymap">
                  {s.groups.map((g) => (
                    <div key={g.name} className="help-keygroup">
                      <div className="help-keygroup-name">{g.name}</div>
                      {g.keys.map(([combo, desc]) => (
                        <div key={combo} className="help-keyrow">
                          <span className="help-keys">{combo.split(' ').map((c, j) => <kbd key={j}>{c}</kbd>)}</span>
                          <span className="help-keydesc">{desc}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          {!shown.length && <p className="settings-note">No matches — try a shorter term.</p>}
        </div>
      </div>
    </Dialog>
  );
}
