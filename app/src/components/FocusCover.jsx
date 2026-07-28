import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import FaceSVG from './FaceSVG.jsx';
import Trendline from './Trendline.jsx';
import { WpmSparkline } from './ReadingStats.jsx';
import { goalFraction, computeGoalStatus } from '../engine/goals.js';
import { MODES } from '../engine/readingMode.js';

function fmtDur(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// One reader widget for a focus cover. Reuses the dock's stat markup (dash-num/dash-label) and the
// existing goal/trendline/spark/face components. Returns null when there's nothing to show (e.g. the
// goal widget with no goal set) so the slot doesn't render blank. Values are read live off the tab.
function renderWidget(id, { tab, wpm, lineProgress, readingMode, nowMs }) {
  const { settings, doc, tracker } = tab;
  const idx = settings.wordIndex;
  const total = doc.words.length;
  const inner = (() => {
    switch (id) {
      case 'faces': {
        const count = Math.max(1, Math.min(3, settings.faceCount || 1));
        const styles = settings.faceStyles || ['Man', 'Owl', 'Robot'];
        return (
          <div className="focus-faces">
            {Array.from({ length: count }, (_, i) => (
              <FaceSVG key={i} wpm={wpm} lineProgress={lineProgress} faceStyle={styles[i] || 'Man'} artStyle={settings.artStyle || 'Cartoon'} size={220} />
            ))}
          </div>
        );
      }
      case 'nowWpm': {
        const recent = tracker ? tracker.recentWpm() : 0;
        return <div className="dash-stat dash-stat-hero"><span className="dash-num">{recent || '—'}</span><span className="dash-label">Reading now (WPM)</span></div>;
      }
      case 'sessionWpm':
        return <div className="dash-stat"><span className="dash-num">{(tracker ? tracker.sessionWpm() : 0) || '—'}</span><span className="dash-label">Session efficiency (WPM)</span></div>;
      case 'lifetimeWpm':
        return <div className="dash-stat"><span className="dash-num">{(tracker ? tracker.lifetimeWpm() : 0) || '—'}</span><span className="dash-label">Lifetime WPM</span></div>;
      case 'coverage': {
        const cov = tracker ? tracker.coverageExcluding(settings.skipRanges) : 0;
        const active = tracker ? tracker.sessionActiveMs : 0;
        return <div className="dash-stat"><span className="dash-num">{(cov * 100).toFixed(1)}<span className="dash-of">%</span></span><span className="dash-label">Book read · {fmtDur(active)} active</span></div>;
      }
      case 'eta': {
        const recent = tracker ? tracker.recentWpm() : 0;
        const eff = recent || (tracker ? tracker.sessionWpm() : 0) || settings.wpm;
        const eta = eff > 0 ? ((total - idx) / eff) * 60000 : null;
        return <div className="dash-stat"><span className="dash-num">{eta != null ? fmtDur(eta) : '—'}</span><span className="dash-label">To finish (measured pace)</span></div>;
      }
      case 'goal': {
        const goal = settings.goal;
        if (!goal || !goal.type || goal.type === 'None') return null;
        const frac = goalFraction(tab, goal);
        const complete = frac != null && frac >= 1;
        return (
          <div className="dash-stat focus-goal">
            <span className="dash-label">🏁 {computeGoalStatus(tab, goal)}</span>
            {frac != null && <div className="goal-bar"><div className={`goal-fill${complete ? ' goal-fill-done' : ''}`} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} /></div>}
          </div>
        );
      }
      case 'position':
        return <div className="dash-stat dash-stat-row"><span className="dash-mini">Word {idx + 1}/{total}</span><span className="dash-mini">Line {(doc.wordToLine[idx] || 0) + 1}/{doc.lines.length}</span></div>;
      case 'pct':
        return <div className="dash-stat"><span className="dash-num">{total ? ((idx / total) * 100).toFixed(1) : '0.0'}<span className="dash-of">%</span></span><span className="dash-label">Through the book</span></div>;
      case 'spark':
        return <div className="dash-stat focus-spark"><WpmSparkline tabId={tab.id} /><span className="dash-label">WPM · last 8 min</span></div>;
      case 'trendline':
        return <div className="dash-stat focus-trend"><Trendline tab={tab} /></div>;
      case 'mode':
        return <div className="dash-stat dash-stat-row focus-mode"><span className="dash-mini">{MODES[readingMode]?.icon} {MODES[readingMode]?.label || '—'}</span></div>;
      case 'clock':
        return <div className="dash-stat dash-stat-hero"><span className="dash-num">{hhmm(new Date(nowMs))}</span></div>;
      default:
        return null;
    }
  })();
  if (inner == null) return null;
  return <div className="focus-widget" data-widget={id} key={id}>{inner}</div>;
}

// Portal a stack of chosen widgets into ONE cover window's document (over the dim background). When a
// `container` element is supplied it renders there instead (the same-window test seam); otherwise it
// makes a `.focus-panels` div inside the cover's body. Every cover-document access is guarded — a
// cover window can be closed by the user at any moment.
export default function FocusCover({ cover, container, ids, ...ctx }) {
  const [target, setTarget] = useState(container || null);
  useEffect(() => {
    if (container) { setTarget(container); return undefined; }
    let host = null;
    try {
      if (!cover || cover.closed) return undefined;
      host = cover.document.createElement('div');
      host.className = 'focus-panels';
      cover.document.body.appendChild(host);
      setTarget(host);
    } catch { /* cover closed */ }
    return () => { try { host?.parentNode?.removeChild(host); } catch { /* closed */ } };
  }, [cover, container]);

  if (!target) return null;
  return createPortal(
    <div className="focus-panels-inner">
      {(ids || []).map((id) => renderWidget(id, ctx))}
    </div>,
    target,
  );
}
