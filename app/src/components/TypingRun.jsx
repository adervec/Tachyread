import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playLineSound, playTick, TYPING_SOUNDS } from '../features/clickSound.js';
import { getLineIndex, getParagraphRange } from '../document/readerDocument.js';
import { deviceKind } from '../state/device.js';
import { buildPassage, TYPING_MODES, TYPING_MODE_BY_ID } from '../engine/typingModes.js';
import { letterGrade, playGradeSound, GRADE_STATEMENTS } from '../features/gradeChime.js';

const DEFAULT_SOUNDS = {
  charCorrect: 'off', charWrong: 'off', wordPerfect: 'click', wordError: 'hiss',
  linePerfect: 'off', sentencePerfect: 'off', paragraphPerfect: 'off',
};

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

export default function TypingRun({ tab, onPatch, onExitDiscard, onExitContinue, onSaveRun, sessionRuns, endFanfare = true, plan = null, onPlanNext, onPlanExit }) {
  const { doc, settings } = tab;
  const cfg = settings.typing || {};
  const caseSensitive = !!cfg.caseSensitive;
  const volume = cfg.soundVolume ?? 0.4;
  const sounds = { ...DEFAULT_SOUNDS, ...(cfg.sounds || {}) };
  const tickClock = !!cfg.tickClock;
  const [showSounds, setShowSounds] = useState(false);
  // Play an event cue ('off' / falsy = silent).
  const ping = (id) => { if (id && id !== 'off') playLineSound(id, volume); };
  const setSound = (k, v) => onPatch?.({ typing: { ...cfg, sounds: { ...sounds, [k]: v } } });
  // One labelled sound dropdown for the on-screen panel; changing it previews the sound.
  const soundRow = (label, k) => (
    <label className="tr-snd" key={k}>
      <span>{label}</span>
      <select value={sounds[k]} onChange={(e) => { setSound(k, e.target.value); if (e.target.value !== 'off') playLineSound(e.target.value, volume); }}>
        <option value="off">Off</option>
        {TYPING_SOUNDS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );

  // Reading position captured once, when typing opened. Discard returns here.
  const startIndex = useRef(settings.wordIndex);
  // Typing game mode: 'passage' (from the book) is the Monkeytype baseline; the rest are
  // Mavis-Beacon-style drills generated independently of the document. `seed` varies drills on reattempt.
  const [gameMode, setGameMode] = useState(cfg.mode || 'passage');
  const [seed, setSeed] = useState(0);
  const isDocMode = (TYPING_MODE_BY_ID[gameMode]?.kind || 'doc') === 'doc';
  const passage = useMemo(
    () => buildPassage(gameMode, { docWords: doc.words, startIndex: startIndex.current, max: PASSAGE_MAX, seed }),
    [doc, gameMode, seed]
  );

  // Which passage indices end a line / sentence / paragraph — for the "segment complete, no errors"
  // cues. Only doc-backed modes (the passage runs consecutive document words from startIndex) map to
  // the book's structure; generated drills have no line/sentence/paragraph layout, so this is null.
  // ponytail: assumes the passage is consecutive doc words; off by a boundary at most if a mode reorders.
  const segEnds = useMemo(() => {
    if (!isDocMode) return null;
    const base = startIndex.current;
    const lineOf = (gi) => getLineIndex(doc, gi);
    const paraOf = (gi) => getParagraphRange(doc, lineOf(gi)).startLine;
    const line = [], sent = [], para = [];
    for (let i = 0; i < passage.length; i++) {
      const gi = base + i, gj = base + i + 1, last = i === passage.length - 1;
      line[i] = last || lineOf(gi) !== lineOf(gj);
      sent[i] = last || doc.wordToSentence?.[gi] !== doc.wordToSentence?.[gj];
      para[i] = last || paraOf(gi) !== paraOf(gj);
    }
    return { line, sent, para };
  }, [doc, isDocMode, passage]);
  const seg = useRef({ line: true, sent: true, para: true }); // stays true while the current segment is error-free

  const [mode, setMode] = useState(cfg.runMode || 'seconds'); // 'seconds' | 'words' | 'endless'
  const [limit, setLimit] = useState(cfg.runLimit || 60);
  const [phase, setPhase] = useState('idle'); // idle | countdown | running | done
  const [count, setCount] = useState(null);   // 'Ready' | 'Set' | 'Go!' during the countdown
  const countTimers = useRef([]);
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
    const net = Math.round(m.net);
    const run = {
      ts: Date.now(),
      netWpm: net,
      grossWpm: Math.round(m.gross),
      accuracy: Math.round(m.acc * 10) / 10,
      chars: s.chars,
      errors: s.errors,
      words: s.words,
      perfect: s.perfect,
      durationMs: Math.round(m.secs * 1000),
      docName: doc.fileName || 'text',
      errorKeys: { ...s.errorKeys },
      tier: netTier(net),
      grade: letterGrade(net),
      device: deviceKind(), // 'Mobile' | 'Desktop' — which device this run was typed on
      mode: gameMode,       // which typing mode/drill this run used
    };
    setSummary(run);
    setPhase('done');
    onSaveRun?.(run);
    if (endFanfare) playGradeSound(run.grade);
  }, [metrics, doc, onSaveRun, gameMode, endFanfare]);

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

  // Countdown clock: tick once a second in a timed run, then accelerate + sharpen over the final ~10s.
  useEffect(() => {
    if (phase !== 'running' || !tickClock || mode !== 'seconds') return undefined;
    let to;
    const loop = () => {
      const remaining = effLimitSecs - metrics().secs;
      if (remaining <= 0) return;
      const urgency = remaining > 10 ? 0 : Math.min(1, (10 - remaining) / 10);
      playTick(volume, urgency);
      const next = remaining > 10 ? 1000 : remaining > 5 ? 500 : remaining > 3 ? 333 : remaining > 1 ? 200 : 120;
      to = setTimeout(loop, next);
    };
    to = setTimeout(loop, 1000);
    return () => clearTimeout(to);
  }, [phase, tickClock, mode, effLimitSecs, volume, metrics]);

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
    seg.current = { line: true, sent: true, para: true };
    setPhase('running');
    setTrend([]);
    armIdle();
  }

  const clearCount = () => { countTimers.current.forEach(clearTimeout); countTimers.current = []; };

  // Run starts on an explicit "Start" (or a done-screen "Onward/Reattempt") with a Ready·Set·Go.
  // Focus the input synchronously inside the originating tap so the mobile keyboard opens during the
  // count and is ready the instant we hit "Go!".
  function beginCountdown() {
    clearCount();
    setPos(0); setBuf(''); setResults([]); setSummary(null); setTrend([]);
    stats.current = freshStats(); wordErrors.current = 0;
    seg.current = { line: true, sent: true, para: true };
    if (linesRef.current) linesRef.current.style.transform = 'translateY(0)';
    setPhase('countdown');
    setCount('Ready');
    focus();
    countTimers.current = [
      setTimeout(() => setCount('Set'), 600),
      setTimeout(() => setCount('Go!'), 1200),
      setTimeout(() => { setCount(null); start(); focus(); }, 1700),
    ];
  }

  useEffect(() => () => clearCount(), []); // clear pending countdown timers on unmount

  function reattempt() {
    setPos(0);
    setBuf('');
    setResults([]);
    setSummary(null);
    setTrend([]);
    setSeed((s) => s + 1); // fresh drill text (no-op for the document passage mode)
    stats.current = freshStats();
    wordErrors.current = 0;
    if (linesRef.current) linesRef.current.style.transform = 'translateY(0)';
    setPhase('idle');
    // Refocus the hidden input *within* this tap so the next run accepts keys (and the mobile
    // keyboard reopens) — a programmatic re-focus outside the gesture wouldn't.
    focus();
  }

  // Start a fresh run beginning where the just-finished run stopped (passage mode walks forward
  // through the book). Drill modes have no position, so this is just a fresh run with new text.
  function nextRun() {
    if (isDocMode) startIndex.current = Math.min(doc.words.length, startIndex.current + stats.current.words);
    setSeed((s) => s + 1); // force passage rebuild (doc: from the new startIndex; drill: fresh text)
    beginCountdown();
  }

  function commitWord(typed = buf) {
    const target = passage[pos] || '';
    const perfect = wordErrors.current === 0 && typed.length === target.length;
    const s = stats.current;
    s.words += 1;
    if (perfect) { s.perfect += 1; ping(sounds.wordPerfect); } else { ping(sounds.wordError); }
    // Segment-complete cues: a segment is "clean" only if every word in it was perfect.
    seg.current.line = seg.current.line && perfect;
    seg.current.sent = seg.current.sent && perfect;
    seg.current.para = seg.current.para && perfect;
    if (segEnds) {
      if (segEnds.line[pos]) { if (seg.current.line) ping(sounds.linePerfect); seg.current.line = true; }
      if (segEnds.sent[pos]) { if (seg.current.sent) ping(sounds.sentencePerfect); seg.current.sent = true; }
      if (segEnds.para[pos]) { if (seg.current.para) ping(sounds.paragraphPerfect); seg.current.para = true; }
    }
    wordErrors.current = 0;
    setResults((r) => [...r, { typed, perfect }]);
    setBuf('');
    const nextPos = pos + 1;
    setPos(nextPos);
    if (mode === 'words' && s.words >= limit) { endRun(); return; }
    if (nextPos >= passage.length) { endRun(); }
  }

  // Score the characters of `str` from index `fromLen` onward against the current target word.
  function scoreChars(fromLen, str) {
    const s = stats.current;
    const target = passage[pos] || '';
    for (let p = fromLen; p < str.length; p++) {
      const ch = target[p];
      s.chars += 1;
      if (ch !== undefined && sameChar(str[p], ch, caseSensitive)) {
        s.correct += 1;
        ping(sounds.charCorrect);
      } else {
        s.errors += 1;
        wordErrors.current += 1;
        ping(sounds.charWrong);
        if (ch) { const k = caseSensitive ? ch : ch.toLowerCase(); s.errorKeys[k] = (s.errorKeys[k] || 0) + 1; }
      }
    }
  }

  // Letters, space (commit) and backspace flow through the input's value here instead of keydown so
  // that mobile soft keyboards work — many of them don't emit usable keydown events (key:"Unidentified",
  // keyCode 229). The input holds the in-progress word (value={buf}); we diff each change. Enter and
  // Escape stay on keydown since a single-line input doesn't surface them as value changes.
  function onChange(e) {
    if (phase !== 'running') { if (buf) setBuf(''); return; } // runs begin via Start (Ready·Set·Go), not on keypress
    const val = e.target.value;
    const sp = val.search(/\s/);
    if (sp >= 0) {
      const typed = val.slice(0, sp);
      scoreChars(buf.length, typed);
      armIdle();
      if (typed.length > 0) commitWord(typed); else setBuf('');
      return;
    }
    armIdle();
    if (val.length > buf.length) scoreChars(buf.length, val);
    setBuf(val);
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (phase === 'countdown') { clearCount(); setCount(null); setPhase('idle'); return; }
      phase === 'running' ? endRun() : onExitDiscard?.();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (phase !== 'running') return; // a run is started with the Start button, not Enter
      if (buf.length === 0) return;
      armIdle();
      commitWord(buf);
    }
  }

  // On the done screen: is there more book ahead to walk into with "Onward"?
  const moreAhead = !!summary && isDocMode && startIndex.current + (summary.words || 0) < doc.words.length;
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
    <div className="type-run" onPointerDown={focus}>
      <input
        ref={inputRef}
        className="type-sink"
        autoFocus
        value={buf}
        onChange={onChange}
        onKeyDown={onKeyDown}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        aria-label="Typing run input"
      />

      {plan && (
        <div className="tr-plan-bar">
          📋 {plan.name} · Step {plan.step}/{plan.steps} · Set {plan.set}/{plan.sets}
        </div>
      )}

      <div className="tr-bar">
        <div className="tr-stats">
          <Stat v={live.net} l="net wpm" hero />
          <Stat v={live.gross} l="gross wpm" />
          <Stat v={`${live.acc}%`} l="accuracy" />
          <Stat v={progressLabel} l="run" />
        </div>
        <div className="tr-controls">
          {phase !== 'running' && !plan && (
            <>
              <select
                value={gameMode}
                title="Typing mode — Passage types your book; the rest are drills"
                onChange={(e) => { setGameMode(e.target.value); onPatch?.({ typing: { ...cfg, mode: e.target.value } }); reattempt(); }}
              >
                {TYPING_MODES.map((tm) => <option key={tm.id} value={tm.id}>{tm.label}</option>)}
              </select>
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
          <button type="button" className={showSounds ? 'toggle-on' : ''} title="Customize the typing sound effects"
            onClick={() => setShowSounds((v) => !v)}>🎚 Sounds</button>
          {phase === 'idle' && <button className="toggle-on" onClick={beginCountdown} title="Start the run (Ready·Set·Go)">▶ Start</button>}
          {phase === 'running'
            ? <button className="toggle-on" onClick={endRun}>■ End run</button>
            : <button onClick={onExitDiscard}>{plan ? 'Exit plan' : 'Discard'}</button>}
        </div>
      </div>

      {showSounds && (
        <div className="tr-sounds">
          {soundRow('Char ✓', 'charCorrect')}
          {soundRow('Char ✗', 'charWrong')}
          {soundRow('Word ✓', 'wordPerfect')}
          {soundRow('Word ✗', 'wordError')}
          {isDocMode && soundRow('Line ✓', 'linePerfect')}
          {isDocMode && soundRow('Sentence ✓', 'sentencePerfect')}
          {isDocMode && soundRow('Paragraph ✓', 'paragraphPerfect')}
          {mode === 'seconds' && (
            <label className="tr-snd tr-snd-tick" title="Ticking clock that speeds up in the final seconds">
              <input type="checkbox" checked={tickClock}
                onChange={(e) => onPatch?.({ typing: { ...cfg, tickClock: e.target.checked } })} />
              <span>⏱ Countdown tick</span>
            </label>
          )}
        </div>
      )}

      <Trend trend={trend} />

      <div className="tr-viewport">
        {phase === 'countdown' && <div className="tr-countdown" key={count} aria-live="assertive">{count}</div>}
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

      {phase === 'idle' && <div className="tr-hint">Press ▶ Start for a Ready·Set·Go. Run ends at your limit, on “End run”, or after 5s idle. Esc discards.</div>}

      {phase === 'done' && summary && (
        <div className="tr-results">
          {endFanfare && summary.grade && (
            <div className={`tr-grade tr-grade-${summary.grade}`}>
              <span className="tr-grade-letter">{summary.grade}</span>
              <span className="tr-grade-statement">{GRADE_STATEMENTS[summary.grade]}</span>
            </div>
          )}
          <div className="tr-results-head">
            <strong>{summary.netWpm} net WPM</strong> · {summary.grossWpm} gross · {summary.accuracy}% acc · {summary.tier}
          </div>
          <div className="tr-results-actions">
            {plan ? (
              <>
                <button onClick={beginCountdown}>↻ Redo set</button>
                <button className="toggle-on" onClick={onPlanNext}>{plan.step >= plan.steps && plan.set >= plan.sets ? '🏁 Finish plan' : 'Next set →'}</button>
                <button onClick={onPlanExit}>Exit plan</button>
              </>
            ) : (
              <>
                {moreAhead && (
                  <button className="toggle-on" onClick={nextRun} title="New run starting where this one ended">Onward →</button>
                )}
                <button className={moreAhead ? '' : 'toggle-on'} onClick={beginCountdown} title="Re-type the exact same passage">↻ Reattempt</button>
                {isDocMode && (
                  <button onClick={() => onExitContinue?.(startIndex.current + stats.current.words)}>Continue (count as read)</button>
                )}
                <button onClick={onExitDiscard}>{isDocMode ? 'Discard' : 'Exit'}</button>
              </>
            )}
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
