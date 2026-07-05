import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, useListRef } from 'react-window';
import { ReadStatus, orpIndex, getLineIndex, getParagraphRange } from '../document/readerDocument.js';
import { getTocEntries } from '../document/toc.js';
import { resolveHeadingPack } from '../state/themes.js';
import Pointer from './Pointer.jsx';
import { useReportVisibility } from '../state/useReportVisibility.js';
import { useApp } from '../state/AppContext.jsx';
import { translateText, translateConfigured, cacheKey } from '../features/translateService.js';
import { getCachedTranslation, putCachedTranslation } from '../state/storage.js';

// Reading-pointer feature archived for now (not useful). Flip to true to restore it, and uncomment
// its Settings section in dialogs/SettingsDialog.jsx.
const POINTER_ENABLED = false;
const MAX_BLUR_PX = 5; // "fully blurred" — text at this blur is unreadable (feeds the blur gradient)

function stripPunct(w) {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

// Combinable current-word highlight styles, with back-compat for the old single string.
function currentWordStyles(settings) {
  if (Array.isArray(settings.currentWordStyles)) return settings.currentWordStyles;
  if (settings.currentWordStyle) return [settings.currentWordStyle];
  return ['Underline'];
}

function renderWords(line, opts) {
  const text = line.text;
  const words = text.split(/(\s+)/);
  let wordIdx = line.startWordIndex;
  const elems = [];
  let runIdx = 0;
  for (const tok of words) {
    if (tok === '' || /^\s+$/.test(tok)) {
      elems.push(<span key={runIdx++}>{tok}</span>);
      continue;
    }
    const isCurrentWord = opts.isCurrent && wordIdx === opts.currentWordIndex;
    const isProperName = opts.properNamesSet && opts.properNamesSet.has(stripPunct(tok).toLowerCase());
    let inner;
    if (opts.bionic && !opts.isCurrent) {
      const split = Math.ceil(tok.length / 2);
      inner = (
        <>
          <span className="bionic-bold">{tok.slice(0, split)}</span>
          {tok.slice(split)}
        </>
      );
    } else if (opts.highlightORP && !opts.isCurrent && tok.length >= 2) {
      const o = orpIndex(tok.length);
      inner = (
        <>
          {tok.slice(0, o)}
          <span className="orp-char">{tok[o]}</span>
          {tok.slice(o + 1)}
        </>
      );
    } else {
      inner = tok;
    }
    const hidden = wordIdx > opts.hideBeyond;
    const styleClasses = isCurrentWord && Array.isArray(opts.currentWordStyles)
      ? opts.currentWordStyles.map((st) => `style-${st}`)
      : [];
    const cls = [
      'word',
      isCurrentWord ? 'current' : '',
      ...styleClasses,
      isProperName ? 'proper-name' : '',
      hidden ? 'hidden-word' : '',
    ].filter(Boolean).join(' ');
    elems.push(<span key={runIdx++} className={cls}>{inner}</span>);
    wordIdx++;
  }
  return elems;
}

function statusForLine(li, ctx) {
  if (li === ctx.currentLine) return ReadStatus.Current;
  if (li < ctx.currentLine) {
    if (ctx.sessionNavLines.has(li)) return ReadStatus.NavSessionRead;
    if (ctx.sessionLines.has(li)) return ReadStatus.SessionRead;
    if (ctx.readLines.has(li)) return ReadStatus.Read;
  }
  return ReadStatus.Unread;
}

// Presentational single line — shared by the virtualized list (Row) and the split view.
// Has no react-window coupling so it can be rendered directly in the split zones.
// `dsettings` is a STABLE display-settings subset (see LinePane) rather than the whole settings
// object, whose identity changes on every word step; that, plus the memo() comparator below, is
// what keeps unchanged lines from re-rendering on each tick of playback.
function LineRowImpl({ index, doc, dsettings, ctx, propNameKeys, headingMap, headingPack }) {
  const line = doc.lines[index];
  const status = statusForLine(index, ctx);
  const isCurrent = status === ReadStatus.Current;
  const isHF = doc.headerFooterLines.has(index);
  const inPara = index >= ctx.paraStart && index <= ctx.paraEnd && status !== ReadStatus.Current;
  // TOC-heading styling: headingMap (null when disabled) maps line index → tier (0..2). Terminal
  // and retro packs read better left-aligned; the others centre the heading.
  const headLevel = headingMap && headingMap.has(index) ? headingMap.get(index) : -1;
  const isHead = headLevel >= 0;
  const headCenter = isHead && headingPack && headingPack !== 'terminal' && headingPack !== 'retro';

  // Obscure the reading window before/after the current line to discourage excessive backtrack /
  // read-ahead. The current line is the clear "eye of the storm"; for BLUR the effect ramps OUTWARD
  // (lightest next to the eye, heaviest at the window edge — `blurGradient` scales the strength) and
  // lines beyond the window stay clear. Other modes (hide / redact / illegible) obscure the whole
  // window uniformly. Any obscured line also counts as not-readable for scroll-to-read.
  const before = dsettings.blurLinesBefore || 0;
  const after = dsettings.blurLinesAfter || 0;
  const obsMode = dsettings.obscureMode || 'blur';
  const translated = ctx.translations ? ctx.translations.get(index) : undefined; // string | null(failed) | undefined
  let blur = 0;
  let obscureCls = '';
  let showTranslated = false; // obscure-translate: replace the words with their translation
  if (!isCurrent) {
    let d = 0, w = 0;
    if (before && index < ctx.currentLine && ctx.currentLine - index <= before) { d = ctx.currentLine - index; w = before; }
    else if (after && index > ctx.currentLine && index - ctx.currentLine <= after) { d = index - ctx.currentLine; w = after; }
    if (d > 0) {
      if (obsMode === 'blur') {
        const strength = Math.max(0, Math.min(1, (dsettings.blurGradient ?? 100) / 100));
        blur = MAX_BLUR_PX * strength * (d / Math.max(1, w)); // 0 at the eye → strongest at the edge
      } else if (obsMode === 'translate') {
        // Hide the line behind its translation. Until (or unless) one arrives, blur stands in so the
        // original is never flashed at the reader.
        if (typeof translated === 'string' && !line.isEmpty) { showTranslated = true; obscureCls = ' obscure obscure-translate'; }
        else blur = 2.5;
      } else {
        obscureCls = ` obscure obscure-${obsMode}`;
      }
    }
  }
  // Side-by-side translation: every line renders original | translation in two columns.
  const parallel = dsettings.parallelTranslation && !line.isEmpty && !showTranslated;

  const boost = dsettings.currentLineFontSizeBoost || 0;
  const textStyle = {
    textAlign: headCenter ? 'center' : (dsettings.textAlignment || 'Left').toLowerCase(),
    filter: blur ? `blur(${blur}px)` : undefined,
    fontSize: isCurrent && boost ? `calc(1em + ${boost}px)` : undefined,
  };

  // Mildly alternate the colour of still-unread sentences so consecutive ones are easy to tell apart
  // (odd sentences get a subtle accent tint). Only the unread band — read/current lines keep their look.
  const altSent = dsettings.altSentenceColors && status === ReadStatus.Unread
    && (((doc.wordToSentence?.[line.startWordIndex] ?? index) % 2) === 1);

  const showPointer = POINTER_ENABLED && dsettings.showPointer && isCurrent && !line.isEmpty;
  const pointer = showPointer ? (
    <Pointer
      style={dsettings.pointerStyle || 'Arrow'}
      placement={dsettings.pointerPlacement || 'Left'}
      size={dsettings.pointerSize || 16}
      blinkMs={dsettings.pointerBlinkMs || 0}
    />
  ) : null;
  const placement = dsettings.pointerPlacement || 'Left';
  const pointerBefore = pointer && (placement === 'Left' || placement === 'Above');
  const pressing = ctx.pressingStart >= 0 && line.startWordIndex === ctx.pressingStart && !line.isEmpty;

  return (
    <div
      className={`line-row status-${status} ${isHF ? 'is-header-footer' : ''} ${inPara ? 'in-current-para' : ''} ${pressing ? 'pressing' : ''} ${isHead ? `toc-head toc-head-l${headLevel}` : ''} ${altSent ? 'alt-sent' : ''}`}
      data-line={index}
      data-start={line.startWordIndex}
      style={pressing ? { '--lp-ms': `${ctx.longPressMs}ms` } : undefined}
    >
      <div className="num">{line.lineNumber}</div>
      <div className="accent" />
      <div className={`text${obscureCls}${parallel ? ' parallel' : ''}`} style={textStyle}>
        {pointerBefore && pointer}
        {line.isEmpty ? (
          <span style={{ opacity: 0.4 }}>·</span>
        ) : showTranslated ? (
          <span className="lp-trans">{translated}</span>
        ) : (
          (() => {
            const words = renderWords(line, {
              isCurrent,
              currentWordIndex: ctx.currentWordIndex,
              bionic: dsettings.bionicFont,
              highlightORP: dsettings.highlightORP,
              currentWordStyles: dsettings.currentWordStyles,
              properNamesSet: propNameKeys,
              isHeaderFooter: isHF,
              hideBeyond: ctx.hideBeyond,
            });
            if (!parallel) return words;
            return (
              <>
                <span className="pl-col">{words}</span>
                <span className="pl-col pl-trans">{typeof translated === 'string' ? translated : <span className="pl-wait">{translated === null ? '⚠ translation failed' : '…'}</span>}</span>
              </>
            );
          })()
        )}
        {pointer && !pointerBefore && pointer}
      </div>
    </div>
  );
}

// Re-render a line only when something it actually shows changed. `ctx` is rebuilt every word step,
// so without this every visible line (and all ~120 in the split view) would re-render each tick.
function lineRowEqual(p, n) {
  if (p.index !== n.index || p.doc !== n.doc || p.dsettings !== n.dsettings || p.propNameKeys !== n.propNameKeys) return false;
  if (p.headingMap !== n.headingMap || p.headingPack !== n.headingPack) return false; // stable refs; see LinePane
  const pc = p.ctx, nc = n.ctx;
  if (pc === nc) return true;
  const i = n.index;
  if (pc.hideBeyond !== nc.hideBeyond) return false;        // progressive-reveal boundary moved
  if (pc.pressingStart !== nc.pressingStart) return false;  // long-press highlight
  if ((pc.translations?.get(i)) !== (nc.translations?.get(i))) return false; // this line's translation arrived/changed
  if (pc.sessionLines !== nc.sessionLines || pc.sessionNavLines !== nc.sessionNavLines || pc.readLines !== nc.readLines) return false;
  const pCur = pc.currentLine === i, nCur = nc.currentLine === i;
  if (pCur !== nCur) return false;                          // gained / lost "current"
  if (nCur && pc.currentWordIndex !== nc.currentWordIndex) return false; // word highlight moved within this line
  if ((i < pc.currentLine) !== (i < nc.currentLine)) return false;       // crossed the cursor → read-status flips
  if ((i >= pc.paraStart && i <= pc.paraEnd) !== (i >= nc.paraStart && i <= nc.paraEnd)) return false; // paragraph highlight
  if (pc.currentLine !== nc.currentLine) {                  // blur amount changes within the blur window
    const w = Math.max(n.dsettings.blurLinesBefore || 0, n.dsettings.blurLinesAfter || 0);
    if (w > 0 && (Math.abs(i - pc.currentLine) <= w || Math.abs(i - nc.currentLine) <= w)) return false;
  }
  return true;
}
const LineRow = memo(LineRowImpl, lineRowEqual);

// Row component for react-window: positions LineRow absolutely and measures its height.
function Row({ index, style, ariaAttributes, doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl, headingMap, headingPack }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    return rowHeightCtl.observeRowElements([ref.current]);
  }, [rowHeightCtl]);

  const showSep = sepEvery > 0 && index > 0 && index % sepEvery === 0;

  return (
    <div ref={ref} style={style} {...ariaAttributes}>
      {showSep && (
        <div className="percent-separator">
          <hr />
          <span>{((index / doc.lines.length) * 100).toFixed(1)}%</span>
          <hr />
        </div>
      )}
      <LineRow index={index} doc={doc} dsettings={dsettings} ctx={ctx} onJumpWord={onJumpWord} propNameKeys={propNameKeys} headingMap={headingMap} headingPack={headingPack} />
    </div>
  );
}

// Split reading view: previous lines (bottom-aligned), the current line pinned in a fixed
// centre band, and upcoming lines (top-aligned). Renders a bounded window around the current
// line — no scrolling, so the current line stays fixed in place and never jitters.
const SPLIT_WINDOW = 60;
function SplitView({ doc, dsettings, ctx, onJumpWord, propNameKeys, baseFont, lineSpacing = 1.5, onContextMenu, pressHandlers, windowSize = SPLIT_WINDOW, peekLine = -1, headingMap, headingPack }) {
  const cur = ctx.currentLine;
  const total = doc.lines.length;
  const common = { doc, dsettings, ctx, onJumpWord, propNameKeys, headingMap, headingPack };
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  // While peeking, the bottom zone shows the previewed area instead of the lines after the current
  // one — reverting to normal once reading resumes (peek clears).
  const peeking = peekLine >= 0 && peekLine !== cur;
  const afterStart = peeking ? peekLine : cur + 1;
  const before = [];
  for (let i = Math.max(0, cur - windowSize); i < cur; i++) before.push(i);
  const after = [];
  for (let i = afterStart; i <= Math.min(total - 1, afterStart + windowSize); i++) after.push(i);
  // Both context zones scroll; by default keep the lines nearest the current line in view
  // (before → bottom edge, after → top edge). The user can scroll back/forward from there.
  useLayoutEffect(() => {
    if (beforeRef.current) beforeRef.current.scrollTop = beforeRef.current.scrollHeight;
    if (afterRef.current) afterRef.current.scrollTop = 0;
  }, [cur, baseFont, afterStart]);
  return (
    <div className={`line-pane-split${peeking ? ' peeking' : ''}`} style={{ fontSize: `${baseFont}px`, lineHeight: lineSpacing }} onContextMenu={onContextMenu} {...pressHandlers}>
      <div className="lps-zone lps-before" ref={beforeRef}>
        {before.map((i) => (
          <LineRow key={i} index={i} {...common} />
        ))}
      </div>
      <div className="lps-zone lps-current">
        {cur < total && <LineRow index={cur} {...common} />}
      </div>
      <div className={`lps-zone lps-after${peeking ? ' lps-peeking' : ''}`} ref={afterRef}>
        {peeking && <div className="lps-peek-label">👁 Peeking line {peekLine + 1} — resume reading to return</div>}
        {after.map((i) => (
          <LineRow key={i} index={i} {...common} />
        ))}
      </div>
    </div>
  );
}

function WordMenu({ menu, onClose, onJumpWord, onAddNote }) {
  if (!menu) return null;
  const w = menu.word;
  const enc = encodeURIComponent(w);
  const open = (url) => {
    window.open(url, '_blank', 'noopener');
    onClose();
  };
  const items = [
    { label: '📝 Add note here', fn: () => { onAddNote?.(menu.start >= 0 ? menu.start : 0); onClose(); } },
    { label: `Copy “${w}”`, fn: () => { navigator.clipboard?.writeText(w).catch(() => {}); onClose(); } },
    { label: 'Translate (Google)', fn: () => open(`https://translate.google.com/?sl=auto&tl=en&text=${enc}&op=translate`) },
    { label: 'Dictionary (Merriam-Webster)', fn: () => open(`https://www.merriam-webster.com/dictionary/${enc}`) },
    { label: 'Thesaurus (Merriam-Webster)', fn: () => open(`https://www.merriam-webster.com/thesaurus/${enc}`) },
    { label: 'Go to this line', fn: () => { if (menu.start >= 0) onJumpWord(menu.start); onClose(); } },
  ];
  return (
    <>
      <div className="word-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="word-menu" style={{ left: menu.x, top: menu.y }}>
        {items.map((it) => (
          <div key={it.label} className="item" onClick={it.fn}>
            {it.label}
          </div>
        ))}
      </div>
    </>
  );
}

// Per-line translations for the translate obscure mode / side-by-side view. Returns Map(lineIndex →
// translated string | null(failed)). Requests run one at a time (rate-limit friendly) through the
// persistent IndexedDB cache, so a line is only ever sent to the service once per provider/target.
// ponytail: translates each display LINE independently — alignment with the original is exact by
// construction (each row holds both); the cost is quality at line breaks. Upgrade path: translate per
// sentence and distribute across its lines.
function useLineTranslations(doc, needed, cfg, enabled) {
  const [map, setMap] = useState(() => new Map());
  const mapRef = useRef(map);
  mapRef.current = map;
  const pendingRef = useRef(new Set());
  const cfgSig = `${cfg.translateProvider}|${cfg.translateTarget}|${cfg.translateSource}|${cfg.translateEndpoint}`;
  useEffect(() => { setMap(new Map()); pendingRef.current = new Set(); }, [doc, cfgSig]);
  const neededSig = needed.join(',');
  useEffect(() => {
    if (!enabled || !needed.length) return undefined;
    let alive = true;
    (async () => {
      for (const li of needed) {
        if (!alive) return;
        if (mapRef.current.has(li) || pendingRef.current.has(li)) continue;
        const text = (doc.lines[li]?.text || '').trim();
        if (!text) continue;
        pendingRef.current.add(li);
        try {
          const key = cacheKey(cfg, text);
          let t = await getCachedTranslation(key);
          if (t == null) { t = await translateText(cfg, text); putCachedTranslation(key, t); }
          if (alive) setMap((m) => new Map(m).set(li, t));
        } catch {
          if (alive) setMap((m) => new Map(m).set(li, null)); // failed — marked, not retried in a loop
        } finally { pendingRef.current.delete(li); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, neededSig, doc, cfgSig]);
  return map;
}

// Progressive-reveal boundary: the last word index that should remain visible.
function revealBoundary(doc, idx, mode) {
  if (!mode || mode === 'None') return Infinity;
  if (mode === 'Words') return idx;
  const li = getLineIndex(doc, idx);
  if (mode === 'Lines') return doc.lines[li].endWordIndex >= 0 ? doc.lines[li].endWordIndex : idx;
  if (mode === 'Sentences') {
    const si = doc.wordToSentence[idx];
    return doc.sentences[si]?.endWordIndex ?? idx;
  }
  if (mode === 'Paragraphs') {
    const r = getParagraphRange(doc, li);
    const end = doc.lines[r.endLine];
    return end.endWordIndex >= 0 ? end.endWordIndex : idx;
  }
  return Infinity;
}

export default function LinePane({ tab, onJumpWord, hideMode = 'None', peek = { line: -1, token: 0 }, visibleRef, onVisible, compact = false, scrollRead = false, recenterKey = 0, onAddNote }) {
  const { doc, settings } = tab;
  const paneVisRef = useReportVisibility(onVisible || (() => {}));
  const idx = settings.wordIndex;
  const [menu, setMenu] = useState(null);
  const [pressingStart, setPressingStart] = useState(-1); // wordIndex of the line being long-pressed
  const pressRef = useRef({});
  const longPressMs = settings.lineLongPressMs ?? 450;
  const hideBeyond = useMemo(() => revealBoundary(doc, idx, hideMode), [doc, idx, hideMode]);

  function onContextMenu(e) {
    const wordEl = e.target.closest?.('.word');
    if (!wordEl) return;
    e.preventDefault();
    const rowEl = e.target.closest('.line-row');
    const start = rowEl ? Number(rowEl.getAttribute('data-start')) : -1;
    const word = (wordEl.textContent || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word) return;
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 180), word, start });
  }
  const currentLine = getLineIndex(doc, idx);
  const paraRange = useMemo(() => getParagraphRange(doc, currentLine), [doc, currentLine]);
  const propNameKeys = useMemo(
    () =>
      settings.enableProperNames && doc.properNames
        ? new Set([...doc.properNames.keys()])
        : null,
    [doc, settings.enableProperNames]
  );

  // TOC-heading styling. Resolve the style pack (theme default, a forced pack, or off) and build a
  // stable line-index → tier map (tiers clamped to 0..2 — three elaborate levels). Both are memoised
  // on doc + the TOC entries + the chosen style, so they keep a stable identity across word steps
  // (the precondition that lets memo(LineRow) skip unchanged lines during playback).
  const headingStyle = settings.tocHeadingStyle ?? 'auto';
  const themeName = settings.themeName || (settings.darkMode ? 'Dark' : 'Light');
  const headingPack = useMemo(() => {
    if (headingStyle === 'off') return '';
    return headingStyle && headingStyle !== 'auto' ? headingStyle : resolveHeadingPack(themeName);
  }, [headingStyle, themeName]);
  const headingMap = useMemo(() => {
    if (headingStyle === 'off') return null;
    const entries = getTocEntries({ settings, doc });
    if (!entries.length) return null;
    const m = new Map();
    for (const e of entries) {
      const li = getLineIndex(doc, e.wordIndex);
      if (li >= 0) m.set(li, Math.max(0, Math.min(2, e.level || 0)));
    }
    return m.size ? m : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, settings.tocEntries, headingStyle]);

  // Stable display-settings subset handed to each line. Unlike `settings` (new identity on every
  // word step, via patchSettings), this keeps the same reference until a display option actually
  // changes — the precondition that lets memo(LineRow) skip unchanged lines during playback.
  const dsettings = useMemo(
    () => ({
      blurLinesBefore: settings.blurLinesBefore || 0,
      blurLinesAfter: settings.blurLinesAfter || 0,
      blurGradient: settings.blurGradient ?? 100,
      obscureMode: settings.obscureMode || 'blur',
      parallelTranslation: !!settings.parallelTranslation,
      altSentenceColors: !!settings.altSentenceColors,
      currentLineFontSizeBoost: settings.currentLineFontSizeBoost || 0,
      textAlignment: settings.textAlignment || 'Left',
      showPointer: settings.showPointer,
      pointerStyle: settings.pointerStyle,
      pointerPlacement: settings.pointerPlacement,
      pointerSize: settings.pointerSize,
      pointerBlinkMs: settings.pointerBlinkMs,
      bionicFont: settings.bionicFont,
      highlightORP: settings.highlightORP,
      currentWordStyles: currentWordStyles(settings),
    }),
    [
      settings.blurLinesBefore, settings.blurLinesAfter, settings.blurGradient, settings.obscureMode, settings.parallelTranslation, settings.altSentenceColors,
      settings.currentLineFontSizeBoost,
      settings.textAlignment, settings.showPointer, settings.pointerStyle, settings.pointerPlacement,
      settings.pointerSize, settings.pointerBlinkMs, settings.bionicFont, settings.highlightORP,
      settings.currentWordStyles, settings.currentWordStyle,
    ]
  );

  // Dynamic row heights — initial guess, then react-window measures via observeRowElements.
  // On phones, floor the line font at a comfortably readable size (the 12px default is too small on
  // a small high-DPI screen) while still honouring a larger user setting.
  const baseFont = compact
    ? Math.max(15, settings.rightPaneFontSize || 12)
    : settings.rightPaneFontSize || 12;
  const lineSpacing = Math.max(1, Math.min(3, settings.lineSpacing || 1.5));
  const defaultRowHeight = Math.round(baseFont * lineSpacing) + 8;
  const rowHeightCtl = useDynamicRowHeight({
    defaultRowHeight,
    key: `${doc.contentChecksum}:${baseFont}:${lineSpacing}`,
  });

  const listRef = useListRef();
  const listWrapRef = useRef(null); // scroll container, queried for the visible-line range
  // Use the split view only when the user opts in. Mobile used to force it, but the scrollable list
  // pairs better with thumb-scroll-to-read (drag the whole list to advance), and it still fills the
  // phone screen via the panes-full lock in App.jsx (see linesLocked).
  const split = !!settings.linePaneSplit;

  // ── translation (translate obscure mode + side-by-side parallel view) ──────────────────────────
  const { state: appState } = useApp();
  const gt = appState.global;
  const trCfg = useMemo(() => ({
    translateProvider: gt.translateProvider || 'mymemory',
    translateKey: gt.translateKey || '',
    translateEndpoint: gt.translateEndpoint || '',
    translateTarget: gt.translateTarget || 'ja',
    translateSource: gt.language || 'en',
  }), [gt.translateProvider, gt.translateKey, gt.translateEndpoint, gt.translateTarget, gt.language]);
  const parallelOn = !!settings.parallelTranslation;
  const translateObscure = settings.obscureMode === 'translate' && ((settings.blurLinesBefore || 0) > 0 || (settings.blurLinesAfter || 0) > 0);
  const trEnabled = (parallelOn || translateObscure) && translateConfigured(trCfg);
  const [visRange, setVisRange] = useState([0, 40]); // rendered-row range (tracked only while parallel is on)
  const trackVisRef = useRef(false);
  trackVisRef.current = parallelOn && trEnabled && !split;
  const neededLines = useMemo(() => {
    if (!trEnabled) return [];
    const out = new Set();
    if (translateObscure) {
      const b = settings.blurLinesBefore || 0, a = settings.blurLinesAfter || 0;
      for (let li = currentLine - b; li <= currentLine + a; li++) if (li >= 0 && li < doc.lines.length && li !== currentLine) out.add(li);
    }
    if (parallelOn) {
      const lo = split ? Math.max(0, currentLine - 12) : Math.max(0, visRange[0]);
      const hi = Math.min(doc.lines.length - 1, split ? currentLine + 30 : visRange[1]);
      for (let li = lo; li <= hi && out.size < 80; li++) out.add(li);
    }
    return [...out].filter((li) => { const l = doc.lines[li]; return l && !l.isEmpty && l.text.trim(); });
  }, [trEnabled, translateObscure, parallelOn, currentLine, visRange, doc, split, settings.blurLinesBefore, settings.blurLinesAfter]);
  const translations = useLineTranslations(doc, neededLines, trCfg, trEnabled);

  useEffect(() => {
    // In scroll-to-read mode the scroll is the user's — don't yank it back to centre the cursor.
    if (split || !settings.centerOnCurrent || scrollRead) return;
    const api = listRef.current;
    if (!api?.scrollToRow) return;
    api.scrollToRow({ index: currentLine, align: 'center' });
  }, [currentLine, settings.centerOnCurrent, split, listRef, scrollRead]);

  // "Jump to current word": recenter on demand (bumped by a control), regardless of centerOnCurrent
  // or scroll-to-read — so you can always snap back to where you're reading.
  useEffect(() => {
    if (!recenterKey || split) return;
    const api = listRef.current;
    api?.scrollToRow?.({ index: currentLine, align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // Scroll-to-read: the list scrolls normally and whatever passes the TOP edge counts as read — the
  // reading position follows the word at the top edge (forward only), which credits the spanned words.
  // Resume once at the current line when the mode starts, then leave the scroll alone.
  const resumedRef = useRef(false);
  useEffect(() => { resumedRef.current = false; }, [doc, scrollRead]);
  useEffect(() => {
    if (split || !scrollRead || resumedRef.current) return;
    const api = listRef.current;
    if (!api?.scrollToRow) return;
    api.scrollToRow({ index: currentLine, align: 'start' });
    resumedRef.current = true;
  }, [split, scrollRead, currentLine, listRef]);

  // Latest reading index / jump fn via refs so the scroll handler needn't re-bind every word step.
  const idxRef = useRef(idx);
  const jumpRef = useRef(onJumpWord);
  useEffect(() => { idxRef.current = idx; jumpRef.current = onJumpWord; });

  // onRowsRendered is the reliable line-granular signal; a scroll listener refines it to word-level
  // within the straddling line. Both advance the frontier forward only.
  function onRowsRendered({ startIndex, stopIndex }) {
    // Track the rendered range for the parallel-translation view (only while it's active).
    if (trackVisRef.current) {
      const hi = stopIndex ?? startIndex + 40;
      setVisRange((v) => (v[0] === startIndex && v[1] === hi ? v : [startIndex, hi]));
    }
    if (!scrollRead) return;
    const ln = doc.lines[startIndex];
    if (ln && ln.startWordIndex > idxRef.current) jumpRef.current(ln.startWordIndex, { read: true, src: 'scroll' });
  }
  useEffect(() => {
    if (split || !scrollRead) return undefined;
    const wrap = listWrapRef.current;
    if (!wrap) return undefined;
    const scroller = [...wrap.querySelectorAll('*')].find((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY)) || wrap;
    const before = settings.blurLinesBefore || 0;
    const after = settings.blurLinesAfter || 0;
    // The "assume-read" line sits at this fraction (0 = top, 1 = bottom) of the READABLE band — the
    // viewport minus any blurred (before/after) or hidden (reveal-mode) rows, since any blur on a line
    // means it isn't yet readable. At 0 this is the classic "read once it leaves the top" behaviour.
    const point = Math.max(0, Math.min(1, settings.scrollReadPoint ?? 0));
    const frontierWord = () => {
      const rect = wrap.getBoundingClientRect();
      const viewTop = rect.top, viewBottom = rect.bottom;
      const curLine = doc.wordToLine[idxRef.current] ?? 0;
      const revealAt = revealBoundary(doc, idxRef.current, hideMode); // first hidden line, or null
      const rows = wrap.querySelectorAll('.line-row[data-line]');
      // Shrink the band past any on-screen blurred/hidden rows above (raise the top) and below (lower
      // the bottom of the clear zone).
      let rTop = viewTop, rBottom = viewBottom;
      for (const row of rows) {
        const li = Number(row.getAttribute('data-line'));
        const rr = row.getBoundingClientRect();
        if (rr.bottom <= viewTop || rr.top >= viewBottom) continue;
        const blurredBefore = before > 0 && li < curLine && curLine - li <= before;
        const blurredAfter = after > 0 && li > curLine && li - curLine <= after;
        const hidden = revealAt != null && li >= revealAt;
        if (blurredBefore) rTop = Math.max(rTop, Math.min(viewBottom, rr.bottom));
        if (blurredAfter || hidden) rBottom = Math.min(rBottom, Math.max(viewTop, rr.top));
      }
      if (rBottom < rTop) rBottom = rTop;
      const readY = rTop + point * (rBottom - rTop);
      // Word at the read line: topmost row whose bottom is past readY, interpolated within it so
      // progress stays word-level even inside one long wrapped paragraph.
      for (const row of rows) {
        const rr = row.getBoundingClientRect();
        if (rr.bottom <= readY + 1) continue;
        const ln = doc.lines[Number(row.getAttribute('data-line'))];
        if (!ln) return null;
        const end = ln.endWordIndex >= 0 ? ln.endWordIndex : ln.startWordIndex;
        const frac = Math.max(0, Math.min(1, (readY - rr.top) / Math.max(1, rr.height)));
        return ln.startWordIndex + Math.round(frac * Math.max(0, end - ln.startWordIndex));
      }
      return null;
    };
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const f = frontierWord();
        if (f != null && f > idxRef.current) jumpRef.current(f, { read: true, src: 'scroll' });
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { scroller.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [split, scrollRead, doc, settings.blurLinesBefore, settings.blurLinesAfter, settings.scrollReadPoint, hideMode]);

  // Peek: scroll the (list-view) viewport to a previewed line without moving the reading position,
  // and scroll back to the current line when the peek clears. (Split view handles peek in its bottom
  // zone — see SplitView.)
  useEffect(() => {
    if (split) return;
    const api = listRef.current;
    if (!api?.scrollToRow) return;
    api.scrollToRow({ index: peek.line >= 0 ? peek.line : currentLine, align: 'center' });
    // eslint-disable-next-line
  }, [peek?.token]);

  const totalLines = doc.lines.length;
  const sepEvery = settings.showPercentSeparators ? Math.max(1, Math.floor(totalLines / 100)) : 0;

  const ctx = useMemo(
    () => ({
      currentLine,
      currentWordIndex: idx,
      sessionLines: tab.sessionLinesRead,
      sessionNavLines: tab.sessionNavLinesRead,
      readLines: tab.readLinesAllTime,
      paraStart: paraRange.startLine,
      paraEnd: paraRange.endLine,
      hideBeyond,
      pressingStart,
      longPressMs,
      translations,
    }),
    [currentLine, idx, tab.sessionLinesRead, tab.sessionNavLinesRead, tab.readLinesAllTime, paraRange, hideBeyond, pressingStart, longPressMs, translations]
  );

  // rowProps must not contain ariaAttributes/index/style (those are auto-passed by List).
  const rowProps = useMemo(
    () => ({ doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl, headingMap, headingPack }),
    [doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl, headingMap, headingPack]
  );

  // Long-press to navigate: a single click no longer jumps — you must hold a line for
  // lineLongPressMs (default 450). Pointer drift or release cancels the press. Set 0 for the
  // old instant-click behaviour. The "pressing" highlight is React state (not a manual class) so
  // a background re-render mid-hold can't wipe the progress indicator.
  function cancelPress() {
    const p = pressRef.current;
    if (p.timer) clearTimeout(p.timer);
    pressRef.current = {};
    setPressingStart((s) => (s === -1 ? s : -1));
  }
  function onPressDown(e) {
    if (e.button != null && e.button !== 0) return; // left button / touch only
    const row = e.target.closest?.('.line-row');
    if (!row) return;
    const start = Number(row.getAttribute('data-start'));
    if (!(start >= 0)) return;
    if (pressRef.current.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = { x: e.clientX, y: e.clientY, start };
    if (longPressMs > 0) {
      setPressingStart(start);
      pressRef.current.timer = setTimeout(() => { onJumpWord(start); cancelPress(); }, longPressMs);
    }
  }
  function onPressMove(e) {
    const p = pressRef.current;
    if (p.timer == null && p.start == null) return;
    if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) cancelPress();
  }
  function onPressUp(e) {
    const p = pressRef.current;
    if (longPressMs <= 0 && p.start != null && e.target.closest?.('.line-row')?.getAttribute('data-start') === String(p.start)) {
      onJumpWord(p.start);
    }
    cancelPress();
  }
  const pressHandlers = {
    onPointerDown: onPressDown,
    onPointerMove: onPressMove,
    onPointerUp: onPressUp,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
  };
  useEffect(() => () => { if (pressRef.current.timer) clearTimeout(pressRef.current.timer); }, []);

  // Report the top/bottom currently-visible line so the parent's PgUp/PgDn can move the reading
  // position by a screenful. Blurred (within the focus-blur window) and unrevealed (beyond the
  // progressive-reveal boundary) lines don't count as visible. Returns null in the split view (no
  // scroll) or when nothing qualifies, so the parent can fall back to paragraph paging.
  function pageTargetLine(dir) {
    const wrap = listWrapRef.current;
    if (!wrap) return null;
    const rows = wrap.querySelectorAll('.line-row[data-line]');
    if (!rows.length) return null;
    const cr = wrap.getBoundingClientRect();
    const before = settings.blurLinesBefore || 0;
    const after = settings.blurLinesAfter || 0;
    let top = Infinity;
    let bottom = -Infinity;
    rows.forEach((el) => {
      const i = Number(el.getAttribute('data-line'));
      const r = el.getBoundingClientRect();
      const shown = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
      if (shown < Math.max(4, r.height * 0.5)) return; // need ~half the row inside the viewport
      const blurred =
        (before > 0 && i < currentLine && currentLine - i <= before) ||
        (after > 0 && i > currentLine && i - currentLine <= after);
      const ln = doc.lines[i];
      const unrevealed = hideBeyond !== Infinity && ln && ln.startWordIndex > hideBeyond;
      if (blurred || unrevealed) return;
      if (i < top) top = i;
      if (i > bottom) bottom = i;
    });
    if (top === Infinity) return null;
    return dir > 0 ? bottom : top;
  }
  useEffect(() => {
    if (visibleRef) visibleRef.current = { page: pageTargetLine };
  });

  return (
    <div
      className={`line-pane${headingPack ? ` hsp-${headingPack}` : ''}`}
      ref={paneVisRef}
      style={settings.fontFamily ? { fontFamily: settings.fontFamily } : undefined}
    >
      <div className="line-pane-toolbar">
        <span>Lines</span>
      </div>
      {split ? (
        <SplitView
          doc={doc}
          dsettings={dsettings}
          ctx={ctx}
          onJumpWord={onJumpWord}
          propNameKeys={propNameKeys}
          baseFont={baseFont}
          lineSpacing={lineSpacing}
          onContextMenu={onContextMenu}
          pressHandlers={pressHandlers}
          windowSize={compact ? 30 : SPLIT_WINDOW}
          peekLine={peek.line}
          headingMap={headingMap}
          headingPack={headingPack}
        />
      ) : (
        <div className="line-pane-list" ref={listWrapRef} style={{ fontSize: `${baseFont}px`, lineHeight: lineSpacing }} onContextMenu={onContextMenu} {...pressHandlers}>
          <List
            listRef={listRef}
            rowCount={totalLines}
            rowHeight={rowHeightCtl}
            rowComponent={Row}
            rowProps={rowProps}
            overscanCount={8}
            onRowsRendered={onRowsRendered}
            style={{ height: '100%', width: '100%' }}
          />
        </div>
      )}
      <WordMenu menu={menu} onClose={() => setMenu(null)} onJumpWord={onJumpWord} onAddNote={onAddNote} />
    </div>
  );
}
