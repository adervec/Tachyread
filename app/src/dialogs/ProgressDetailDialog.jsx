import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getTocEntries, sectionSpan } from '../document/toc.js';

// Detailed annotated progress popup. Pulls everything the reading tracker knows into one view:
//   • WHAT was read   — the coverage strip (read this session / earlier / unread / excluded).
//   • HOW it was read — session vs prior colouring, regression (re-read) ticks, pace steadiness.
//   • HOW FAST        — the pace mountain: bar height AND heat colour = recorded WPM per slice.
//   • WHERE           — hover/section table: word range, %-through, line, and TOC section.
//   • WHEN            — the daily history (per-word timestamps aren't stored, only per-day totals).
// Click anywhere on the bar (or a section row) to jump there and close.

const COLS = 320;

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtWhen(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Reading-pace heat: slow = blue, through green/yellow, fast = red.
function paceColor(wpm, maxWpm) {
  const t = Math.max(0, Math.min(1, maxWpm > 0 ? wpm / maxWpm : 0));
  return `hsl(${(220 - 220 * t).toFixed(0)} 72% 52%)`;
}

function steadiness(cv) {
  if (cv <= 0) return '—';
  if (cv < 0.4) return 'steady';
  if (cv < 0.8) return 'variable';
  return 'erratic';
}

export default function ProgressDetailDialog({ tab, onJumpWord, onClose }) {
  const tracker = tab?.tracker;
  const doc = tab?.doc;
  const total = doc?.words.length || 0;
  const idx = tab?.settings.wordIndex || 0;
  const skipRanges = tab?.settings.skipRanges || [];
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // { col, px }

  // Refresh live so the view tracks reading while it's open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cols = useMemo(() => (tracker ? tracker.sampleTrend(COLS) : []), [tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxWpm = useMemo(() => Math.max(300, ...cols.map((c) => c.wpm)), [cols]);

  const reg = tracker ? tracker.regressionStats() : { count: 0, short: 0, long: 0, ratePer100: 0, recent: [] };
  const cv = tracker ? tracker.recentPaceCv() : 0;
  const coverage = tracker ? tracker.coverageExcluding(skipRanges) : 0;
  const sessionWpm = tracker ? tracker.sessionWpm() : 0;
  const lifetimeWpm = tracker ? tracker.lifetimeWpm() : 0;
  const recentWpm = tracker ? tracker.recentWpm() : 0;
  const readCount = tracker ? tracker.readCount : 0;
  const sessionActiveMs = tracker ? tracker.sessionActiveMs : 0;
  const lifetimeActiveMs = tracker ? tracker.lifetimeActiveMs : 0;

  const entries = useMemo(() => (tab ? getTocEntries(tab) : []), [tab, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => {
    if (!entries.length || !tracker) return [];
    return entries.map((e, i) => {
      const { start, end } = sectionSpan(entries, i, total);
      return { title: e.title, level: e.level || 0, start, end, ...tracker.rangeStats(start, end) };
    });
  }, [entries, total, tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const daily = useMemo(() => {
    if (!tracker) return [];
    return tracker.dailyArray().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reading sessions from the paragraph-resolution timeline: group first-read paragraph stamps,
  // starting a new session after a >25-minute lull. Each session = when (start→end) and where
  // (position range) you read. Newest first.
  const sessions = useMemo(() => {
    const tl = tracker ? tracker.paraTimeline() : [];
    tl.sort((a, b) => a.ts - b.ts);
    const GAP = 25 * 60 * 1000;
    const out = [];
    for (const e of tl) {
      const last = out[out.length - 1];
      if (last && e.ts - last.endTs <= GAP) {
        last.endTs = e.ts; last.paras += 1;
        last.minW = Math.min(last.minW, e.startWord); last.maxW = Math.max(last.maxW, e.startWord);
      } else {
        out.push({ startTs: e.ts, endTs: e.ts, paras: 1, minW: e.startWord, maxW: e.startWord });
      }
    }
    return out.reverse();
  }, [tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxDayWords = Math.max(1, ...daily.map((d) => d.words));

  // ── geometry (viewBox units; the SVG stretches to the container width) ──
  const W = 1000, H = 140;
  const top = 16, bottom = 104, chartH = bottom - top;
  const colW = W / COLS;
  const posX = total ? (idx / total) * W : 0;
  const y = (wpm) => bottom - (Math.min(wpm, maxWpm) / maxWpm) * chartH;
  const skipRects = total
    ? skipRanges.map((r) => ({ x: (r.start / total) * W, w: ((Math.max(r.start, r.end) - r.start) / total) * W }))
    : [];

  // Per-column word range → used for the hover tooltip / coverage colour.
  const colRange = (c) => [Math.floor((c * total) / COLS), Math.max(Math.floor((c * total) / COLS) + 1, Math.floor(((c + 1) * total) / COLS))];
  function coverClass(c) {
    const col = cols[c];
    if (!col) return 'pd-cv-unread';
    const [a, b] = colRange(c);
    const excluded = skipRanges.some((r) => a < Math.max(r.start, r.end) && b > r.start);
    if (excluded) return 'pd-cv-skip';
    if (col.readFrac <= 0.05) return 'pd-cv-unread';
    return col.sessionFrac > 0.05 ? 'pd-cv-session' : 'pd-cv-history';
  }

  function sectionAt(wi) {
    for (let i = sections.length - 1; i >= 0; i--) if (wi >= sections[i].start) return sections[i];
    return null;
  }

  function onMove(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(0.9999, px / rect.width));
    // tipX: keep the tooltip from spilling past either edge (clamp here so render reads no ref).
    setHover({ col: Math.floor(frac * COLS), px, tipX: Math.min(Math.max(px, 90), rect.width - 90) });
  }
  function onClick(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !total) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onJumpWord?.(Math.round(frac * (total - 1)));
    onClose?.();
  }

  // Hover tooltip content.
  let tip = null;
  if (hover && total && tracker) {
    const [a, b] = colRange(hover.col);
    const rs = tracker.rangeStats(a, b);
    const li = (doc.wordToLine?.[a] || 0) + 1;
    const sec = sectionAt(a);
    const pct = ((a / total) * 100).toFixed(1);
    const state = coverClass(hover.col);
    const stateLabel = { 'pd-cv-session': 'read this session', 'pd-cv-history': 'read earlier', 'pd-cv-unread': 'not read', 'pd-cv-skip': 'excluded (won’t count)' }[state];
    tip = { a, b, li, sec, pct, rs, stateLabel };
  }

  const card = (num, label, title) => (
    <div className="pd-card" title={title}>
      <span className="pd-card-num">{num}</span>
      <span className="pd-card-label">{label}</span>
    </div>
  );

  return (
    <Dialog title="Progress Detail" onClose={onClose} width={960} buttons={<button onClick={onClose}>Close</button>}>
      {!tracker || !total ? (
        <p className="settings-note">No reading data yet — open a document and start reading.</p>
      ) : (
        <>
          <div className="pd-cards">
            {card(`${(coverage * 100).toFixed(1)}%`, 'book read', 'Coverage (flagged front/back matter excluded)')}
            {card(readCount.toLocaleString(), `of ${total.toLocaleString()} words`, 'Unique words marked read across all sessions')}
            {card(recentWpm || '—', 'reading now (wpm)', 'Eyes pace over the last 30s')}
            {card(sessionWpm || '—', 'session wpm', 'New words read per active minute this session')}
            {card(lifetimeWpm || '—', 'lifetime wpm', 'New words read per active minute, all sessions')}
            {card(fmtDuration(sessionActiveMs), 'active this session', `Lifetime active: ${fmtDuration(lifetimeActiveMs)}`)}
            {card(reg.count, `regressions · ${reg.ratePer100.toFixed(1)}/100`, 'Backward re-reads this session')}
            {card(steadiness(cv), 'pace', `Pace variability (CV ${cv.toFixed(2)}) — lower is steadier`)}
          </div>

          <div className="field-section">Annotated progress · height &amp; colour = pace · click to jump</div>
          <div className="pd-bar-wrap" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}>
            <svg className="pd-bar" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {/* excluded bands */}
              {skipRects.map((r, i) => <rect key={`sk${i}`} x={r.x} y={top} width={r.w} height={bottom - top} className="pd-skipband" />)}
              {/* pace mountain — height + heat colour by recorded wpm */}
              {cols.map((col, c) => {
                if (col.readFrac <= 0.05) return null;
                const x = c * colW;
                return <rect key={c} x={x} y={y(col.wpm)} width={colW + 0.5} height={bottom - y(col.wpm)}
                  fill={paceColor(col.wpm, maxWpm)} opacity={col.sessionFrac > 0.05 ? 1 : 0.45} />;
              })}
              {/* baseline */}
              <line x1="0" y1={bottom} x2={W} y2={bottom} className="pd-base" />
              {/* coverage strip: what / how it was read */}
              {cols.map((col, c) => <rect key={`cv${c}`} x={c * colW} y={bottom + 4} width={colW + 0.5} height={12} className={coverClass(c)} />)}
              {/* regression ticks */}
              {reg.recent.map((r, i) => total ? <line key={`rg${i}`} x1={(r.at / total) * W} y1="0" x2={(r.at / total) * W} y2="10" className="pd-reg-tick" /> : null)}
              {/* current position */}
              <line x1={posX} y1="11" x2={posX} y2={bottom + 18} className="pd-pos" />
            </svg>
            {hover && <div className="pd-cursor" style={{ left: hover.px }} />}
            {tip && (
              <div className="pd-tip" style={{ left: hover.tipX }}>
                <div className="pd-tip-row"><b>{tip.pct}%</b> · words {tip.a + 1}–{tip.b} · line {tip.li}</div>
                {tip.sec && <div className="pd-tip-sec">§ {tip.sec.title}</div>}
                <div className="pd-tip-row">{tip.stateLabel}{tip.rs.readFrac > 0.05 ? ` · ${Math.round(tip.rs.readFrac * 100)}% read` : ''}</div>
                <div className="pd-tip-row">{tip.rs.wpm ? `${tip.rs.wpm} wpm` : 'no recorded pace'}</div>
              </div>
            )}
          </div>

          <div className="pd-legend">
            <span><i className="pd-sw pd-cv-session" /> read this session</span>
            <span><i className="pd-sw pd-cv-history" /> read earlier</span>
            <span><i className="pd-sw pd-cv-unread" /> unread</span>
            <span><i className="pd-sw pd-cv-skip" /> excluded</span>
            <span><i className="pd-sw pd-reg-sw" /> re-read</span>
            <span className="pd-heat">slow <i className="pd-heatbar" /> fast</span>
          </div>

          {sections.length > 0 && (
            <>
              <div className="field-section">By section — where, how much, how fast</div>
              <div className="pd-sections">
                {sections.map((s, i) => (
                  <div key={i} className="pd-sec-row" style={{ paddingLeft: 8 + (s.level || 0) * 14 }}
                    title="Jump to this section" onClick={() => { onJumpWord?.(s.start); onClose?.(); }}>
                    <span className="pd-sec-title">{s.title}</span>
                    <span className="pd-sec-bar"><i style={{ width: `${Math.round(s.readFrac * 100)}%` }} /></span>
                    <span className="pd-sec-pct">{Math.round(s.readFrac * 100)}%</span>
                    <span className="pd-sec-wpm">{s.wpm ? `${s.wpm} wpm` : '—'}</span>
                    <span className="pd-sec-words">{s.readWords}/{s.total}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="field-section">Reading sessions — when &amp; where (by paragraph)</div>
          {sessions.length === 0 ? (
            <p className="settings-note">No sessions recorded yet — keep reading and they'll appear here, tracked at paragraph resolution.</p>
          ) : (
            <div className="pd-days">
              {sessions.map((s, i) => (
                <div key={i} className="pd-day-row pd-sess-row" title="Jump to where this session started"
                  onClick={() => { onJumpWord?.(s.minW); onClose?.(); }}>
                  <span className="pd-day-date">{fmtWhen(s.startTs)}</span>
                  <span className="pd-sess-range">{((s.minW / total) * 100).toFixed(0)}–{((s.maxW / total) * 100).toFixed(0)}%</span>
                  <span className="pd-sess-paras">{s.paras} ¶</span>
                  <span className="pd-day-time">{fmtDuration(s.endTs - s.startTs)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="field-section">When you read — daily totals</div>
          {daily.length === 0 ? (
            <p className="settings-note">No daily history recorded yet.</p>
          ) : (
            <div className="pd-days">
              {daily.map((d) => (
                <div key={d.date} className="pd-day-row">
                  <span className="pd-day-date">{d.date}</span>
                  <span className="pd-day-bar"><i style={{ width: `${Math.round((d.words / maxDayWords) * 100)}%` }} /></span>
                  <span className="pd-day-words">{d.words.toLocaleString()} words</span>
                  <span className="pd-day-time">{fmtDuration(d.ms)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
