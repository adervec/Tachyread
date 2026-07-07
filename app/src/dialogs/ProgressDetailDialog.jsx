import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getTocEntries, sectionSpan } from '../document/toc.js';
import { loadFile, loadReadState, saveReadState, getReadSections } from '../state/storage.js';
import { createReadingTracker } from '../engine/readingTracker.js';
import { sectionChecksum } from '../document/sectionHash.js';

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

// Works from a LIVE tab (tab prop) or from STORED reading state (storedChecksum prop) — the latter
// rebuilds a tracker from the synced files/readstate records, so Trackyread can show a bound book's
// progress even when the file itself was never opened on this device.
export default function ProgressDetailDialog({ tab, storedChecksum, onJumpWord, onClose }) {
  const [storedTab, setStoredTab] = useState(null);
  useEffect(() => {
    if (!storedChecksum) return undefined;
    let alive = true;
    (async () => {
      const [fsRec, rs] = await Promise.all([loadFile(storedChecksum).catch(() => null), loadReadState(storedChecksum).catch(() => null)]);
      if (!alive) return;
      const wordCount = fsRec?.totalWords || 0;
      if (!wordCount) { setStoredTab({ missing: true }); return; }
      const tracker = createReadingTracker({
        wordCount, maskB64: rs?.maskB64 || '', wpmB64: rs?.wpmB64 || '',
        lifetimeActiveMs: rs?.lifetimeActiveMs || 0, daily: rs?.daily || [], paraTsB64: rs?.paraTsB64 || '',
      });
      setStoredTab({ doc: { words: { length: wordCount } }, settings: fsRec, tracker });
    })();
    return () => { alive = false; };
  }, [storedChecksum]);

  const t = storedChecksum ? (storedTab && !storedTab.missing ? storedTab : null) : tab;
  const tracker = t?.tracker;
  const doc = t?.doc;
  const total = doc?.words.length || 0;
  const idx = t?.settings?.wordIndex || 0;
  const skipRanges = t?.settings?.skipRanges || [];
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null); // { col, px }
  const [pendingJump, setPendingJump] = useState(null); // { wi, label } — jumps need a confirm click
  const [selSecs, setSelSecs] = useState(() => new Set()); // section indices staged for mark-unread
  const [unreadArm, setUnreadArm] = useState(false);
  // "Read elsewhere" scan (successive editions): matched section indices → the prior read's meta.
  const [scanMatches, setScanMatches] = useState(null); // null = not scanned; Map(index → meta)
  const [readSel, setReadSel] = useState(() => new Set());
  const [readArm, setReadArm] = useState(false);
  const scanAvailable = !storedChecksum && Array.isArray(t?.doc?.words); // needs the real word list

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

  // Stored mode has no parsed doc, so only explicitly saved ToC entries are available (no auto-detect).
  const entries = useMemo(
    () => (storedChecksum ? (t?.settings?.tocEntries || []) : (tab ? getTocEntries(tab) : [])),
    [tab, t, storedChecksum, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  // Clicks STAGE a jump; a visible confirm button executes it (too easy to fat-finger otherwise).
  function onClick(e) {
    if (!onJumpWord) return; // stored mode: the file isn't open here — nothing to jump in
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !total) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const wi = Math.round(frac * (total - 1));
    setPendingJump({ wi, label: `${((wi / total) * 100).toFixed(1)}% · word ${(wi + 1).toLocaleString()}` });
  }
  const stageJump = (wi, label) => { if (onJumpWord) setPendingJump({ wi, label }); };

  // Mark the selected sections unread (confirmation-guarded) — for text that got "read" by
  // unattended playback. Live tabs persist via the app's readstate flush (the tracker is dirty);
  // stored mode writes the readstate back directly.
  const selWords = [...selSecs].reduce((n, i) => n + (sections[i]?.readWords || 0), 0);
  async function markSelectedUnread() {
    if (!tracker) return;
    for (const i of selSecs) { const s = sections[i]; if (s) tracker.unmarkRangeRead(s.start, s.end); }
    if (storedChecksum) {
      await saveReadState(storedChecksum, {
        maskB64: tracker.serializeMask(), wpmB64: tracker.serializeWpm(),
        lifetimeActiveMs: tracker.lifetimeActiveMs, daily: tracker.dailyArray(), paraTsB64: tracker.serializeParaTs(),
      }).catch(() => {});
    }
    setSelSecs(new Set()); setUnreadArm(false); setTick((n) => n + 1);
  }

  // Scan this file's sections against the registry of sections finished in ANY file — so a successive
  // edition (different file checksum, same prose) recognizes chapters you've already read. Matches are
  // pre-selected; you choose the subset to mark read here.
  const readWordsToAdd = [...readSel].reduce((n, i) => n + Math.max(0, (sections[i]?.total || 0) - (sections[i]?.readWords || 0)), 0);
  async function scan() {
    const words = t?.doc?.words;
    if (!Array.isArray(words)) { setScanMatches(new Map()); return; }
    const reg = await getReadSections().catch(() => ({}));
    const found = new Map();
    const sel = new Set();
    sections.forEach((s, i) => {
      if (s.readFrac >= 0.999) return; // already fully read here — nothing to do
      const hash = sectionChecksum(words, s.start, s.end);
      if (hash && reg[hash]) { found.set(i, reg[hash]); sel.add(i); }
    });
    setScanMatches(found); setReadSel(sel); setReadArm(false);
  }
  async function markSelectedRead() {
    if (!tracker) return;
    for (const i of readSel) { const s = sections[i]; if (s) tracker.markRangeRead(s.start, s.end); }
    // Live tab: the tracker is now dirty and the app flushes readstate periodically (same as unread).
    setReadSel(new Set()); setScanMatches(null); setReadArm(false); setTick((n) => n + 1);
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
        <p className="settings-note">
          {storedChecksum
            ? (storedTab ? 'No synced reading data for this file on this device yet — read it somewhere, sync, and it will appear here.' : 'Loading stored reading data…')
            : 'No reading data yet — open a document and start reading.'}
        </p>
      ) : (
        <>
          {pendingJump && (
            <div className="pd-confirm">
              Jump to <b>{pendingJump.label}</b>?
              <button className="toggle-on" onClick={() => { onJumpWord?.(pendingJump.wi); onClose?.(); }}>▶ Jump</button>
              <button onClick={() => setPendingJump(null)}>Cancel</button>
            </div>
          )}
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

          <div className="field-section">Annotated progress · height &amp; colour = pace · click to jump (asks to confirm)</div>
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
              <div className="field-section">By section — where, how much, how fast · tick sections to mark them unread</div>
              <div className="pd-sections">
                {sections.map((s, i) => (
                  <div key={i} className={`pd-sec-row${selSecs.has(i) ? ' pd-sec-sel' : ''}`} style={{ paddingLeft: 8 + (s.level || 0) * 14 }}
                    title={onJumpWord ? 'Click to jump to this section (asks to confirm)' : s.title}
                    onClick={() => stageJump(s.start, s.title)}>
                    <input
                      type="checkbox"
                      className="pd-sec-check"
                      checked={selSecs.has(i)}
                      disabled={!s.readWords}
                      title="Select this section to mark it unread"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); setSelSecs((prev) => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; }); setUnreadArm(false); }}
                    />
                    <span className="pd-sec-title">{s.title}</span>
                    <span className="pd-sec-bar"><i style={{ width: `${Math.round(s.readFrac * 100)}%` }} /></span>
                    <span className="pd-sec-pct">{Math.round(s.readFrac * 100)}%</span>
                    <span className="pd-sec-wpm">{s.wpm ? `${s.wpm} wpm` : '—'}</span>
                    <span className="pd-sec-words">{s.readWords}/{s.total}</span>
                  </div>
                ))}
              </div>
              {selSecs.size > 0 && (
                <div className="pd-unread-bar">
                  {!unreadArm ? (
                    <button onClick={() => setUnreadArm(true)}>↩ Mark {selSecs.size} section{selSecs.size === 1 ? '' : 's'} unread…</button>
                  ) : (
                    <>
                      <button className="grab-trash" onClick={markSelectedUnread}>⚠ Confirm — clear {selWords.toLocaleString()} read word{selWords === 1 ? '' : 's'}</button>
                      <button onClick={() => setUnreadArm(false)}>Cancel</button>
                    </>
                  )}
                  <span className="settings-note" style={{ margin: 0 }}>For text accidentally “read” by unattended playback. Coverage drops; recorded time is kept.</span>
                </div>
              )}

              {/* Scan for sections read in another file/edition, and mark a chosen subset read here. */}
              {scanAvailable && (
                <div className="pd-scan">
                  {scanMatches === null ? (
                    <button onClick={scan} title="Compare each section's content to sections you've finished in other files — useful for a new edition of a book you've already read">🔎 Scan for sections already read elsewhere</button>
                  ) : scanMatches.size === 0 ? (
                    <>
                      <span className="settings-note" style={{ margin: 0 }}>No unread sections here match content you’ve finished in another file.</span>
                      <button onClick={() => setScanMatches(null)}>Done</button>
                    </>
                  ) : (
                    <>
                      <div className="field-section" style={{ marginTop: 0 }}>Read elsewhere ({scanMatches.size}) — tick to mark as read here</div>
                      {[...scanMatches.entries()].map(([i, m]) => (
                        <label key={i} className="pd-scan-row">
                          <input type="checkbox" checked={readSel.has(i)} onChange={(e) => setReadSel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                          <span className="pd-scan-title">{sections[i].title}</span>
                          <span className="settings-note" style={{ margin: 0 }}>{sections[i].readWords}/{sections[i].total} here · read {m.file ? `in “${m.file}”` : 'earlier'}{m.at ? ` · ${new Date(m.at).toLocaleDateString()}` : ''}</span>
                        </label>
                      ))}
                      <div className="pd-unread-bar">
                        {!readArm ? (
                          <button className="toggle-on" disabled={!readSel.size} onClick={() => setReadArm(true)}>✓ Mark {readSel.size} as read here…</button>
                        ) : (
                          <>
                            <button className="grab-trash" onClick={markSelectedRead}>⚠ Confirm — mark {readWordsToAdd.toLocaleString()} word{readWordsToAdd === 1 ? '' : 's'} read</button>
                            <button onClick={() => setReadArm(false)}>Cancel</button>
                          </>
                        )}
                        <button onClick={() => { setScanMatches(null); setReadSel(new Set()); setReadArm(false); }}>Cancel scan</button>
                        <span className="settings-note" style={{ margin: 0 }}>Content-matched to sections finished in other files. Coverage rises; use for a successive edition.</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="field-section">Reading sessions — when &amp; where (by paragraph)</div>
          {sessions.length === 0 ? (
            <p className="settings-note">No sessions recorded yet — keep reading and they'll appear here, tracked at paragraph resolution.</p>
          ) : (
            <div className="pd-days">
              {sessions.map((s, i) => (
                <div key={i} className="pd-day-row pd-sess-row" title={onJumpWord ? 'Click to jump to where this session started (asks to confirm)' : ''}
                  onClick={() => stageJump(s.minW, `session start (${fmtWhen(s.startTs)})`)}>
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
