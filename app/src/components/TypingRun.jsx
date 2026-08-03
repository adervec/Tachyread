import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playLineSound, playTick, TYPING_SOUNDS } from '../features/clickSound.js';
import { getLineIndex, getParagraphRange } from '../document/readerDocument.js';
import { deviceKind } from '../state/device.js';
import { buildPassage, TYPING_MODES, TYPING_MODE_BY_ID } from '../engine/typingModes.js';
import { transformToken, displayCells, isExotic, ghostCharsAt } from '../engine/typingText.js';
import { letterGrade, playGradeSound, GRADE_STATEMENTS } from '../features/gradeChime.js';
import { createReadAloud } from '../features/readAloud.js';
import { rateFromIndex } from '../features/tts.js';
import { fmtTime } from '../features/dateFmt.js';
import { allTypingRuns } from '../state/storage.js';
import { consistencyPct, pbFlags, bestNet, typingStreak, problemWords, buildCum, paceChars, paceWordIndex } from '../features/typingUpgrades.js';
import { typingEyeColor } from '../features/avatarMood.js';
import Avatar from './Avatar.jsx';

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
// Cap how many typed-past-the-end characters render (stats still count them all). Together with
// the container's end-of-line slack (.tr-lines padding-right) this stops the last word of a line
// from reflowing onto the next line while it's being typed.
const OVERTYPE_MAX = 4;

const freshStats = () => ({ start: 0, chars: 0, correct: 0, errors: 0, words: 0, perfect: 0, errorKeys: {}, keys: {} });

// Pending words further ahead than this aren't rendered — they're below the viewport fold anyway,
// and skipping their DOM is what keeps long timed/endless passages (up to 600 words) light.
const PENDING_WINDOW = 160;

const charOkWith = (typedCh, targetCh, caseSensitive, bypassSym) =>
  (bypassSym && isExotic(targetCh)) || sameChar(typedCh, targetCh, caseSensitive);

// Display cells when a word should RENDER differently from the typed target — "as written"
// capitals over a lowercased target, and/or the noSpecial-stripped characters as dim auto-skipped
// ghosts. null = plain rendering (options off, or the alignment invariant failed on an exotic
// token). The REQUIRED typing is identical either way.
function cellsFor(orig, w, { bypassSym, noSpecial, wantCaps, wantGhosts }) {
  if ((!wantCaps && !wantGhosts) || !orig) return null;
  const all = displayCells(orig, { bypassNonQwerty: bypassSym, noSpecial });
  const kept = all.filter((c) => c.t != null);
  if (kept.length !== w.length) return null;
  return wantGhosts ? all : kept;
}

// Committed and pending words only change when a word commits (or a voice/pace marker crosses
// them) — memo() lets every keystroke re-render JUST the active word instead of reconciling
// thousands of per-char spans across the whole passage. This is the typing-lag fix.
const CommittedWord = memo(function CommittedWord({ w, orig, typed, perfect, vc, caseSensitive, bypassSym, noSpecial, wantCaps, wantGhosts }) {
  const cells = cellsFor(orig, w, { bypassSym, noSpecial, wantCaps, wantGhosts });
  const chars = [];
  if (cells) {
    cells.forEach((c, ci) => {
      if (c.t == null) { chars.push(<span key={`g${ci}`} className="trc ghost">{c.ch}</span>); return; }
      const j = c.t;
      const cls = j >= typed.length ? 'trc missed'
        : charOkWith(typed[j], w[j], caseSensitive, bypassSym) ? 'trc correct' : 'trc wrong';
      chars.push(<span key={ci} className={cls}>{wantCaps ? c.ch : w[j]}</span>);
    });
    const extra = Math.min(typed.length, w.length + OVERTYPE_MAX);
    for (let j = w.length; j < extra; j++) chars.push(<span key={`x${j}`} className="trc extra">{typed[j]}</span>);
  } else {
    const len = Math.max(w.length, Math.min(typed.length, w.length + OVERTYPE_MAX));
    for (let j = 0; j < len; j++) {
      const cls = j >= w.length ? 'trc extra'
        : j >= typed.length ? 'trc missed'
          : charOkWith(typed[j], w[j], caseSensitive, bypassSym) ? 'trc correct' : 'trc wrong';
      chars.push(<span key={j} className={cls}>{j >= w.length ? typed[j] : w[j]}</span>);
    }
  }
  return <span className={`trw ${perfect ? 'done' : 'imperfect'}${vc}`}>{chars} </span>;
});
const PendingWord = memo(function PendingWord({ w, orig, vc, bypassSym, noSpecial, wantCaps, wantGhosts }) {
  const cells = cellsFor(orig, w, { bypassSym, noSpecial, wantCaps, wantGhosts });
  return (
    <span className={`trw pending${vc}`}>
      {cells
        ? cells.map((c, ci) => (c.t == null
          ? <span key={ci} className="trc ghost">{c.ch}</span>
          : <span key={ci}>{wantCaps ? c.ch : w[c.t]}</span>))
        : w}
      {' '}
    </span>
  );
});

export default function TypingRun({ tab, onPatch, onExitDiscard, onExitContinue, onSaveRun, sessionRuns, endFanfare = true, plan = null, onPlanNext, onPlanExit }) {
  const { doc, settings } = tab;
  const cfg = settings.typing || {};
  const caseSensitive = !!cfg.caseSensitive;
  const oneWord = !!cfg.oneWord; // show one word at a time; it must be typed perfectly to advance
  const raceVoice = !!cfg.raceVoice; // race the TTS voice: it reads the passage; get caught if it passes you
  const stopOnError = !!cfg.stopOnError; // a wrong key is refused (still costs an error) — accuracy discipline
  const confidence = !!cfg.confidence;   // no backspace — errors cost accuracy, not time
  const blind = !!cfg.blind;             // hide per-char verdicts while running; the numbers tell the tale at the end
  // Display-only variants of the transforms (the REQUIRED typing is identical either way):
  const wantCaps = !!cfg.showCaps;         // under lowercase: show the capitals as written
  const wantGhosts = !!cfg.ghostSpecials;  // under no-special: show the stripped chars as dim auto-skipped ghosts
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
  // Source-doc index of the last committed word — for exact forward continuation / "count as read"
  // when bypassed symbol tokens make the passage shorter than the doc span it covers.
  const lastGiRef = useRef(null);
  // Typing game mode: 'passage' (from the book) is the Monkeytype baseline; the rest are
  // Mavis-Beacon-style drills generated independently of the document. `seed` varies drills on
  // reattempt. 'review' only makes sense right after a run mined problem words — never restored.
  const [gameMode, setGameMode] = useState(cfg.mode === 'review' ? 'passage' : (cfg.mode || 'passage'));
  const [seed, setSeed] = useState(0);
  // The last run's problem words, feeding the 🎯 Review-misses drill (Amphetype-style).
  const reviewRef = useRef([]);
  // Persisted run history, loaded once: personal-best detection, the 👻 pace ghost's
  // last-run/PB speeds, and the daily-streak line on the results screen.
  const pastRunsRef = useRef(null);
  useEffect(() => { allTypingRuns().then((r) => { pastRunsRef.current = r || []; }).catch(() => { pastRunsRef.current = []; }); }, []);
  const isDocMode = (TYPING_MODE_BY_ID[gameMode]?.kind || 'doc') === 'doc';
  // Show the book's own line/paragraph breaks instead of a flowing wall — visual only.
  const showBreaks = !!cfg.showBreaks && isDocMode && !oneWord && !cfg.ticker;
  // Ticker display: the passage as ONE horizontal line — the active word holds a fixed point
  // (~35% in) while committed words slide off left and pending words stream in from the right.
  const ticker = !!cfg.ticker && !oneWord;
  // Auto-bypass characters a QWERTY keyboard can't make (default on): normalize typographic look-
  // alikes and drop purely-decorative tokens so the drill never asks you to type a "•" or a "¶".
  const bypassSym = cfg.bypassNonQwerty !== false;
  // Text transforms — the drill shows exactly what you type. `lowercase` and `noSpecial` (no
  // punctuation/symbols) are opt-in; `bypassSym` (non-typeable chars → removed) is folded in here too.
  const lowercase = !!cfg.lowercase;
  const noSpecial = !!cfg.noSpecial;
  // Prepared passage: `prepared` entries are { text, gi } where gi is the source-doc word index (for
  // line/sentence cues and forward continuation), with transformed-away tokens filtered out; `passage`
  // is the text-only array the run/render use. Built in one memo so the two stay in lockstep.
  const { prepared, passage } = useMemo(() => {
    const raw = buildPassage(gameMode, { docWords: doc.words, startIndex: startIndex.current, max: PASSAGE_MAX, seed, reviewWords: reviewRef.current });
    const base = isDocMode ? startIndex.current : 0;
    const prep = [];
    let pre = null; // fully-skipped decorative tokens ahead of the next kept word (ghost display)
    for (let i = 0; i < raw.length; i++) {
      const orig = String(raw[i] ?? '');
      const { text, skip } = transformToken(raw[i], { bypassNonQwerty: bypassSym, lowercase, noSpecial });
      if (skip) { (pre ||= []).push(orig); continue; }
      prep.push({ text, gi: base + i, orig, pre });
      pre = null;
    }
    return { prepared: prep, passage: prep.map((p) => p.text) };
  }, [doc, gameMode, seed, bypassSym, lowercase, noSpecial, isDocMode]);
  // A typed char matches its target when it's equal (case rule) or the target is exotic (auto-accepted).
  const charOk = (typedCh, targetCh) => (bypassSym && isExotic(targetCh)) || sameChar(typedCh, targetCh, caseSensitive);

  // Which passage indices end a line / sentence / paragraph — for the "segment complete, no errors"
  // cues. Only doc-backed modes (the passage runs consecutive document words from startIndex) map to
  // the book's structure; generated drills have no line/sentence/paragraph layout, so this is null.
  // ponytail: assumes the passage is consecutive doc words; off by a boundary at most if a mode reorders.
  const segEnds = useMemo(() => {
    if (!isDocMode) return null;
    const lineOf = (gi) => getLineIndex(doc, gi);
    const paraOf = (gi) => getParagraphRange(doc, lineOf(gi)).startLine;
    const line = [], sent = [], para = [];
    for (let i = 0; i < prepared.length; i++) {
      const gi = prepared[i].gi, gj = prepared[i + 1]?.gi ?? gi + 1, last = i === prepared.length - 1;
      line[i] = last || lineOf(gi) !== lineOf(gj);
      sent[i] = last || doc.wordToSentence?.[gi] !== doc.wordToSentence?.[gj];
      para[i] = last || paraOf(gi) !== paraOf(gj);
    }
    return { line, sent, para };
  }, [doc, isDocMode, prepared]);
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
  const [trend, setTrend] = useState([]);     // {t, gross, net, acc, burst}
  const trendRef = useRef([]);                // mirror for endRun (avoids a stale closure)
  const snapsRef = useRef([]);                // recent {ts, chars} snapshots → burst WPM
  const [summary, setSummary] = useState(null);
  const [voicePos, setVoicePos] = useState(-1); // word the racing voice is currently speaking

  const stats = useRef(freshStats());
  const wordErrors = useRef(0);
  const intervalsRef = useRef([]);  // inter-key gaps (ms) → the consistency % at run end
  const lastKeyTsRef = useRef(0);
  const wordStartRef = useRef(0);   // when the current word's first char landed → per-word ms
  const resultsRef = useRef([]);    // mirror of `results` incl. per-word ms (endRun reads it)
  const [pacePos, setPacePos] = useState(-1); // word the 👻 pace ghost is on (-1 = off)
  const inputRef = useRef(null);
  const idleTimer = useRef(null);
  const tickTimer = useRef(null);
  const linesRef = useRef(null);
  const activeRef = useRef(null);
  const caretRef = useRef(null);
  // Esc-during-run guard: first press arms (hint shows), second within 2.5s actually ends.
  const escArmRef = useRef(0);
  const escArmTimer = useRef(0);
  const [escArmed, setEscArmed] = useState(false);
  const lineH = useRef(0);
  // Voice-race state. posRef mirrors `pos` so the speech callbacks (which close over a stale render)
  // can read your live typing position; the rest track the racing voice.
  const posRef = useRef(0);
  const voiceRef = useRef(0);       // voice's current word index
  const racerRef = useRef(null);    // active read-aloud "racer"
  const caughtRef = useRef(false);  // did the voice pass you this run
  const racedRef = useRef(false);   // was a race actually running (speech available)
  const raceStartRef = useRef(0);   // race start time — a short grace ignores instant speech errors
  useEffect(() => { posRef.current = pos; }, [pos]);

  const effLimitSecs = mode === 'endless' ? ENDLESS_SECS : limit;

  // 👻 Pace ghost (Monkeytype's pace caret): a marker moving through the passage at a steady WPM —
  // your last run, your personal best, or a custom speed. Resolved per run start (phase dep) so the
  // async history load and fresh session runs are picked up.
  const paceMode = cfg.pace || 'off';
  const paceWpmVal = useMemo(() => {
    if (paceMode === 'off') return 0;
    if (paceMode === 'custom') return Math.max(10, Math.min(400, Number(cfg.paceWpm) || 60));
    const all = [...(pastRunsRef.current || []), ...(sessionRuns || [])];
    if (paceMode === 'pb') return bestNet(all) || 0;
    const last = [...all].sort((a, b) => (a.ts || 0) - (b.ts || 0)).at(-1);
    return last?.netWpm || 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paceMode, cfg.paceWpm, sessionRuns, phase]);
  const paceCum = useMemo(() => buildCum(passage), [passage]);

  const focus = () => inputRef.current?.focus();
  useEffect(() => { focus(); }, [phase]);
  // "Just start typing" must work no matter where focus wandered — opening via the menu leaves it
  // on the menu button, toggling a tile leaves it on the tile. A capture-phase grab redirects any
  // printable key to the sink BEFORE the browser delivers the text, so the very first letter both
  // starts the run and counts. Real text fields (run limit, pace WPM) and dialogs keep their keys.
  useEffect(() => {
    const grab = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== 'Backspace') return;
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      const t = e.target;
      if (t?.closest?.('.dialog')) return;
      const tag = t?.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type)) return;
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // keyboard button activation stays
      el.focus();
    };
    document.addEventListener('keydown', grab, true);
    return () => document.removeEventListener('keydown', grab, true);
  }, []);

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
    if (racerRef.current) { racerRef.current.stop(); racerRef.current = null; }
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
      keys: { ...s.keys },        // per-key attempts+errors → the Typing Progress heatmap
      consistency: consistencyPct(intervalsRef.current), // keystroke-rhythm % (null on tiny runs)
      tier: netTier(net),
      grade: letterGrade(net),
      device: deviceKind(), // 'Mobile' | 'Desktop' — which device this run was typed on
      mode: gameMode,       // which typing mode/drill this run used
      raced: racedRef.current,    // was this a voice race
      caught: caughtRef.current,  // did the voice catch you
      trend: trendRef.current,    // per-half-second samples for the results chart (not persisted)
    };
    // Problem words (missed or unusually slow) → the 🎯 review drill; PBs judged against history.
    run.problemWords = problemWords(passage, resultsRef.current);
    run.pb = pbFlags(pastRunsRef.current || [], run);
    pastRunsRef.current = [...(pastRunsRef.current || []), run];
    setSummary(run);
    setPhase('done');
    onSaveRun?.(run);
    if (endFanfare) playGradeSound(run.grade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, doc, onSaveRun, gameMode, endFanfare, passage]);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => endRun(), IDLE_END_MS);
  }, [endRun]);

  // Run timer / live sampling. Burst WPM = your rate over just the trailing ~2s window — the
  // "how fast are my fingers right now" line, vs gross (raw) and net (effective) over the run.
  useEffect(() => {
    if (phase !== 'running') return undefined;
    tickTimer.current = setInterval(() => {
      const m = metrics();
      const now = Date.now();
      const snaps = snapsRef.current;
      snaps.push({ ts: now, chars: stats.current.chars });
      while (snaps.length > 1 && snaps[0].ts < now - 2200) snaps.shift();
      const dt = (now - snaps[0].ts) / 1000;
      const burst = dt >= 0.4 ? ((stats.current.chars - snaps[0].chars) / 5) / (dt / 60) : 0;
      setTick((n) => n + 1);
      setTrend((tr) => {
        const next = [...tr.slice(-600), { t: m.secs, gross: m.gross, net: m.net, acc: m.acc, burst }];
        trendRef.current = next;
        return next;
      });
      // 👻 pace ghost: where a steady paceWpmVal typist would be by now.
      if (paceWpmVal > 0) setPacePos(paceWordIndex(paceCum, paceChars(paceWpmVal, m.secs)));
      if (mode !== 'endless' && mode !== 'words' && m.secs >= effLimitSecs) endRun();
    }, 500);
    return () => { if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; } };
  }, [phase, mode, effLimitSecs, metrics, endRun, paceWpmVal, paceCum]);

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
  // active word moves to a new visual line, so the text doesn't jitter per word). In TICKER mode
  // the passage is one horizontal line instead: pin the active word's left edge ~35% in and slide
  // the whole line left as words commit (same transition, horizontal).
  useLayoutEffect(() => {
    const lines = linesRef.current;
    const active = activeRef.current;
    if (!lines || !active) return;
    if (ticker) {
      const hold = (lines.parentElement?.clientWidth || 800) * 0.35;
      lines.style.transform = `translate(${-Math.max(0, active.offsetLeft - hold)}px, 0px)`;
      return;
    }
    if (!lineH.current) {
      const lh = parseFloat(getComputedStyle(lines).lineHeight);
      lineH.current = isFinite(lh) && lh > 0 ? lh : 40;
    }
    const lineIdx = Math.round(active.offsetTop / lineH.current);
    lines.style.transform = `translateY(${-Math.max(0, lineIdx - 1) * lineH.current}px)`;
  }, [pos, buf, ticker]);

  // Floating cursor (monkeytype-style): a single absolutely-positioned bar that GLIDES to the
  // zero-width anchor rendered at the typing position, instead of a caret that pops per keystroke.
  // Uses layout offsets + the FINAL line-scroll translate — client rects are mid-transition here
  // (the passage scroll animates), so a rect-based target would land on a moving line.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    const lines = linesRef.current;
    const anchor = activeRef.current?.querySelector('.caret-anchor');
    if (!caret || !lines || !anchor) return;
    const t = lines.style.transform || '';
    const my = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(t);
    const mx = /translate\((-?\d+(?:\.\d+)?)px/.exec(t); // ticker's horizontal slide
    const shiftY = my ? parseFloat(my[1]) : 0;
    const shiftX = mx ? parseFloat(mx[1]) : 0;
    const fs = parseFloat(getComputedStyle(lines).fontSize) || 26;
    // The anchor's CSS box (1.12em, dipped below the baseline) IS the caret's geometry. Its
    // offsetParent is .tr-lines directly — the inline-block word is NOT positioned, so it never
    // becomes an offset ancestor (adding word offsets here would double-count).
    caret.style.height = `${anchor.offsetHeight || Math.round(fs * 1.1)}px`;
    caret.style.transform = `translate(${anchor.offsetLeft + shiftX}px, ${anchor.offsetTop + shiftY + lines.offsetTop}px)`;
  }, [pos, buf, phase, oneWord, ticker]);

  function stopRace() { racerRef.current?.stop(); racerRef.current = null; }
  // Start the voice racer: it reads the passage aloud and reports the word it's speaking. You're
  // "caught" the instant the voice is on a word PAST the one you're typing. The 400ms grace gives a
  // fair head start and ignores an immediate onerror (so a missing/broken voice can't insta-catch you).
  // ponytail: needs word-boundary events; voices that don't emit them just never advance (you win).
  function startRace() {
    stopRace();
    if (typeof window === 'undefined' || !window.speechSynthesis) { racedRef.current = false; return; }
    voiceRef.current = 0; setVoicePos(0); caughtRef.current = false; racedRef.current = true;
    raceStartRef.current = Date.now();
    const racer = createReadAloud({
      getWords: () => passage,
      getIndex: () => voiceRef.current,
      setIndex: (wi) => {
        voiceRef.current = wi; setVoicePos(wi);
        if (wi > posRef.current && Date.now() - raceStartRef.current > 400) { caughtRef.current = true; endRun(); }
      },
      getVoiceName: () => settings.annunciateVoice,
      getRate: () => rateFromIndex(settings.annunciateRate || 0),
      onEnd: () => {}, // voice reached the end without passing you — you outran it
    });
    racerRef.current = racer;
    racer.start();
  }

  function start() {
    stats.current = freshStats();
    stats.current.start = Date.now();
    wordErrors.current = 0;
    seg.current = { line: true, sent: true, para: true };
    setPhase('running');
    setTrend([]);
    trendRef.current = [];
    snapsRef.current = [];
    armIdle();
    if (raceVoice) startRace();
  }

  const clearCount = () => { countTimers.current.forEach(clearTimeout); countTimers.current = []; };

  // Run starts on an explicit "Start" (or a done-screen "Onward/Reattempt") with a Ready·Set·Go.
  // Focus the input synchronously inside the originating tap so the mobile keyboard opens during the
  // count and is ready the instant we hit "Go!".
  // Clear all per-run state back to the start of the passage.
  function resetRunState() {
    clearCount();
    stopRace(); setVoicePos(-1); voiceRef.current = 0; caughtRef.current = false; racedRef.current = false;
    setPos(0); setBuf(''); setResults([]); setSummary(null); setTrend([]);
    stats.current = freshStats(); wordErrors.current = 0; lastGiRef.current = null;
    resultsRef.current = []; intervalsRef.current = []; lastKeyTsRef.current = 0; wordStartRef.current = 0;
    setPacePos(-1);
    seg.current = { line: true, sent: true, para: true };
    if (linesRef.current) linesRef.current.style.transform = 'translateY(0)';
  }

  function beginCountdown() {
    resetRunState();
    setPhase('countdown');
    setCount('Ready');
    focus();
    countTimers.current = [
      setTimeout(() => setCount('Set'), 600),
      setTimeout(() => setCount('Go!'), 1200),
      setTimeout(() => { setCount(null); start(); focus(); }, 1700),
    ];
  }

  // Stage a run without starting it: reset and show the passage idle. It begins on the first
  // keystroke (or ▶ Start) — so Onward / Reattempt don't jump straight into a countdown.
  function stageRun() {
    resetRunState();
    setPhase('idle');
    focus();
  }

  useEffect(() => () => { clearCount(); racerRef.current?.stop(); }, []); // clear timers / silence voice on unmount

  // Fresh drill text (no-op for the document passage mode), staged not started — used on mode change.
  function reattempt() {
    setSeed((s) => s + 1);
    stageRun();
  }

  // Advance to the passage beginning where the just-finished run stopped (passage mode walks forward
  // through the book; drills get fresh text), then stage it — the user starts it when ready.
  function nextRun() {
    // Resume at the doc word after the last one committed (exact even with bypassed symbol tokens).
    if (isDocMode) {
      const next = lastGiRef.current != null ? lastGiRef.current + 1 : startIndex.current + stats.current.words;
      startIndex.current = Math.min(doc.words.length, next);
    }
    setSeed((s) => s + 1); // force passage rebuild (doc: from the new startIndex; drill: fresh text)
    stageRun();
  }

  function commitWord(typed = buf) {
    const target = passage[pos] || '';
    // One-word mode gates advancement on an exact match (case rule applied). A wrong word stays put:
    // clear the buffer and let them retype. A mistyped-then-fixed word still matches, so it advances.
    if (oneWord) {
      const exact = typed.length === target.length && [...typed].every((c, j) => charOk(c, target[j]));
      if (!exact) { ping(sounds.wordError); wordErrors.current = 0; setBuf(''); return; }
      wordErrors.current = 0; // matched exactly → counts as perfect even if chars were corrected
    }
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
    lastGiRef.current = prepared[pos]?.gi ?? lastGiRef.current;
    // Per-word time (first char → commit) feeds the problem-word mining ("unusually slow" words).
    const ms = wordStartRef.current ? Date.now() - wordStartRef.current : 0;
    wordStartRef.current = 0;
    const entry = { typed, perfect, ms };
    resultsRef.current = [...resultsRef.current, entry];
    setResults((r) => [...r, entry]);
    setBuf('');
    const nextPos = pos + 1;
    setPos(nextPos);
    if (mode === 'words' && s.words >= limit) { endRun(); return; }
    if (nextPos >= passage.length) { endRun(); }
  }

  // Monkeytype-style: Backspace at the START of the current word reopens the PREVIOUS word so you can
  // fix and retry it — its committed result is dropped and its typed text restored into the buffer.
  // ponytail: char stats aren't rewound (same "every keystroke counts" model as retyping within a
  // word); the word/perfect tally IS rewound so the run count stays right. Off in one-word mode.
  function goBackWord() {
    const prevPos = pos - 1;
    if (prevPos < 0) return;
    const prev = results[prevPos];
    setResults((r) => r.slice(0, prevPos));
    resultsRef.current = resultsRef.current.slice(0, prevPos);
    setPos(prevPos);
    posRef.current = prevPos;
    setBuf(prev?.typed ?? '');
    wordStartRef.current = Date.now(); // the reopened word's clock restarts
    const s = stats.current;
    s.words = Math.max(0, s.words - 1);
    if (prev?.perfect) s.perfect = Math.max(0, s.perfect - 1);
    wordErrors.current = 0;
    lastGiRef.current = prevPos - 1 >= 0 ? (prepared[prevPos - 1]?.gi ?? null) : null;
  }

  // Score the characters of `str` from index `fromLen` onward against the current target word.
  // Also feeds the rhythm clock (inter-key intervals → consistency %), the per-key profile
  // (attempts + errors per target key → the Typing Progress heatmap), and the per-word timer.
  function scoreChars(fromLen, str) {
    const s = stats.current;
    const target = passage[pos] || '';
    if (str.length > fromLen) {
      const now = Date.now();
      if (lastKeyTsRef.current) intervalsRef.current.push(now - lastKeyTsRef.current);
      lastKeyTsRef.current = now;
      if (fromLen === 0 && !wordStartRef.current) wordStartRef.current = now;
    }
    for (let p = fromLen; p < str.length; p++) {
      const ch = target[p];
      s.chars += 1;
      const key = ch ? (caseSensitive ? ch : ch.toLowerCase()) : null;
      const kk = key ? (s.keys[key] ||= { n: 0, err: 0 }) : null;
      if (kk) kk.n += 1;
      if (ch !== undefined && charOk(str[p], ch)) {
        s.correct += 1;
        ping(sounds.charCorrect);
      } else {
        s.errors += 1;
        wordErrors.current += 1;
        ping(sounds.charWrong);
        if (kk) kk.err += 1;
        if (key) s.errorKeys[key] = (s.errorKeys[key] || 0) + 1;
      }
    }
  }

  // Ghost punctuation typed FOR REAL is accepted: the drill auto-skips ghosts, but a user who
  // types one anyway gets a correct keystroke, absorbed out of the buffer so the target text is
  // untouched. Ghost chars are punctuation and targets are letters/numbers under noSpecial, so the
  // two sets can never collide. Runs before stop-on-error, which would otherwise refuse the key.
  function absorbGhosts(val) {
    if (!noSpecial || !wantGhosts || val.length <= buf.length) return val;
    const orig = prepared[pos]?.orig;
    const w = passage[pos] || '';
    if (!orig || !cellsFor(orig, w, { bypassSym, noSpecial, wantCaps, wantGhosts })) return val; // alignment invariant failed → plain scoring
    let out = buf;
    for (let p = buf.length; p < val.length; p++) {
      const ch = val[p];
      if (!/\s/.test(ch) && ghostCharsAt(orig, out.length, { bypassNonQwerty: bypassSym }).has(ch)) {
        const s = stats.current;
        s.chars += 1; s.correct += 1;
        ping(sounds.charCorrect);
        continue; // accepted and absorbed — never lands in the buffer
      }
      out += ch;
    }
    return out;
  }

  // Letters, space (commit) and backspace flow through the input's value here instead of keydown so
  // that mobile soft keyboards work — many of them don't emit usable keydown events (key:"Unidentified",
  // keyCode 229). The input holds the in-progress word (value={buf}); we diff each change. Enter and
  // Escape stay on keydown since a single-line input doesn't surface them as value changes.
  // Stop-on-error: refuse the first wrong key of an input event — it still costs an error (and a
  // per-key mark against the TARGET letter), but never enters the buffer, so the buffer is always
  // a correct prefix. Returns the accepted value.
  function refuseWrong(val) {
    const target = passage[pos] || '';
    let accept = buf;
    for (let p = buf.length; p < val.length; p++) {
      if (/\s/.test(val[p])) { accept += val[p]; break; } // space flows to the commit path
      if (charOk(val[p], target[p])) { accept += val[p]; continue; }
      const s = stats.current;
      s.chars += 1;
      s.errors += 1;
      wordErrors.current += 1;
      ping(sounds.charWrong);
      const ch = target[p];
      if (ch) {
        const k = caseSensitive ? ch : ch.toLowerCase();
        s.errorKeys[k] = (s.errorKeys[k] || 0) + 1;
        const kk = (s.keys[k] ||= { n: 0, err: 0 });
        kk.n += 1;
        kk.err += 1;
      }
      break; // drop the wrong key and anything after it in this event
    }
    return accept;
  }

  function onChange(e) {
    let val = e.target.value;
    if (phase !== 'running') {
      // Typing the first letter starts the run from idle (monkeytype-style), and mid-countdown it
      // skips the rest of the Ready·Set·Go — the ▶ Start button and just-typing both always work.
      if ((phase === 'idle' || phase === 'countdown') && val.trim()) {
        if (phase === 'countdown') { clearCount(); setCount(null); }
        val = val.trim();
        start();
      } else if (phase === 'done' && val.trim()) {
        // Typing on the results screen stages the next run (onward through the book when there's
        // more ahead, else the same passage) — then keep typing to begin it.
        if (moreAhead) nextRun(); else stageRun();
        return;
      } else {
        if (buf) setBuf('');
        return;
      }
    }
    val = absorbGhosts(val); // typed ghost punctuation → accepted + absorbed before any scoring
    // Confidence mode: no corrections — a shrinking value (backspace/autocorrect) is ignored and
    // the controlled input snaps back to the buffer.
    if (confidence && val.length < buf.length) return;
    if (stopOnError && val.length > buf.length) val = refuseWrong(val);
    const sp = val.search(/\s/);
    if (sp >= 0) {
      const typed = val.slice(0, sp);
      // Stop-on-error also refuses an EARLY space: the word must be complete before it commits.
      // The correct chars typed in this same event still score before the space is dropped.
      if (stopOnError && typed.length < (passage[pos] || '').length) {
        scoreChars(buf.length, typed);
        ping(sounds.charWrong);
        setBuf(typed);
        armIdle();
        return;
      }
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
      if (phase === 'running') {
        // A single stray Esc must not kill a run in flight — arm, and only a second Esc within
        // the window ends it (the armed hint shows). Progress is never lost either way: the run
        // saves on end, and even a discard credits the typed words as read.
        const now = Date.now();
        if (now - escArmRef.current < 2500) { escArmRef.current = 0; setEscArmed(false); endRun(); }
        else { escArmRef.current = now; setEscArmed(true); clearTimeout(escArmTimer.current); escArmTimer.current = setTimeout(() => setEscArmed(false), 2500); }
        return;
      }
      onExitDiscard?.(discardCreditWi());
      return;
    }
    // Confidence mode: backspace is off entirely — within the word AND back into the previous one.
    if (confidence && e.key === 'Backspace' && phase === 'running') {
      e.preventDefault();
      ping(sounds.charWrong);
      return;
    }
    if (e.key === 'Backspace' && phase === 'running' && !oneWord && !e.target.value && pos > 0) {
      // Empty buffer + Backspace → step back a word (the input value is the live source of truth).
      e.preventDefault();
      goBackWord();
      armIdle();
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

  // The doc-word frontier actually typed this session. A discarding exit (Esc, the Discard
  // button) passes it up so App can still CREDIT the typed words as read — only the reading
  // position stays put. Quitting never throws typed progress away.
  const discardCreditWi = () => (isDocMode && stats.current.words > 0
    ? (lastGiRef.current != null ? lastGiRef.current + 1 : startIndex.current + stats.current.words)
    : undefined);

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

  // ── Options sidebar: toggle tiles (idle/done only — config never shifts mid-run) ──
  const patchCfg = (p) => onPatch?.({ typing: { ...cfg, ...p } });
  const sideVisible = phase !== 'running' && phase !== 'countdown' && !plan;
  // Tri-state cycles: punctuation shown → hidden → dim auto-skipped ghosts; case as-written →
  // all-lowercase → lowercase-but-capitals-shown. Required typing is identical for the display-only states.
  const punctState = !noSpecial ? 'shown' : wantGhosts ? 'ghosts 👻' : 'hidden';
  const cyclePunct = () => patchCfg(!noSpecial
    ? { noSpecial: true, ghostSpecials: false }
    : !wantGhosts ? { noSpecial: true, ghostSpecials: true } : { noSpecial: false });
  const caseState = !lowercase ? 'as written' : wantCaps ? 'lower · Aa shown' : 'lowercase';
  const cycleCase = () => patchCfg(!lowercase
    ? { lowercase: true, showCaps: false }
    : !wantCaps ? { lowercase: true, showCaps: true } : { lowercase: false });
  const paceState = paceMode === 'off' ? 'off' : paceMode === 'last' ? 'last run' : paceMode === 'pb' ? 'personal best' : `custom · ${cfg.paceWpm ?? 60} wpm`;
  const cyclePace = () => patchCfg({ pace: { off: 'last', last: 'pb', pb: 'custom', custom: 'off' }[paceMode] || 'off' });

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
          {settings.showEyes && (() => {
            // The avatar joins the typing screen (SVG renderer — this overlay sits above the shared
            // WebGL canvas). Its EYES grade the live net WPM against consensus typing standards:
            // gray beginner → green → cyan → blue → purple → gold → fire at 110+.
            const eye = typingEyeColor(live.net);
            return (
              <div className="tr-avatar" title={`Eye colour = how impressive the pace is (consensus WPM tiers) — currently ${eye.tier}`}>
                <Avatar
                  forceSvg size={52}
                  wpm={Math.max(200, live.net * 4)}
                  lineProgress={0.5}
                  faceStyle={(settings.faceStyles || [])[0] || 'Man'}
                  artStyle={settings.artStyle || 'Cartoon'}
                  activity="typing"
                  stage={phase === 'idle' ? 'drowsy' : 'awake'}
                  irisOverride={eye.color}
                  hands={!!settings.avatarHands}
                />
              </div>
            );
          })()}
          <Stat v={live.net} l="net wpm" hero />
          <Stat v={live.gross} l="gross wpm" />
          <Stat v={`${live.acc}%`} l="accuracy" />
          <Stat v={progressLabel} l="run" />
          {phase === 'running' && paceWpmVal > 0 && <Stat v={paceWpmVal} l="👻 pace" />}
        </div>
        <div className="tr-controls">
          {phase !== 'running' && !plan && (
            <>
              <select
                value={gameMode}
                title="Typing mode — Passage types your book; the rest are drills"
                onChange={(e) => { setGameMode(e.target.value); if (e.target.value !== 'review') onPatch?.({ typing: { ...cfg, mode: e.target.value } }); reattempt(); }}
              >
                {TYPING_MODES.filter((tm) => tm.id !== 'review' || reviewRef.current.length > 0).map((tm) => <option key={tm.id} value={tm.id}>{tm.label}</option>)}
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
            : <button onClick={() => onExitDiscard?.(discardCreditWi())} title="Close typing — anything you typed still counts as read; only the reading position stays put">{plan ? 'Exit plan' : 'Discard'}</button>}
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

      <div className="tr-body">
        {sideVisible && (
          <aside className="tr-side" aria-label="Typing options">
            <div className="tt-group">Text</div>
            <Tile icon="#" label="Punctuation" state={punctState} on={noSpecial} onClick={cyclePunct}
              title="Cycle: shown → hidden → dim auto-skipped ghosts. Ghosts are never required — but typing one anyway is accepted, never an error." />
            <Tile icon="Aa" label="Case" state={caseState} on={lowercase} onClick={cycleCase}
              title="Cycle: as written → all lowercase → lowercase but capitals SHOWN (typing lowercase still counts)" />
            {isDocMode && (
              <Tile icon="¶" label="Line breaks" state={cfg.showBreaks ? 'book layout' : 'flowing wall'} on={!!cfg.showBreaks}
                onClick={() => patchCfg({ showBreaks: !cfg.showBreaks })} disabled={oneWord || !!cfg.ticker}
                title="Show the book's own line and paragraph breaks — visual only, the words you type are identical" />
            )}
            <Tile icon="📟" label="Ticker" state={cfg.ticker ? 'single line' : 'off'} on={!!cfg.ticker}
              onClick={() => patchCfg({ ticker: !cfg.ticker })} disabled={oneWord}
              title="Show the passage as one horizontal ticker line — the active word holds a fixed point while committed words stream off to the left" />
            <div className="tt-group">Discipline</div>
            <Tile icon="①" label="One word" state={oneWord ? 'on' : 'off'} on={oneWord}
              onClick={() => patchCfg({ oneWord: !oneWord })}
              title="One word at a time — each word must be typed perfectly to advance" />
            <Tile icon="🛑" label="Stop on error" state={stopOnError ? 'on' : 'off'} on={stopOnError}
              onClick={() => patchCfg({ stopOnError: !stopOnError })}
              title="A wrong key is refused (it still costs an error), and space only commits a complete word — the classic accuracy-discipline mode" />
            <Tile icon="⌫" label="No backspace" state={confidence ? 'on' : 'off'} on={confidence}
              onClick={() => patchCfg({ confidence: !confidence })}
              title="Confidence mode — backspace is disabled entirely; errors cost accuracy, not time" />
            <Tile icon="🙈" label="Blind" state={blind ? 'on' : 'off'} on={blind}
              onClick={() => patchCfg({ blind: !blind })}
              title="No per-character verdicts while you type — trust your fingers and let the numbers tell the tale at the end" />
            <div className="tt-group">Extras</div>
            <Tile icon="🏁" label="Race voice" state={raceVoice ? 'on' : 'off'} on={raceVoice}
              onClick={() => patchCfg({ raceVoice: !raceVoice })}
              title="The TTS voice reads the passage aloud; if it passes the word you're typing, you're caught. Lower the read-aloud rate in Settings to make it easier." />
            <Tile icon="👻" label="Pace ghost" state={paceState} on={paceMode !== 'off'} onClick={cyclePace}
              title="A marker moves through the passage at a steady speed (your last run, your best, or a custom WPM) — try to stay ahead of it. Click to cycle." />
            {paceMode === 'custom' && (
              <input className="tt-wpm" type="number" min={10} max={400} value={cfg.paceWpm ?? 60}
                onChange={(e) => patchCfg({ paceWpm: Math.max(10, Math.min(400, Number(e.target.value) || 60)) })}
                title="Pace ghost speed (WPM)" aria-label="Pace ghost speed (WPM)" />
            )}
            <Tile icon="📋" label="Error log" state={cfg.errorLog ? 'on' : 'off'} on={!!cfg.errorLog}
              onClick={() => patchCfg({ errorLog: !cfg.errorLog })}
              title="A separate area listing every error entry as it happens — the target word vs what you actually typed" />
          </aside>
        )}
        <div className="tr-main">
      <Trend trend={trend} />

      {/* The passage hides on the done screen so the results (chart included) get the room —
          otherwise they overflow beneath the bottom dock, which also swallows chart hovers. */}
      <div className={`tr-viewport${ticker ? ' ticker-vp' : ''}`} style={{ display: phase === 'done' ? 'none' : undefined, ...(settings.fontFamily ? { fontFamily: settings.fontFamily } : null) }}>
        {phase === 'countdown' && <div className="tr-countdown" key={count} aria-live="assertive">{count}</div>}
        {escArmed && phase === 'running' && <div className="tr-esc-hint" role="status">Esc again to end the run</div>}
        <div className={`tr-cursor${phase === 'running' ? '' : ' waiting'}`} ref={caretRef} style={{ opacity: phase === 'done' ? 0 : 1 }} />
        <div className={`tr-lines${oneWord ? ' one-word' : ''}${blind ? ' blind' : ''}${ticker ? ' ticker' : ''}`} ref={linesRef}>
          {passage.map((w, i) => {
            if (oneWord && i !== pos) return null; // one-word mode shows only the current word
            if (i > pos + PENDING_WINDOW) return null; // far tail is below the fold — skip its DOM
            if (ticker && i < pos - 12) return null; // ticker: far-committed words have slid off left
            const vc = (i === voicePos ? ' voice' : '') // word the racing voice is speaking…
              + (i === pacePos && phase === 'running' && paceWpmVal > 0 ? ' pace' : ''); // …and the 👻 ghost's word
            // Display-only extras: fully-skipped decorative tokens ahead of this word render as
            // ghost words, and the book's own line breaks can show — the typed words are identical.
            const preEl = wantGhosts && !oneWord && prepared[i]?.pre
              ? <span className="trw ghostw">{prepared[i].pre.join(' ')} </span> : null;
            const brkEl = showBreaks && segEnds
              ? (segEnds.para[i] ? <><br /><br /></> : segEnds.line[i] ? <br /> : null) : null;
            let wordEl;
            if (i < pos) {
              // Committed words keep their per-character verdict (monkeytype-style): what you
              // actually typed stays visible — wrong chars, chars you never typed, and (capped)
              // extra chars beyond the word.
              const r = results[i];
              wordEl = <CommittedWord w={w} orig={prepared[i]?.orig} typed={r?.typed ?? w} perfect={!r || !!r.perfect} vc={vc} caseSensitive={caseSensitive} bypassSym={bypassSym} noSpecial={noSpecial} wantCaps={wantCaps} wantGhosts={wantGhosts} />;
            } else if (i > pos) {
              wordEl = <PendingWord w={w} orig={prepared[i]?.orig} vc={vc} bypassSym={bypassSym} noSpecial={noSpecial} wantCaps={wantCaps} wantGhosts={wantGhosts} />;
            } else {
              // Active word — per-char colouring + a zero-width caret anchor the floating cursor
              // tracks. Overtyped chars render capped so the word can't balloon past the line slack.
              const shownBuf = buf.length > w.length + OVERTYPE_MAX ? buf.slice(0, w.length + OVERTYPE_MAX) : buf;
              const chars = [];
              const cells = cellsFor(prepared[i]?.orig, w, { bypassSym, noSpecial, wantCaps, wantGhosts });
              if (cells) {
                let anchored = false;
                cells.forEach((c, ci) => {
                  if (c.t == null) { chars.push(<span key={`g${ci}`} className="trc ghost">{c.ch}</span>); return; }
                  if (c.t === shownBuf.length) { chars.push(<span key={`k${ci}`} className="trc caret-anchor" />); anchored = true; }
                  const typedHere = c.t < shownBuf.length;
                  const cls = !typedHere ? 'trc pending'
                    : charOk(shownBuf[c.t], w[c.t]) ? 'trc correct' : 'trc wrong';
                  chars.push(<span key={ci} className={cls}>{wantCaps ? c.ch : w[c.t]}</span>);
                });
                for (let j = w.length; j < shownBuf.length; j++) chars.push(<span key={`x${j}`} className="trc extra">{shownBuf[j]}</span>);
                if (!anchored) chars.push(<span key="ce" className="trc caret-anchor" />);
              } else {
                const len = Math.max(w.length, shownBuf.length);
                for (let j = 0; j < len; j++) {
                  if (j === shownBuf.length) chars.push(<span key={`k${j}`} className="trc caret-anchor" />);
                  const typed = j < shownBuf.length;
                  const cls = !typed ? 'trc pending'
                    : j >= w.length ? 'trc extra'
                      : charOk(shownBuf[j], w[j]) ? 'trc correct' : 'trc wrong';
                  chars.push(<span key={j} className={cls}>{j >= w.length ? shownBuf[j] : w[j]}</span>);
                }
                if (shownBuf.length >= len) chars.push(<span key="ce" className="trc caret-anchor" />);
              }
              wordEl = <span className={`trw active${vc}`} ref={activeRef}>{chars}{' '}</span>;
            }
            return <Fragment key={i}>{preEl}{wordEl}{brkEl}</Fragment>;
          })}
        </div>
      </div>

      {phase === 'idle' && <div className="tr-hint">Just start typing — the run begins on your first letter (or press ▶ Start for a Ready·Set·Go). It ends at your limit, on “End run”, or after 5s idle. Esc discards.</div>}

      {/* Error log: every imperfect commit as target → typed, wrong/missed chars marked. Live while
          running (hidden in blind mode until the end), and kept on the done screen for review. */}
      {cfg.errorLog && phase !== 'idle' && phase !== 'countdown' && (!blind || phase === 'done') && (() => {
        const entries = results
          .map((r, i) => ({ i, target: passage[i] || '', typed: r?.typed ?? '', perfect: !r || !!r.perfect }))
          .filter((e) => !e.perfect);
        return (
          <div className="tr-errlog">
            <div className="tr-errlog-head">📋 Errors · {entries.length}</div>
            {entries.length === 0
              ? <div className="tr-errlog-empty">none yet — clean so far</div>
              : (
                <div className="tr-errlog-list">
                  {entries.map((e) => {
                    const fixed = e.typed.length === e.target.length && [...e.typed].every((c, j) => charOk(c, e.target[j]));
                    return (
                      <div key={e.i} className="tr-err-row">
                        <span className="tr-err-target">{e.target}</span>
                        <span className="tr-err-arrow">→</span>
                        <span className="tr-err-typed">
                          {[...e.typed].map((ch, j) => (
                            <span key={j} className={j < e.target.length && charOk(ch, e.target[j]) ? 'trc correct' : 'trc wrong'}>{ch}</span>
                          ))}
                          {e.typed.length < e.target.length && <span className="trc missed">{e.target.slice(e.typed.length)}</span>}
                          {fixed && <span className="tr-err-fixed">(corrected)</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        );
      })()}

      {phase === 'done' && summary && (
        <div className="tr-results">
          {endFanfare && summary.grade && (
            <div className={`tr-grade tr-grade-${summary.grade}`}>
              <span className="tr-grade-letter">{summary.grade}</span>
              <span className="tr-grade-statement">{GRADE_STATEMENTS[summary.grade]}</span>
            </div>
          )}
          {summary.raced && (
            <div className={`tr-race-result${summary.caught ? ' caught' : ''}`}>
              {summary.caught ? '🔊 The voice caught you!' : '🏁 You outran the voice!'}
            </div>
          )}
          {(summary.pb?.allTime || summary.pb?.mode) && (
            <div className="tr-pb">
              {summary.pb.allTime ? '🏆 New all-time personal best!' : `🥇 New personal best for ${TYPING_MODE_BY_ID[summary.mode]?.label || 'this mode'}!`}
            </div>
          )}
          <div className="tr-results-head">
            <strong>{summary.netWpm} net WPM</strong> · {summary.grossWpm} gross · {summary.accuracy}% acc
            {summary.consistency != null ? ` · ${summary.consistency}% consistency` : ''} · {summary.tier}
          </div>
          {(() => {
            const stk = typingStreak(pastRunsRef.current || [], Date.now());
            return stk.days > 0 && (
              <div className="tr-streak">
                🔥 {stk.days}-day typing streak · {stk.todayWords.toLocaleString()} words today
              </div>
            );
          })()}
          <RunChart trend={summary.trend} />
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
                {summary.problemWords?.length >= 3 && (
                  <button
                    onClick={() => { reviewRef.current = summary.problemWords; setGameMode('review'); reattempt(); }}
                    title="A quick drill built from this run's missed and unusually slow words"
                  >
                    🎯 Drill the misses ({summary.problemWords.length})
                  </button>
                )}
                <button className={moreAhead ? '' : 'toggle-on'} onClick={stageRun} title="Re-type the exact same passage (starts when you type)">↻ Reattempt</button>
                {isDocMode && (
                  <button onClick={() => onExitContinue?.(lastGiRef.current != null ? lastGiRef.current + 1 : startIndex.current + stats.current.words)}>Continue (count as read)</button>
                )}
                <button onClick={() => onExitDiscard?.(discardCreditWi())} title={isDocMode ? 'Close typing — the typed words still count as read; only the reading position stays put' : undefined}>{isDocMode ? 'Discard' : 'Exit'}</button>
              </>
            )}
          </div>
        </div>
      )}

      {sessionRuns && sessionRuns.length > 0 && (
        <div className="tr-killfeed" title="Typing runs this session">
          <span className="tr-kf-label">🏁 Runs:</span>
          {sessionRuns.map((r, i) => (
            <span key={i} className="tr-kf-item">{r.netWpm}wpm · {r.accuracy}% <span className="tr-kf-ts">{fmtTime(r.ts, true)}</span></span>
          ))}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

// One option tile in the typing sidebar: icon, label, and a small caption naming the current
// state — a plain on/off for toggles, the active mode for tri-state cycle tiles.
function Tile({ icon, label, state, on, onClick, title, disabled }) {
  return (
    <button type="button" className={`tt-tile${on ? ' on' : ''}`} title={title} aria-pressed={!!on}
      onClick={onClick} disabled={disabled}>
      <span className="tt-ico" aria-hidden="true">{icon}</span>
      <span className="tt-txt">
        <span className="tt-lbl">{label}</span>
        <span className="tt-state">{state}</span>
      </span>
    </button>
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

// Monkeytype-style results chart: raw (gross), effective (net) and burst WPM over the run, with
// accuracy overlaid on a 0–100 scale. Move the mouse (or finger) across it to inspect the exact
// values at any moment of the run.
function RunChart({ trend }) {
  const [hover, setHover] = useState(null); // nearest sample index
  const svgRef = useRef(null);
  if (!trend || trend.length < 3) return null;
  const W = 760;
  const H = 210;
  const PAD = { l: 38, r: 12, t: 12, b: 20 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const maxT = trend[trend.length - 1].t || 1;
  const maxW = Math.max(60, ...trend.map((p) => Math.max(p.gross || 0, p.net || 0, p.burst || 0))) * 1.06;
  const x = (t) => PAD.l + (t / maxT) * iw;
  const yW = (v) => PAD.t + ih - Math.min(1, Math.max(0, v) / maxW) * ih;
  const yA = (v) => PAD.t + ih - (Math.min(100, v) / 100) * ih;
  const path = (key, yFn) => trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${yFn(p[key] || 0).toFixed(1)}`).join(' ');
  const wStep = maxW > 240 ? 100 : maxW > 120 ? 50 : 25;
  const wTicks = [];
  for (let v = wStep; v < maxW; v += wStep) wTicks.push(v);

  function onMove(e) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const t = ((e.clientX - r.left) / r.width * W - PAD.l) / iw * maxT;
    let best = 0;
    for (let i = 1; i < trend.length; i++) if (Math.abs(trend[i].t - t) < Math.abs(trend[best].t - t)) best = i;
    setHover(best);
  }
  const h = hover != null ? trend[hover] : null;

  return (
    <div className="tr-chart-wrap">
      <svg
        ref={svgRef}
        className="tr-chart"
        viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => e.touches[0] && onMove(e.touches[0])}
      >
        {wTicks.map((v) => (
          <g key={v}>
            <line className="trch-grid" x1={PAD.l} x2={W - PAD.r} y1={yW(v)} y2={yW(v)} />
            <text className="trch-label" x={PAD.l - 6} y={yW(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        <text className="trch-label" x={PAD.l} y={H - 6}>0s</text>
        <text className="trch-label" x={W - PAD.r} y={H - 6} textAnchor="end">{Math.round(maxT)}s</text>
        <path d={path('burst', yW)} className="trend-burst" />
        <path d={path('gross', yW)} className="trend-gross" />
        <path d={path('net', yW)} className="trend-net" />
        <path d={path('acc', yA)} className="trend-acc" />
        {h && (
          <g>
            <line className="trch-cursor" x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={PAD.t + ih} />
            <circle className="trch-dot dot-burst" cx={x(h.t)} cy={yW(h.burst || 0)} r={3} />
            <circle className="trch-dot dot-gross" cx={x(h.t)} cy={yW(h.gross || 0)} r={3} />
            <circle className="trch-dot dot-net" cx={x(h.t)} cy={yW(h.net || 0)} r={3} />
          </g>
        )}
      </svg>
      <div className="tr-chart-legend">
        <span className="lg lg-net">effective {h ? Math.round(h.net) : ''}</span>
        <span className="lg lg-gross">raw {h ? Math.round(h.gross) : ''}</span>
        <span className="lg lg-burst">burst {h ? Math.round(h.burst || 0) : ''}</span>
        <span className="lg lg-acc">accuracy {h ? `${h.acc.toFixed(0)}%` : ''}</span>
        <span className="lg lg-t">{h ? `at ${h.t.toFixed(1)}s` : 'hover to inspect'}</span>
      </div>
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
