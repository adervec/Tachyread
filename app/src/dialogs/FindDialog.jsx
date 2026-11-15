import { useEffect, useMemo, useState } from 'react';
import { searchAllDocs } from '../state/storage.js';
import Dialog from './Dialog.jsx';
import { getTocEntries } from '../document/toc.js';
import { findInDoc } from '../document/findText.js';
import FindResults from '../components/FindResults.jsx';
import { t } from '../i18n.js';

export default function FindDialog({ tab, onJumpWord, onPeek, onSetGoal, onClose, initialQuery = '', onOpenDoc }) {
  const [q, setQ] = useState(initialQuery);
  const [caseSens, setCaseSens] = useState(false);
  // Scope: this document, or every document stored on this device (results open the book and re-run
  // the same search there, so the jump lands on the exact match).
  const [scope, setScope] = useState('doc');
  const [lib, setLib] = useState(null); // null = not searched yet / searching
  useEffect(() => {
    if (scope !== 'all' || q.trim().length < 2) { setLib(null); return undefined; }
    let stale = false;
    setLib(null);
    const timer = setTimeout(() => { searchAllDocs(q.trim(), { caseSensitive: caseSens, shouldStop: () => stale }).then((r) => { if (!stale) setLib(r); }).catch(() => { if (!stale) setLib([]); }); }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [scope, q, caseSens]);
  const { doc, settings } = tab;
  const tocEntries = useMemo(() => getTocEntries(tab) || [], [tab]);
  const results = useMemo(
    () => findInDoc(doc, q, { caseSensitive: caseSens, tocEntries, readFrontier: settings.wordIndex || 0 }),
    [doc, q, caseSens, tocEntries, settings.wordIndex],
  );

  // Same actions as the Contents page: jump here, peek (keep your place), or set reaching it as a goal.
  const actions = [
    { icon: '▶', title: t('Jump here (move reading position)'), onClick: (r) => { if (r.wordIndex >= 0) onJumpWord(r.wordIndex); onClose(); } },
    { icon: '👁', title: t('Peek — scroll it into view, keep your position'), onClick: (r) => onPeek?.(r.lineIndex) },
    { icon: '🎯', title: t('Set reaching this point as your reading goal'), onClick: (r) => onSetGoal?.(r.wordIndex, t('Find: “{q}”', { q })) },
  ];

  return (
    <Dialog title={t('Find')} onClose={onClose} width={760}>
      <div className="find-bar">
        <input
          autoFocus type="text" className="find-input" value={q}
          onChange={(e) => setQ(e.target.value)} placeholder={scope === 'all' ? t('Search every document on this device…') : t('Search the document…')}
        />
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={t('Search scope')} title={t('Search just this document, or every document whose text is stored on this device')}>
          <option value="doc">{t('This document')}</option>
          <option value="all">{t('All documents')}</option>
        </select>
        <label className="inline-check"><input type="checkbox" checked={caseSens} onChange={(e) => setCaseSens(e.target.checked)} /> {t('Case')}</label>
        {scope === 'doc' && <span className="settings-note" style={{ margin: 0 }}>{t.n('{n} match', '{n} matches', results.length)}</span>}
        {scope === 'all' && lib && <span className="settings-note" style={{ margin: 0 }}>{t.n('{matches} matches in {n} document', '{matches} matches in {n} documents', lib.length, { matches: lib.reduce((a, d) => a + d.count, 0) })}</span>}
      </div>
      {scope === 'doc' && (
        <>
          {q && results.length === 0 && <p className="settings-note">{t('No matches for “{q}”.', { q })}</p>}
          <FindResults doc={doc} results={results} query={q} actions={actions} />
        </>
      )}
      {scope === 'all' && (
        q.trim().length < 2 ? <p className="settings-note">{t("Type at least two letters. Searches every document whose text is saved on this device (anything you've opened here).")}</p>
          : !lib ? <p className="settings-note">{t('Searching…')}</p>
            : !lib.length ? <p className="settings-note">{t('No matches for “{q}” in any stored document.', { q })}</p>
              : (
                <div className="ft-results">
                  {lib.map((d) => (
                    <div key={d.checksum} className="ft-doc">
                      <div className="ft-doc-h">
                        <b>{d.fileName}</b> <span className="lj-qdim">{t.n('{n} match', '{n} matches', d.count)}</span>
                        <button className="link-btn" onClick={() => onOpenDoc?.(d.checksum, q.trim())} title={t('Open this document and show its matches')}>{t('Open')} ↗</button>
                      </div>
                      {d.hits.map((h) => (
                        <button key={h.pos} className="ft-hit" onClick={() => onOpenDoc?.(d.checksum, q.trim())}>
                          {h.before}<mark>{h.match}</mark>{h.after}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )
      )}
    </Dialog>
  );
}
