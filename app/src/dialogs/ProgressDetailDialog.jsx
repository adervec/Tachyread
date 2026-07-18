import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { fmtDate, fmtDateTime } from '../features/dateFmt.js';
import { getTocEntries, sectionSpan, mergeSkipRanges, removeSkipRange } from '../document/toc.js';
import { loadFile, loadReadState, saveReadState, saveFile, getReadSections, loadDocPayload, allFiles } from '../state/storage.js';
import { createReadingTracker, READ_SRC_INFO } from '../engine/readingTracker.js';
import { sectionChecksum } from '../document/sectionHash.js';
import { readerDocFromText } from '../document/readerDocument.js';
import { textSignature, signatureSimilarity, similarityTier } from '../features/textSimilarity.js';

// Detailed annotated progress popup. Pulls everything the reading tracker knows into one view:
//   • WHAT was read   — the coverage strip (read this session / earlier / unread / excluded).
//   • HOW it was read — session vs prior colouring, regression (re-read) ticks, pace steadiness.
//   • HOW FAST        — the pace mountain: bar height AND heat colour = recorded WPM per slice.
//   • WHERE           — hover/section table: word range, %-through, line, and TOC section.
//   • WHEN            — the daily history (per-word timestamps aren't stored, only per-day totals).
// Click anywhere on the bar (or a section row) to jump there and close.

const COLS = 320;

// Typical paces for crediting the unread remainder of a section you finished elsewhere. Audiobook
// narration runs ~155 wpm at 1×; the multiples scale from that. Silent-reading figures are the usual
// adult ranges. (Rough by nature — the point is a believable time credit, not a precise measurement.)
const PACE_PRESETS = [
  { label: 'Average reading', wpm: 250 },
  { label: 'Careful reading', wpm: 180 },
  { label: 'Fast reading', wpm: 400 },
  { label: 'Audiobook 1×', wpm: 155 },
  { label: 'Audiobook 1.2×', wpm: 185 },
  { label: 'Audiobook 1.5×', wpm: 230 },
  { label: 'Audiobook 2×', wpm: 310 },
];

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
  return fmtDateTime(ts);
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
export default function ProgressDetailDialog({ tab, storedChecksum, onJumpWord, onPatchSettings, onClose }) {
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
        wordCount, maskB64: rs?.maskB64 || '', wpmB64: rs?.wpmB64 || '', srcB64: rs?.srcB64 || '',
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
  const [selSecs, setSelSecs] = useState(() => new Set()); // section indices selected for a batch action
  const [unreadArm, setUnreadArm] = useState(false);
  const [paceSel, setPaceSel] = useState('250');    // read-remainder pace: a preset wpm or 'custom'
  const [customWpm, setCustomWpm] = useState('250');
  // "Read elsewhere" scan (successive editions): matched section indices → the prior read's meta.
  const [scanMatches, setScanMatches] = useState(null); // null = not scanned; Map(index → meta)
  const [readSel, setReadSel] = useState(() => new Set());
  const [readArm, setReadArm] = useState(false);
  const scanAvailable = !storedChecksum && Array.isArray(t?.doc?.words); // needs the real word list
  // Detailed file-vs-file overlap (requires the OTHER file's stored text): section-level compare + a
  // word-accurate read-state carry-over.
  const [fileList, setFileList] = useState([]);
  const [cmp, setCmp] = useState(null); // { pairs, file } | { error } while comparing
  const [cmpBusy, setCmpBusy] = useState(false);
  const [carrySel, setCarrySel] = useState(() => new Set());
  const [carryArm, setCarryArm] = useState(false);
  const curChecksum = t?.doc?.contentChecksum;
  useEffect(() => {
    if (!scanAvailable) return;
    allFiles().then((fs) => setFileList(
      fs.filter((f) => (f.checksum || f.contentChecksum) !== curChecksum && (f.totalWords || 0) > 0 && (f.persistentWordsRead || 0) > 0)
        .sort((a, b) => (b.dailyHistory?.length || 0) - (a.dailyHistory?.length || 0)),
    )).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanAvailable, curChecksum]);

  // Refresh live so the view tracks reading while it's open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cols = useMemo(() => (tracker ? tracker.sampleTrend(COLS) : []), [tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcCols = useMemo(() => (tracker ? tracker.sampleSrc(COLS) : []), [tracker, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcUsed = useMemo(() => [...new Set(srcCols.filter(Boolean))], [srcCols]);
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
  const W = 1000, H = 152; // extra rows: coverage strip + the read-mode strip under it
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
  // Words a "mark read" would newly credit across the selection (its unread remainder).
  const remainderWords = [...selSecs].reduce((n, i) => n + Math.max(0, (sections[i]?.total || 0) - (sections[i]?.readWords || 0)), 0);
  const effWpm = paceSel === 'custom' ? Math.max(1, Math.round(Number(customWpm) || 0)) : Number(paceSel);

  // Stored mode has no live tab to flush it, so read-state changes are written straight to the
  // readstate store here, plus the file-record aggregates the History / Trackyread views read.
  async function persistStored() {
    if (!storedChecksum || !tracker) return;
    await saveReadState(storedChecksum, {
      maskB64: tracker.serializeMask(), wpmB64: tracker.serializeWpm(), srcB64: tracker.serializeSrc(),
      lifetimeActiveMs: tracker.lifetimeActiveMs, daily: tracker.dailyArray(), paraTsB64: tracker.serializeParaTs(),
    }).catch(() => {});
    const dailyHistory = tracker.dailyArray().map((d) => ({ date: d.date, wordsRead: d.words, activeTimeSecs: Math.round(d.ms / 1000) }));
    await saveFile({
      ...(storedTab?.settings || {}), contentChecksum: storedChecksum,
      persistentWordsRead: tracker.readCount, persistentActiveTimeSecs: Math.round(tracker.lifetimeActiveMs / 1000), dailyHistory,
    }).catch(() => {});
  }

  async function markSelectedUnread() {
    if (!tracker) return;
    for (const i of selSecs) { const s = sections[i]; if (s) tracker.unmarkRangeRead(s.start, s.end); }
    if (storedChecksum) await persistStored();
    setSelSecs(new Set()); setUnreadArm(false); setTick((n) => n + 1);
  }

  // Credit the unread remainder of each selected section as read at the chosen pace (audiobook/reading
  // speed). Live tabs persist via the app's periodic readstate flush (the tracker is now dirty).
  async function markSelectedReadAtPace() {
    if (!tracker || !effWpm) return;
    for (const i of selSecs) { const s = sections[i]; if (s) tracker.markRangeReadAtPace(s.start, s.end, effWpm); }
    if (storedChecksum) await persistStored();
    setSelSecs(new Set()); setUnreadArm(false); setTick((n) => n + 1);
  }

  // Persist a new skip-range list: live tabs patch tab settings; stored mode writes the file record.
  async function persistSkip(ranges) {
    if (storedChecksum) {
      setStoredTab((st) => (st ? { ...st, settings: { ...st.settings, skipRanges: ranges } } : st));
      await saveFile({ ...(storedTab?.settings || {}), contentChecksum: storedChecksum, skipRanges: ranges }).catch(() => {});
    } else {
      onPatchSettings?.({ skipRanges: ranges });
    }
  }
  async function toggleSkipSelected(on) {
    let ranges = skipRanges;
    for (const i of selSecs) {
      const s = sections[i]; if (!s) continue;
      ranges = on ? mergeSkipRanges(ranges, [{ start: s.start, end: s.end, label: s.title }]) : removeSkipRange(ranges, s.start, s.end);
    }
    await persistSkip(ranges);
    setSelSecs(new Set()); setUnreadArm(false);
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

  // Fuzzy "have I read something LIKE this before?" — sketch this file's shingles, then score every
  // previously-read file's stored text against it. Survives edition differences and re-chunked
  // chapters (unlike the exact section hashes). Matches offer the detailed section compare below.
  const [simBusy, setSimBusy] = useState(false);
  const [simRes, setSimRes] = useState(null); // null | { rows, scanned, skipped } | { error }
  async function scanSimilar() {
    setSimBusy(true); setSimRes(null);
    try {
      const mySig = textSignature(t.doc.words);
      if (!mySig.length) { setSimRes({ error: 'This document is too short to fingerprint.' }); setSimBusy(false); return; }
      const rows = [];
      let scanned = 0;
      let skipped = 0;
      for (const f of fileList) {
        const cs = f.checksum || f.contentChecksum;
        const payload = await loadDocPayload(cs).catch(() => null);
        const text = payload?.fullText;
        if (!text) { skipped++; continue; } // text not stored on this device — reopen it once to include it
        scanned++;
        const sim = signatureSimilarity(mySig, textSignature(text.split(/\s+/)));
        if (sim >= 0.12) {
          rows.push({
            checksum: cs,
            fileName: f.fileName || cs.slice(0, 8),
            sim,
            readPct: f.totalWords ? Math.round(((f.persistentWordsRead || 0) / f.totalWords) * 100) : 0,
          });
        }
      }
      rows.sort((a, b) => b.sim - a.sim);
      setSimRes({ rows, scanned, skipped });
    } catch (e) { setSimRes({ error: 'Similarity scan failed: ' + (e?.message || e) }); }
    setSimBusy(false);
  }

  // Compare THIS file section-by-section with a previously-read one — loading the other file's stored
  // text so it works even for sections neither file finished. Matched sections (identical content) show
  // how much was read in the other file, and their per-word read state can be carried over exactly.
  async function compareWith(checksum) {
    setCmp(null); setCarrySel(new Set()); setCarryArm(false);
    if (!checksum) return;
    setCmpBusy(true);
    try {
      const [payload, fsRec, rs] = await Promise.all([loadDocPayload(checksum), loadFile(checksum), loadReadState(checksum)]);
      const fullText = payload?.fullText;
      const oldEntries = fsRec?.tocEntries || [];
      if (!fullText) { setCmp({ error: 'That file’s text isn’t stored here anymore — reopen it once, then compare.' }); return; }
      if (!oldEntries.length) { setCmp({ error: 'That file has no Table of Contents to compare sections against.' }); return; }
      const oldDoc = readerDocFromText(fullText, fsRec.fileName || '');
      const oldWords = oldDoc.words;
      const oldTotal = oldWords.length;
      const oldTracker = createReadingTracker({ wordCount: oldTotal, maskB64: rs?.maskB64 || '', wpmB64: rs?.wpmB64 || '', lifetimeActiveMs: rs?.lifetimeActiveMs || 0, daily: rs?.daily || [], paraTsB64: rs?.paraTsB64 || '' });
      const oldByHash = new Map();
      oldEntries.forEach((e, i) => {
        const span = sectionSpan(oldEntries, i, oldTotal);
        const hash = sectionChecksum(oldWords, span.start, span.end);
        if (!hash || oldByHash.has(hash)) return;
        const st = oldTracker.rangeStats(span.start, span.end);
        oldByHash.set(hash, { title: e.title, start: span.start, end: span.end, readFrac: st.readFrac, runs: oldTracker.readRuns(span.start, span.end) });
      });
      const words = t.doc.words;
      const pairs = [];
      sections.forEach((s, idx) => {
        const hash = sectionChecksum(words, s.start, s.end);
        if (!hash) return;
        const old = oldByHash.get(hash);
        if (old && old.readFrac > s.readFrac + 0.01) pairs.push({ idx, title: s.title, curFrac: s.readFrac, oldFrac: old.readFrac, old, cur: s });
      });
      setCmp({ pairs, file: fsRec.fileName || 'that file' });
      setCarrySel(new Set(pairs.map((p) => p.idx)));
    } catch (e) { setCmp({ error: 'Compare failed: ' + (e?.message || e) }); }
    setCmpBusy(false);
  }
  const carryWords = (cmp?.pairs || []).filter((p) => carrySel.has(p.idx)).reduce((n, p) => {
    const gained = p.old.runs.reduce((m, [rs, re]) => m + Math.min(p.cur.end, p.cur.start + (rs - p.old.start) + (re - rs)) - Math.max(p.cur.start, p.cur.start + (rs - p.old.start)), 0);
    return n + Math.max(0, gained);
  }, 0);
  function carryOver() {
    if (!tracker || !cmp?.pairs) return;
    for (const p of cmp.pairs) {
      if (!carrySel.has(p.idx)) continue;
      for (const [rs, re] of p.old.runs) {
        const start = p.cur.start + (rs - p.old.start);
        const end = Math.min(p.cur.end, start + (re - rs));
        if (end > start) tracker.markRangeRead(start, end);
      }
    }
    setCmp(null); setCarrySel(new Set()); setCarryArm(false); setTick((n) => n + 1);
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

  // Fraction of a section's words currently inside a skip range (≥0.5 ⇒ shown/treated as "skipped").
  const secSkipFrac = (s) => {
    const n = s.end - s.start;
    if (n <= 0) return 0;
    let cov = 0;
    for (const r of skipRanges) { const a = Math.max(s.start, r.start), b = Math.min(s.end, Math.max(r.start, r.end)); if (b > a) cov += b - a; }
    return cov / n;
  };
  const allSelSkipped = selSecs.size > 0 && [...selSecs].every((i) => sections[i] && secSkipFrac(sections[i]) >= 0.5);

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
              {/* read-mode strip: HOW each slice was first read (auto/line/scroll/typing/…) */}
              {srcCols.map((code, c) => (code
                ? <rect key={`sr${c}`} x={c * colW} y={bottom + 18} width={colW + 0.5} height={7} fill={READ_SRC_INFO[code]?.color || 'transparent'} />
                : null))}
              {/* regression ticks */}
              {reg.recent.map((r, i) => total ? <line key={`rg${i}`} x1={(r.at / total) * W} y1="0" x2={(r.at / total) * W} y2="10" className="pd-reg-tick" /> : null)}
              {/* current position */}
              <line x1={posX} y1="11" x2={posX} y2={bottom + 27} className="pd-pos" />
            </svg>
            {hover && <div className="pd-cursor" style={{ left: hover.px }} />}
            {tip && (
              <div className="pd-tip" style={{ left: hover.tipX }}>
                <div className="pd-tip-row"><b>{tip.pct}%</b> · words {tip.a + 1}–{tip.b} · line {tip.li}</div>
                {tip.sec && <div className="pd-tip-sec">§ {tip.sec.title}</div>}
                <div className="pd-tip-row">{tip.stateLabel}{tip.rs.readFrac > 0.05 ? ` · ${Math.round(tip.rs.readFrac * 100)}% read` : ''}</div>
                <div className="pd-tip-row">{tip.rs.wpm ? `${tip.rs.wpm} wpm` : 'no recorded pace'}{srcCols[hover.col] ? ` · read by ${READ_SRC_INFO[srcCols[hover.col]]?.label}` : ''}</div>
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
          {srcUsed.length > 0 && (
            <div className="pd-legend pd-src-legend" title="The lower strip on the bar: how each part was first read">
              <span className="pd-src-label">How it was read:</span>
              {srcUsed.map((code) => (
                <span key={code}><i className="pd-sw" style={{ background: READ_SRC_INFO[code]?.color }} /> {READ_SRC_INFO[code]?.label}</span>
              ))}
            </div>
          )}

          {sections.length > 0 && (
            <>
              <div className="field-section">By section — where, how much, how fast · tick sections, then mark read / skipped / unread below</div>
              <div className="pd-sections">
                {sections.map((s, i) => {
                  const skipped = secSkipFrac(s) >= 0.5;
                  return (
                    <div key={i} className={`pd-sec-row${selSecs.has(i) ? ' pd-sec-sel' : ''}${skipped ? ' pd-sec-skipped' : ''}`} style={{ paddingLeft: 8 + (s.level || 0) * 14 }}
                      title={onJumpWord ? 'Click to jump to this section (asks to confirm)' : s.title}
                      onClick={() => stageJump(s.start, s.title)}>
                      <input
                        type="checkbox"
                        className="pd-sec-check"
                        checked={selSecs.has(i)}
                        title="Select this section for a batch action below"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); setSelSecs((prev) => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; }); setUnreadArm(false); }}
                      />
                      <span className="pd-sec-title">{skipped && <span className="pd-sec-skipmark" title="Excluded from % read">⏭ </span>}{s.title}</span>
                      <span className="pd-sec-bar"><i style={{ width: `${Math.round(s.readFrac * 100)}%` }} /></span>
                      <span className="pd-sec-pct">{Math.round(s.readFrac * 100)}%</span>
                      <span className="pd-sec-wpm">{s.wpm ? `${s.wpm} wpm` : '—'}</span>
                      <span className="pd-sec-words">{s.readWords}/{s.total}</span>
                    </div>
                  );
                })}
              </div>
              {selSecs.size > 0 && (
                <div className="pd-secbar">
                  <div className="pd-secbar-row">
                    <span className="pd-secbar-lbl">{selSecs.size} selected</span>
                    <label className="pd-pace-pick">read remainder at
                      <select value={paceSel} onChange={(e) => setPaceSel(e.target.value)}>
                        {PACE_PRESETS.map((p) => <option key={p.label} value={String(p.wpm)}>{p.label} · {p.wpm} wpm</option>)}
                        <option value="custom">Custom…</option>
                      </select>
                    </label>
                    {paceSel === 'custom' && <input className="pd-pace-num" type="number" min="30" max="2000" value={customWpm} onChange={(e) => setCustomWpm(e.target.value)} title="Words per minute" />}
                    <button className="toggle-on" disabled={!remainderWords || !effWpm} onClick={markSelectedReadAtPace}
                      title="Mark the unread words in these sections read, crediting the time at this pace">
                      ✓ Mark read{remainderWords ? ` · +${remainderWords.toLocaleString()} words @ ${effWpm} wpm` : ''}
                    </button>
                  </div>
                  <div className="pd-secbar-row">
                    {allSelSkipped
                      ? <button onClick={() => toggleSkipSelected(false)} title="Count these sections toward % read again">↺ Un-skip {selSecs.size}</button>
                      : <button onClick={() => toggleSkipSelected(true)} title="Exclude these sections from % read (front/back matter, an appendix you won't read, …)">⏭ Skip {selSecs.size}</button>}
                    {selWords > 0 && (!unreadArm
                      ? <button onClick={() => setUnreadArm(true)} title="Clear the read coverage of these sections">↩ Mark unread…</button>
                      : (
                        <>
                          <button className="grab-trash" onClick={markSelectedUnread}>⚠ Confirm — clear {selWords.toLocaleString()} read word{selWords === 1 ? '' : 's'}</button>
                          <button onClick={() => setUnreadArm(false)}>Cancel</button>
                        </>
                      ))}
                    <button onClick={() => { setSelSecs(new Set()); setUnreadArm(false); }}>Clear selection</button>
                  </div>
                  <span className="settings-note" style={{ margin: 0 }}>
                    <b>Mark read</b> credits the unread remainder at the chosen pace (its time counts toward WPM) — for a section you finished on audiobook or paper.
                    <b> Skip</b> excludes a section from % read. <b>Mark unread</b> clears coverage.
                  </span>
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
                          <span className="settings-note" style={{ margin: 0 }}>{sections[i].readWords}/{sections[i].total} here · read {m.file ? `in “${m.file}”` : 'earlier'}{m.at ? ` · ${fmtDate(m.at)}` : ''}</span>
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

              {/* Detailed compare against ONE previously-read file (needs its stored text) — matches every
                  section, shows the other file's read %, and carries the read state over word-accurately. */}
              {scanAvailable && fileList.length > 0 && (
                <div className="pd-scan">
                  <label className="pd-cmp-pick">
                    <span>Compare overlap with a previously-read file:</span>
                    <select value="" disabled={cmpBusy} onChange={(e) => compareWith(e.target.value)}>
                      <option value="">{cmpBusy ? 'Comparing…' : 'Pick a file…'}</option>
                      {fileList.map((f) => <option key={f.checksum || f.contentChecksum} value={f.checksum || f.contentChecksum}>{f.fileName || (f.checksum || '').slice(0, 8)}</option>)}
                    </select>
                  </label>
                  {cmp?.error && <p className="settings-note" style={{ margin: '4px 0 0' }}>{cmp.error}</p>}
                  {cmp?.pairs && cmp.pairs.length === 0 && <p className="settings-note" style={{ margin: '4px 0 0' }}>No sections here were read more in “{cmp.file}”.</p>}
                  {cmp?.pairs && cmp.pairs.length > 0 && (
                    <>
                      <div className="field-section" style={{ marginTop: 6 }}>Read more in “{cmp.file}” ({cmp.pairs.length}) — tick to carry that read state here</div>
                      {cmp.pairs.map((p) => (
                        <label key={p.idx} className="pd-scan-row">
                          <input type="checkbox" checked={carrySel.has(p.idx)} onChange={(e) => setCarrySel((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.idx); else n.delete(p.idx); return n; })} />
                          <span className="pd-scan-title">{p.title}</span>
                          <span className="settings-note" style={{ margin: 0 }}>here {Math.round(p.curFrac * 100)}% → there {Math.round(p.oldFrac * 100)}%</span>
                        </label>
                      ))}
                      <div className="pd-unread-bar">
                        {!carryArm ? (
                          <button className="toggle-on" disabled={!carrySel.size} onClick={() => setCarryArm(true)}>⇄ Carry over {carrySel.size} section{carrySel.size === 1 ? '' : 's'}…</button>
                        ) : (
                          <>
                            <button className="grab-trash" onClick={carryOver}>⚠ Confirm — mark {carryWords.toLocaleString()} word{carryWords === 1 ? '' : 's'} read</button>
                            <button onClick={() => setCarryArm(false)}>Cancel</button>
                          </>
                        )}
                        <button onClick={() => { setCmp(null); setCarrySel(new Set()); setCarryArm(false); }}>Clear</button>
                        <span className="settings-note" style={{ margin: 0 }}>Transfers the other file’s exact per-word read state onto the content-identical sections here.</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Fuzzy library scan: is THIS file similar to anything already read? Whole-text fingerprint,
              so it needs no ToC — matches hand off to the detailed section compare above (which does). */}
          {scanAvailable && fileList.length > 0 && (
            <div className="pd-scan">
              {simRes === null && !simBusy && (
                <button onClick={scanSimilar} title="Fingerprint this document and score every previously-read file against it — catches new editions, retitled copies, and heavily overlapping texts even when no section matches exactly">🧬 Scan library for similar files</button>
              )}
              {simBusy && <span className="settings-note" style={{ margin: 0 }}>Scanning {fileList.length} previously-read file{fileList.length === 1 ? '' : 's'}…</span>}
              {simRes?.error && (
                <>
                  <span className="settings-note" style={{ margin: 0 }}>{simRes.error}</span>
                  <button onClick={() => setSimRes(null)}>Done</button>
                </>
              )}
              {simRes?.rows && simRes.rows.length === 0 && (
                <>
                  <span className="settings-note" style={{ margin: 0 }}>
                    No meaningful overlap with the {simRes.scanned} previously-read file{simRes.scanned === 1 ? '' : 's'} scanned{simRes.skipped ? ` (${simRes.skipped} skipped — text not stored on this device)` : ''}. This looks new. ✨
                  </span>
                  <button onClick={() => setSimRes(null)}>Done</button>
                </>
              )}
              {simRes?.rows && simRes.rows.length > 0 && (
                <>
                  <div className="field-section" style={{ marginTop: 0 }}>Similar to {simRes.rows.length} previously-read file{simRes.rows.length === 1 ? '' : 's'}</div>
                  {simRes.rows.map((r) => {
                    const tier = similarityTier(r.sim);
                    return (
                      <div key={r.checksum} className="pd-scan-row pd-sim-row">
                        <span className={`pd-sim-badge pd-sim-${tier.key}`}>{Math.round(r.sim * 100)}%</span>
                        <span className="pd-scan-title">{r.fileName}</span>
                        <span className="settings-note" style={{ margin: 0 }}>{tier.label} · {r.readPct}% read there</span>
                        {sections.length > 0 && (
                          <button className="link-btn" disabled={cmpBusy} title="Run the detailed section-by-section compare against this file (carry read state over)" onClick={() => compareWith(r.checksum)}>⇄ Compare sections</button>
                        )}
                      </div>
                    );
                  })}
                  <div className="pd-unread-bar">
                    <button onClick={() => setSimRes(null)}>Done</button>
                    <span className="settings-note" style={{ margin: 0 }}>
                      Fuzzy content fingerprint (5-word shingles) — survives edition changes and re-split chapters{simRes.skipped ? ` · ${simRes.skipped} file(s) skipped (text not stored here)` : ''}{sections.length === 0 ? ' · run the ToC wizard here to enable the section-level compare/carry-over' : ''}.
                    </span>
                  </div>
                </>
              )}
            </div>
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
