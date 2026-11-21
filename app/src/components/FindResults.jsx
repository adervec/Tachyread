import { Fragment, useState } from 'react';
import { contextLines } from '../document/findText.js';
import { t, fmtNum } from '../i18n.js';

// Highlight every case-insensitive occurrence of `q` in `text`.
function highlight(text, q) {
  if (!q) return text;
  const parts = [];
  const lc = text.toLowerCase(), lq = q.toLowerCase();
  let from = 0, i;
  while ((i = lc.indexOf(lq, from)) >= 0) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(<mark key={parts.length}>{text.slice(i, i + q.length)}</mark>);
    from = i + q.length;
  }
  parts.push(text.slice(from));
  return parts;
}

// Shared results table for the Find dialog and the ToC wizard's locate-in-text tool. Columns: result
// #, line #, word #, % location, (optional) containing ToC section + already-read. Clicking a match
// row expands the surrounding lines inline (context peek). `actions` (or null) adds per-row buttons.
export default function FindResults({ doc, results, query, showSection = true, showRead = true, actions = null, seqRange = null }) {
  const [open, setOpen] = useState(null); // seq of the row whose context is expanded
  const inSeq = (r) => !seqRange || (r.wordIndex > seqRange.lo && r.wordIndex < seqRange.hi);
  const colCount = 4 + (seqRange ? 1 : 0) + (showSection ? 1 : 0) + (showRead ? 1 : 0) + 1 + (actions ? 1 : 0);
  return (
    <div className="find-table-wrap">
      <table className="find-table">
        <thead>
          <tr>
            <th title={t('Result number')}>#</th>
            <th title={t('Line number')}>{t('Ln')}</th>
            <th title={t('Word number in the document')}>{t('Wd')}</th>
            <th title={t('Percent through the document')}>@%</th>
            {seqRange && <th title={t('In sequence: after the entries above it and before those below')}>{t('Seq')}</th>}
            {showSection && <th title={t('Containing table-of-contents section')}>{t('Section')}</th>}
            {showRead && <th title={t('Already read (before your current position)')}>✓</th>}
            <th className="find-th-text">{t('Match — click for context')}</th>
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <Fragment key={r.seq}>
              <tr className={`find-row${r.read ? ' read' : ''}${open === r.seq ? ' exp' : ''}${seqRange && !inSeq(r) ? ' out-of-seq' : ''}`}>
                <td className="find-num">{r.seq}</td>
                <td className="find-num">{r.lineIndex + 1}</td>
                <td className="find-num">{r.wordIndex >= 0 ? r.wordIndex + 1 : '—'}</td>
                <td className="find-num">{fmtNum(r.pct, 1, 1)}%</td>
                {seqRange && <td className="find-seq" title={inSeq(r) ? t('In sequence') : t('Out of sequence — would break the entry order')}>{inSeq(r) ? '✓' : '⚠'}</td>}
                {showSection && <td className="find-sec" title={r.section}>{r.section || '—'}</td>}
                {showRead && <td className="find-read" title={r.read ? t('Already read') : t('Not yet read')}>{r.read ? '✓' : ''}</td>}
                <td className="find-text" title={t('Click to show the surrounding lines')} onClick={() => setOpen((o) => (o === r.seq ? null : r.seq))}>
                  {highlight(r.text, query)}
                </td>
                {actions && (
                  <td className="find-acts">
                    {actions.map((a, ai) => <button key={ai} className={a.cls || ''} title={a.title} onClick={() => a.onClick(r)}>{a.icon}</button>)}
                  </td>
                )}
              </tr>
              {open === r.seq && (
                <tr className="find-ctx-row">
                  <td colSpan={colCount}>
                    <div className="find-ctx">
                      {contextLines(doc, r.lineIndex, 3).map((c) => (
                        <div key={c.lineIndex} className={`find-ctx-line${c.match ? ' match' : ''}`}>
                          <span className="find-ctx-ln">{c.lineIndex + 1}</span>
                          <span className="find-ctx-tx">{c.match ? highlight(c.text, query) : (c.text || '·')}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
