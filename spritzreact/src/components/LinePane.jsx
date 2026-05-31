import { useEffect, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, useListRef } from 'react-window';
import { ReadStatus, orpIndex, getLineIndex, getParagraphRange } from '../document/readerDocument.js';
import Pointer from './Pointer.jsx';

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
function LineRow({ index, doc, settings, ctx, onJumpWord, propNameKeys }) {
  const line = doc.lines[index];
  const status = statusForLine(index, ctx);
  const isCurrent = status === ReadStatus.Current;
  const isHF = doc.headerFooterLines.has(index);
  const inPara = index >= ctx.paraStart && index <= ctx.paraEnd && status !== ReadStatus.Current;

  // Focus blur: blur lines within the configured window before/after the current line.
  const before = settings.blurLinesBefore || 0;
  const after = settings.blurLinesAfter || 0;
  let blur = 0;
  if (!isCurrent) {
    if (index < ctx.currentLine && ctx.currentLine - index <= before) blur = Math.min(2.5, (ctx.currentLine - index) * 0.9);
    else if (index > ctx.currentLine && index - ctx.currentLine <= after) blur = Math.min(2.5, (index - ctx.currentLine) * 0.9);
  }

  const boost = settings.currentLineFontSizeBoost || 0;
  const textStyle = {
    textAlign: (settings.textAlignment || 'Left').toLowerCase(),
    filter: blur ? `blur(${blur}px)` : undefined,
    fontSize: isCurrent && boost ? `calc(1em + ${boost}px)` : undefined,
  };

  const showPointer = settings.showPointer && isCurrent && !line.isEmpty;
  const pointer = showPointer ? (
    <Pointer
      style={settings.pointerStyle || 'Arrow'}
      placement={settings.pointerPlacement || 'Left'}
      size={settings.pointerSize || 16}
      blinkMs={settings.pointerBlinkMs || 0}
    />
  ) : null;
  const placement = settings.pointerPlacement || 'Left';
  const pointerBefore = pointer && (placement === 'Left' || placement === 'Above');

  return (
    <div
      className={`line-row status-${status} ${isHF ? 'is-header-footer' : ''} ${inPara ? 'in-current-para' : ''}`}
      data-line={index}
      data-start={line.startWordIndex}
      onClick={() => {
        if (line.startWordIndex >= 0) onJumpWord(line.startWordIndex);
      }}
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
            bionic: settings.bionicFont,
            highlightORP: settings.highlightORP,
            currentWordStyles: currentWordStyles(settings),
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

// Row component for react-window: positions LineRow absolutely and measures its height.
function Row({ index, style, ariaAttributes, doc, settings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl }) {
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
      <LineRow index={index} doc={doc} settings={settings} ctx={ctx} onJumpWord={onJumpWord} propNameKeys={propNameKeys} />
    </div>
  );
}

// Split reading view: previous lines (bottom-aligned), the current line pinned in a fixed
// centre band, and upcoming lines (top-aligned). Renders a bounded window around the current
// line — no scrolling, so the current line stays fixed in place and never jitters.
const SPLIT_WINDOW = 60;
function SplitView({ doc, settings, ctx, onJumpWord, propNameKeys, baseFont, onContextMenu }) {
  const cur = ctx.currentLine;
  const total = doc.lines.length;
  const common = { doc, settings, ctx, onJumpWord, propNameKeys };
  const before = [];
  for (let i = Math.max(0, cur - SPLIT_WINDOW); i < cur; i++) before.push(i);
  const after = [];
  for (let i = cur + 1; i <= Math.min(total - 1, cur + SPLIT_WINDOW); i++) after.push(i);
  return (
    <div className="line-pane-split" style={{ fontSize: `${baseFont}px` }} onContextMenu={onContextMenu}>
      <div className="lps-zone lps-before">
        {before.map((i) => (
          <LineRow key={i} index={i} {...common} />
        ))}
      </div>
      <div className="lps-zone lps-current">
        {cur < total && <LineRow index={cur} {...common} />}
      </div>
      <div className="lps-zone lps-after">
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

export default function LinePane({ tab, onJumpWord, hideMode = 'None' }) {
  const { doc, settings } = tab;
  const idx = settings.wordIndex;
  const [menu, setMenu] = useState(null);
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

  // Dynamic row heights — initial guess, then react-window measures via observeRowElements.
  const baseFont = settings.rightPaneFontSize || 12;
  const defaultRowHeight = Math.round(baseFont * 1.55) + 4;
  const rowHeightCtl = useDynamicRowHeight({
    defaultRowHeight,
    key: `${doc.contentChecksum}:${baseFont}`,
  });

  const listRef = useListRef();
  const split = !!settings.linePaneSplit;

  useEffect(() => {
    if (split || !settings.centerOnCurrent) return;
    const api = listRef.current;
    if (!api?.scrollToRow) return;
    api.scrollToRow({ index: currentLine, align: 'center' });
  }, [currentLine, settings.centerOnCurrent, split, listRef]);

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
    }),
    [currentLine, idx, tab.sessionLinesRead, tab.sessionNavLinesRead, tab.readLinesAllTime, paraRange, hideBeyond]
  );

  // rowProps must not contain ariaAttributes/index/style (those are auto-passed by List).
  const rowProps = useMemo(
    () => ({ doc, settings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl }),
    [doc, settings, ctx, onJumpWord, propNameKeys, sepEvery, rowHeightCtl]
  );

  return (
    <div className="line-pane">
      <div className="line-pane-toolbar">
        <span>Lines</span>
      </div>
      {split ? (
        <SplitView
          doc={doc}
          settings={settings}
          ctx={ctx}
          onJumpWord={onJumpWord}
          propNameKeys={propNameKeys}
          baseFont={baseFont}
          onContextMenu={onContextMenu}
        />
      ) : (
        <div className="line-pane-list" style={{ fontSize: `${baseFont}px` }} onContextMenu={onContextMenu}>
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
