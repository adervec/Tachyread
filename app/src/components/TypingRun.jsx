import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playPerfectClick, playErrorHiss } from '../features/clickSound.js';

// Typing practice as self-contained "runs". A run types the document text forward from the
// reading position WITHOUT moving the reading index mid-run — so the reading panes don't jump
// and you can Discard (return to where you were) or Continue (count what you typed as read).
// Monkeytype-style per-character colouring; the passage scrolls by line, not per word.

function sameChar(a, b, caseSensitive) {
  return caseSensitive ? a === b : a?.toLowerCase() === b?.toLowerCase();
}

// Net-WPM tiers from the Typing Speed Field Guide.
function netTier(net) {
  if (net >= 110) return 'Exceptional';
  if (net >= 90) return 'Advanced';
  if (net >= 70) return 'Fast';
  if (net >= 50) return 'Proficient';
  if (net >= 40) return 'Average';
  if (net >= 30) return 'Improving';
  return 'Beginner';
}

const PASSAGE_MAX = 600;     // words pulled ahead for a run
const IDLE_END_MS = 5000;    // auto-end after this much inactivity
const ENDLESS_SECS = 99999;

const freshStats = () => ({ start: 0, chars: 0, correct: 0, errors: 0, words: 0, perfect: 0, errorKeys: {} });

export default function TypingRun({ tab, onPatch, onExitDiscard, onExitContinue, onSaveRun, sessionRuns }) {
  const { doc, settings } = tab;
  const cfg = settings.typing || {};
  const caseSensitive = !!cfg.caseSensitive;
  const volume = cfg.soundVolume ?? 0.4;

  // Reading position captured once, when typing opened. Discard returns here.
  const startIndex = useRef(settings.wordIndex);
  const passage = useMemo(
    () => doc.words.slice(startIndex.current, Math.min(doc.words.length, startIndex.current + PASSAGE_MAX)),
    [doc]
  );

  const [mode, setMode] = useState(cfg.runMode || 'seconds'); // 'seconds' | 'words' | 'endless'
  const [limit, setLimit] = useState(cfg.runLimit || 60);
  const [phase, setPhase] = useState('idle'); // idle | running | done
  const [pos, setPos] = useState(0);          // index into passage of the active word
  const [buf, setBuf] = useState('');
  const [results, setResults] = useState([]); // per completed word: { typed, perfect }
  const [, setTick] = useState(0);
  const [trend, setTrend] = useState([]);     // {t, gross, net, acc}
  const [summary, setSummary] = useState(null);

  const stats = useRef(freshStats());
  const wordErrors = useRef(0);
  const inputRef = useRef(null);
  const idleTimer = useRef(null);
  const tickTimer = useRef(null);
  const linesRef = useRef(null);
  const activeRef = useRef(null);
  const lineH = useRef(0);

  const effLimitSecs = mode === 'endless' ? ENDLESS_SECS : limit;

  const focus = () => inputRef.current?.focus();
  useEffect(() => { focus(); }, [phase]);

  // ── live metrics ──
  const metrics = useCallback(() => {
    const s = stats.current;
    const secs = s.start ? (Date.now() - s.start) / 1000 : 0;
    const mins = secs / 60;
    const gross = mins > 0 ? (s.chars / 5) / mins : 0;
    const net = mins > 0 ? Math.max(0, (s.chars / 5 - s.errors) / mins) : 0;
    const acc = s.chars ? (s.correct / s.chars) * 100 : 100;
    return { secs, gross, net, acc };
  }, []);

  const endRun = useCallback(() => {
    if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; }
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    const s = stats.current;
    const m = metrics();
    const run = {
      ts: Date.now(),
      netWpm: Math.round(m.net),
      grossWpm: Math.round(m.gross),
      accuracy: Math.round(m.acc * 10) / 10,
      chars: s.chars,
      errors: s.errors,
      words: s.words,
      perfect: s.perfect,
      durationMs: Math.round(m.secs * 1000),
      docName: doc.fileName || 'text',
      errorKeys: { ...s.errorKeys },
      tier: netTier(Math.round(m.net)),
    };
    setSummary(run);
    setPhase('done');
    onSaveRun?.(run);
  }, [metrics, doc, onSaveRun]);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => endRun(), IDLE_END_MS);
  }, [endRun]);

  // Run timer / live sampling.
  useEffect(() => {
    if (phase !== 'running') return undefined;
    tickTimer.current = setInterval(() => {
      const m = metrics();
      setTick((n) => n + 1);
      setTrend((tr) => [...tr.slice(-150), { t: m.secs, gross: m.gross, net: m.net, acc: m.acc }]);
      if (mode !== 'endless' && mode !== 'words' && m.secs >= effLimitSecs) endRun();
    }, 500);
    return () => { if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; } };
  }, [phase, mode, effLimitSecs, metrics, endRun]);

  // Line-by-line scroll: keep the active word's line pinned near the top (updates only when the
  // active word moves to a new visual line, so the text doesn't jitter per word).
  useLayoutEffect(() => {
    const lines = linesRef.current;
    const active = activeRef.current;
    if (!lines || !active) return;
    if (!lineH.current) {
      const lh = parseFloat(getComputedStyle(lines).lineHeight);
      lineH.current = isFinite(lh) && lh > 0 ? lh : 40;
    }
    const lineIdx = Math.round(active.offsetTop / lineH.current);
    lines.style.transform = `translateY(${-Math.max(0, lineIdx - 1) * lineH.current}px)`;
  }, [pos, buf]);

  function start() {
    stats.current = freshStats();
    stats.current.start = Date.now();
    wordErrors.current = 0;
    setPhase('running');
    setTrend([]);
    armIdle();
  }

  function reattempt() {
    setPos(0);
    setBuf('');
    setResults([]);
    setSummary(null);
    setTrend([]);
    stats.current = freshStats();
    wordErrors.current = 0;
    if (linesRef.current) linesRef.current.style.transform = 'translateY(0)';
    setPhase('idle');
  }

  function commitWord() {
    const target = passage[pos] || '';
    const perfect = wordErrors.current === 0 && buf.length === target.length;
    const s = stats.current;
    s.words += 1;
    if (perfect) { s.perfect += 1; playPerfectClick(volume); } else { playErrorHiss(volume); }
    wordErrors.current = 0;
    setResults((r) => [...r, { typed: buf, perfect }]);
    setBuf('');
    const nextPos = pos + 1;
    setPos(nextPos);
    if (mode === 'words' && s.words >= limit) { endRun(); return; }
    if (nextPos >= passage.length) { endRun(); }
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); phase === 'running' ? endRun() : onExitDiscard?.(); return; }
    if (phase === 'done') return;
    if (e.key === 'Backspace') { e.preventDefault(); setBuf((b) => b.slice(0, -1)); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (phase !== 'running') start();
      if (buf.length === 0) return;
      armIdle();
      commitWord();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      if (phase !== 'running') start();
      armIdle();
      const s = stats.current;
      const target = passage[pos] || '';
      const ch = target[buf.length];
      s.chars += 1;
      if (ch !== undefined && sameChar(e.key, ch, caseSensitive)) {
        s.correct += 1;
      } else {
        s.errors += 1;
        wordErrors.current += 1;
        if (ch) { const k = caseSensitive ? ch : ch.toLowerCase(); s.errorKeys[k] = (s.errorKeys[k] || 0) + 1; }
      }
      setBuf((b) => b + e.key);
    }
  }

  const m = metrics();
  const live = {
    gross: Math.round(m.gross),
    net: Math.round(m.net),
    acc: m.acc.toFixed(1),
    secs: m.secs,
  };
  const progressLabel =
    mode === 'words' ? `${stats.current.words} / ${limit} words`
      : mode === 'endless' ? `${live.secs.toFixed(0)}s · endless`
        : `${live.secs.toFixed(0)} / ${limit}s`;

  return (
    <div className="type-run" onMouseDown={focus}>
      <input
        ref={inputRef}
        className="type-sink"
        autoFocus
        value=""
        onChange={() => {}}
        onKeyDown={onKeyDown}
        aria-label="Typing run input"
      />

      <div className="tr-bar">
        <div className="tr-stats">
          <Stat v={live.net} l="net wpm" hero />
          <Stat v={live.gross} l="gross wpm" />
          <Stat v={`${live.acc}%`} l="accuracy" />
          <Stat v={progressLabel} l="run" />
        </div>
        <div className="tr-controls">
          {phase !== 'running' && (
            <>
              <select value={mode} onChange={(e) => { setMode(e.target.value); onPatch?.({ typing: { ...cfg, runMode: e.target.value } }); }}>
                <option value="seconds">Seconds</option>
                <option value="words">Words</option>
                <option value="endless">Endless</option>
              </select>
              {mode !== 'endless' && (
                <input type="number" min={1} max={9999} value={limit}
                  onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setLimit(v); onPatch?.({ typing: { ...cfg, runLimit: v } }); }}
                  style={{ width: 64 }} />
              )}
            </>
          )}
          <label className="tr-vol" title="Sound volume">🔊
            <input type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => onPatch?.({ typing: { ...cfg, soundVolume: Number(e.target.value) } })} />
          </label>
          {phase === 'running'
            ? <button className="toggle-on" onClick={endRun}>■ End run</button>
            : <button onClick={onExitDiscard}>Discard</button>}
        </div>
      </div>

      <Trend trend={trend} />

      <div className="tr-viewport">
        <div className="tr-lines" ref={linesRef}>
          {passage.map((w, i) => {
            if (i < pos) {
              const r = results[i];
              return <span key={i} className={`trw ${r && !r.perfect ? 'imperfect' : 'done'}`}>{w} </span>;
            }
            if (i > pos) return <span key={i} className="trw pending">{w} </span>;
            // active word — per-char colouring + caret
            const len = Math.max(w.length, buf.length);
            const chars = [];
            for (let j = 0; j < len; j++) {
              if (j === buf.length) chars.push(<span key={`k${j}`} className="trc caret" />);
              const typed = j < buf.length;
              const cls = !typed ? 'trc pending'
                : j >= w.length ? 'trc wrong'
                  : sameChar(buf[j], w[j], caseSensitive) ? 'trc correct' : 'trc wrong';
              chars.push(<span key={j} className={cls}>{j >= w.length ? buf[j] : w[j]}</span>);
            }
            if (buf.length >= len) chars.push(<span key="ce" className="trc caret" />);
            return <span key={i} className="trw active" ref={activeRef}>{chars}{' '}</span>;
          })}
        </div>
      </div>

      {phase === 'idle' && <div className="tr-hint">Start typing the text above. Run ends at your limit, on “End run”, or after 5s idle. Esc discards.</div>}

      {phase === 'done' && summary && (
        <div className="tr-results">
          <div className="tr-results-head">
            <strong>{summary.netWpm} net WPM</strong> · {summary.grossWpm} gross · {summary.accuracy}% acc · {summary.tier}
          </div>
          <div className="tr-results-actions">
            <button className="toggle-on" onClick={reattempt}>↻ Reattempt</button>
            <button onClick={() => onExitContinue?.(startIndex.current + stats.current.words)}>Continue (count as read)</button>
            <button onClick={onExitDiscard}>Discard</button>
          </div>
        </div>
      )}

      {sessionRuns && sessionRuns.length > 0 && (
        <div className="tr-killfeed" title="Typing runs this session">
          <span className="tr-kf-label">🏁 Runs:</span>
          {sessionRuns.map((r, i) => (
            <span key={i} className="tr-kf-item">{r.netWpm}wpm · {r.accuracy}% <span className="tr-kf-ts">{new Date(r.ts).toLocaleTimeString()}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ v, l, hero }) {
  return (
    <div className={`tr-stat${hero ? ' tr-stat-hero' : ''}`}>
      <span className="tr-v">{v}</span>
      <span className="tr-l">{l}</span>
    </div>
  );
}

// Tiny live trendline: gross WPM, net (effective) WPM, and accuracy over the run.
function Trend({ trend }) {
  if (trend.length < 2) return <div className="tr-trend tr-trend-empty" />;
  const W = 600, H = 54;
  const maxT = trend[trend.length - 1].t || 1;
  const maxW = Math.max(40, ...trend.map((p) => Math.max(p.gross, p.net)));
  const line = (key, scaleMax) =>
    trend
      .map((p, i) => `${i ? 'L' : 'M'} ${((p.t / maxT) * W).toFixed(1)} ${(H - Math.min(1, p[key] / scaleMax) * H).toFixed(1)}`)
      .join(' ');
  return (
    <svg className="tr-trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" title="WPM · effective WPM · accuracy">
      <path d={line('gross', maxW)} className="trend-gross" />
      <path d={line('net', maxW)} className="trend-net" />
      <path d={line('acc', 100)} className="trend-acc" />
    </svg>
  );
}
