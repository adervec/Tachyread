import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, useListRef } from 'react-window';
import { ReadStatus, orpIndex, getLineIndex, getParagraphRange } from '../document/readerDocument.js';
import Pointer from './Pointer.jsx';
import { useReportVisibility } from '../state/useReportVisibility.js';

// Reading-pointer feature archived for now (not useful). Flip to true to restore it, and uncomment
// its Settings section in dialogs/SettingsDialog.jsx.
const POINTER_ENABLED = false;

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
function LineRowImpl({ index, doc, dsettings, ctx, propNameKeys }) {
  const line = doc.lines[index];
  const status = statusForLine(index, ctx);
  const isCurrent = status === ReadStatus.Current;
  const isHF = doc.headerFooterLines.has(index);
  const inPara = index >= ctx.paraStart && index <= ctx.paraEnd && status !== ReadStatus.Current;

  // Focus blur: blur lines within the configured window before/after the current line.
  const before = dsettings.blurLinesBefore || 0;
  const after = dsettings.blurLinesAfter || 0;
  let blur = 0;
  if (!isCurrent) {
    if (index < ctx.currentLine && ctx.currentLine - index <= before) blur = Math.min(2.5, (ctx.currentLine - index) * 0.9);
    else if (index > ctx.currentLine && index - ctx.currentLine <= after) blur = Math.min(2.5, (index - ctx.currentLine) * 0.9);
  }

  const boost = dsettings.currentLineFontSizeBoost || 0;
  const textStyle = {
    textAlign: (dsettings.textAlignment || 'Left').toLowerCase(),
    filter: blur ? `blur(${blur}px)` : undefined,
    fontSize: isCurrent && boost ? `calc(1em + ${boost}px)` : undefined,
  };

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
      className={`line-row status-${status} ${isHF ? 'is-header-footer' : ''} ${inPara ? 'in-current-para' : ''} ${pressing ? 'pressing' : ''}`}
      data-line={index}
      data-start={line.startWordIndex}
      style={pressing ? { '--lp-ms': `${ctx.longPressMs}ms` } : undefined}
    >
      <div className="num">{line.lineNumber}</div>
      <div className="accent" />
      <div className="text" style={textStyle}>
        {pointerBefore && pointer}
        {line.isEmpty ? (
          <span style={{ opacity: 0.4 }}>·</span>
        ) : (
          renderWords(line, {
            isCurrent,
            currentWordIndex: ctx.currentWordIndex,
            bionic: dsettings.bionicFont,
            highlightORP: dsettings.highlightORP,
            currentWordStyles: dsettings.currentWordStyles,
            properNamesSet: propNameKeys,
            isHeaderFooter: isHF,
            hideBeyond: ctx.hideBeyond,
          })
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
  const pc = p.ctx, nc = n.ctx;
  if (pc === nc) return true;
  const i = n.index;
  if (pc.hideBeyond !== nc.hideBeyond) return false;        // progressive-reveal boundary moved
  if (pc.pressingStart !== nc.pressingStart) return false;  // long-press highlight
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
function Row({ index, style, ariaAttributes, doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl }) {
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
      <LineRow index={index} doc={doc} dsettings={dsettings} ctx={ctx} onJumpWord={onJumpWord} propNameKeys={propNameKeys} />
    </div>
  );
}

// Split reading view: previous lines (bottom-aligned), the current line pinned in a fixed
// centre band, and upcoming lines (top-aligned). Renders a bounded window around the current
// line — no scrolling, so the current line stays fixed in place and never jitters.
const SPLIT_WINDOW = 60;
function SplitView({ doc, dsettings, ctx, onJumpWord, propNameKeys, baseFont, onContextMenu, pressHandlers, windowSize = SPLIT_WINDOW, peekLine = -1 }) {
  const cur = ctx.currentLine;
  const total = doc.lines.length;
  const common = { doc, dsettings, ctx, onJumpWord, propNameKeys };
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
    <div className={`line-pane-split${peeking ? ' peeking' : ''}`} style={{ fontSize: `${baseFont}px` }} onContextMenu={onContextMenu} {...pressHandlers}>
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

function WordMenu({ menu, onClose, onJumpWord }) {
  if (!menu) return null;
  const w = menu.word;
  const enc = encodeURIComponent(w);
  const open = (url) => {
    window.open(url, '_blank', 'noopener');
    onClose();
  };
  const items = [
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

export default function LinePane({ tab, onJumpWord, hideMode = 'None', peek = { line: -1, token: 0 }, visibleRef, onVisible, compact = false }) {
  const { doc, settings } = tab;
  const paneVisRef = useReportVisibility(onVisible || (() => {}));
  const idx = settings.wordIndex;
  const [menu, setMenu] = useState(null);
  const [pressingStart, setPressingStart] = useState(-1); // wordIndex of the line being long-pressed
  const pressRef = useRef({});
  const longPressMs = settings.lineLongPressMs ?? 3000;
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

  // Stable display-settings subset handed to each line. Unlike `settings` (new identity on every
  // word step, via patchSettings), this keeps the same reference until a display option actually
  // changes — the precondition that lets memo(LineRow) skip unchanged lines during playback.
  const dsettings = useMemo(
    () => ({
      blurLinesBefore: settings.blurLinesBefore || 0,
      blurLinesAfter: settings.blurLinesAfter || 0,
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
      settings.blurLinesBefore, settings.blurLinesAfter, settings.currentLineFontSizeBoost,
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
  const defaultRowHeight = Math.round(baseFont * 1.55) + 4;
  const rowHeightCtl = useDynamicRowHeight({
    defaultRowHeight,
    key: `${doc.contentChecksum}:${baseFont}`,
  });

  const listRef = useListRef();
  const listWrapRef = useRef(null); // scroll container, queried for the visible-line range
  // On compact screens always use the split view: the virtualized list (per-row measurement +
  // observers) is heavy on phones, and the split view is a fixed, viewport-locked window.
  const split = !!settings.linePaneSplit || compact;

  useEffect(() => {
    if (split || !settings.centerOnCurrent) return;
    const api = listRef.current;
    if (!api?.scrollToRow) return;
    api.scrollToRow({ index: currentLine, align: 'center' });
  }, [currentLine, settings.centerOnCurrent, split, listRef]);

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
    }),
    [currentLine, idx, tab.sessionLinesRead, tab.sessionNavLinesRead, tab.readLinesAllTime, paraRange, hideBeyond, pressingStart, longPressMs]
  );

  // rowProps must not contain ariaAttributes/index/style (those are auto-passed by List).
  const rowProps = useMemo(
    () => ({ doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl }),
    [doc, dsettings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl]
  );

  // Long-press to navigate: a single click no longer jumps — you must hold a line for
  // lineLongPressMs (default 3000). Pointer drift or release cancels the press. Set 0 for the
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return (
    <div className="line-pane" ref={paneVisRef}>
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
          onContextMenu={onContextMenu}
          pressHandlers={pressHandlers}
          windowSize={compact ? 30 : SPLIT_WINDOW}
          peekLine={peek.line}
        />
      ) : (
        <div className="line-pane-list" ref={listWrapRef} style={{ fontSize: `${baseFont}px` }} onContextMenu={onContextMenu} {...pressHandlers}>
          <List
            listRef={listRef}
            rowCount={totalLines}
            rowHeight={rowHeightCtl}
            rowComponent={Row}
            rowProps={rowProps}
            overscanCount={8}
            style={{ height: '100%', width: '100%' }}
          />
        </div>
      )}
      <WordMenu menu={menu} onClose={() => setMenu(null)} onJumpWord={onJumpWord} />
    </div>
  );
}
