import { useState } from 'react';
import Dialog from './Dialog.jsx';

// Regression Report — surfaces this session's backward saccades (re-reads) over already-read text.
// Regressions are a normal, comprehension-driven part of reading, so the goal is NOT zero: it is to
// notice *habitual* short regressions (a reflexive twitch back a word or two) and trim those, while
// leaving genuine re-analysis alone. Data comes from the reading tracker; drive it by reading in the
// Lines pane and pressing ← to look back.

function snippet(doc, at, before = 4, after = 4) {
  const a = Math.max(0, at - before);
  const b = Math.min(doc.words.length, at + after + 1);
  const parts = [];
  for (let i = a; i < b; i++) parts.push({ w: doc.words[i], hit: i === at, key: i });
  return parts;
}

export default function RegressionDialog({ tab, onJumpWord, onClose }) {
  const [, force] = useState(0);
  const tracker = tab?.tracker;
  const doc = tab?.doc;
  const stats = tracker
    ? tracker.regressionStats()
    : { count: 0, short: 0, long: 0, ratePer100: 0, recent: [] };
  const shortPct = stats.count ? Math.round((stats.short / stats.count) * 100) : 0;

  return (
    <Dialog
      title="Regression Report"
      onClose={onClose}
      width={620}
      buttons={
        <>
          <button
            onClick={() => {
              tracker?.resetRegressions();
              force((n) => n + 1);
            }}
            disabled={!stats.count}
          >
            Reset session
          </button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="reg-cards">
        <div className="reg-card">
          <b>{stats.count}</b>
          <span>regressions</span>
        </div>
        <div className="reg-card">
          <b>{stats.short}</b>
          <span>short (≤2 words)</span>
        </div>
        <div className="reg-card">
          <b>{stats.long}</b>
          <span>longer (re-analysis)</span>
        </div>
        <div className="reg-card">
          <b>{stats.ratePer100.toFixed(1)}</b>
          <span>per 100 words read</span>
        </div>
      </div>

      {stats.count > 0 && (
        <div className="reg-bar" title={`${shortPct}% short`}>
          <div className="reg-bar-short" style={{ width: `${shortPct}%` }} />
        </div>
      )}

      <p className="settings-note" style={{ marginTop: 8 }}>
        {stats.count === 0 ? (
          <>
            No regressions recorded this session. Read in the <strong>Lines</strong> pane and press{' '}
            <strong>←</strong> to look back — your backward jumps show up here, split into short
            (often habitual) and longer (usually genuine re-analysis).
          </>
        ) : (
          <>
            <strong>{shortPct}%</strong> of your regressions were short (≤2 words). Short regressions
            are most often habitual; longer ones usually mean real re-analysis. Trimming the short
            ones is typically the safest speed gain — they rarely add comprehension.
          </>
        )}
      </p>

      {stats.recent.length > 0 && doc && (
        <>
          <div className="field-section">Recent regressions (newest first)</div>
          <div className="reg-list">
            {stats.recent.map((r, i) => (
              <div
                key={i}
                className="reg-item"
                onClick={() => onJumpWord?.(r.at)}
                title="Jump to this spot"
              >
                <span className={`reg-badge ${r.back <= 2 ? 'short' : 'long'}`}>↩ {r.back}</span>
                <span className="reg-snip">
                  {snippet(doc, r.at).map((p) => (
                    <span key={p.key} className={p.hit ? 'reg-hit' : ''}>
                      {p.w}{' '}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
