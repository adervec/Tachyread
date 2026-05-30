import { useMemo } from 'react';
import { orpIndex } from '../document/readerDocument.js';

function calcFontSize(word) {
  const BASE = 64;
  const orp = orpIndex(word.length);
  const rightLen = word.length - orp - 1;
  const maxRight = 13;
  if (rightLen <= maxRight) return BASE;
  return Math.max(22, (BASE * maxRight) / rightLen);
}

function ContextWordChar({ word, highlightOrp }) {
  if (!highlightOrp || word.length < 2) return word + ' ';
  const o = orpIndex(word.length);
  return (
    <>
      {word.slice(0, o)}
      <span className="spritz-context-orp">{word[o]}</span>
      {word.slice(o + 1)}{' '}
    </>
  );
}

// SPRITZ word display only — the ORP word, context words, and guide lines.
// Animated faces and stats live in DashboardPane so the panes resize independently.
export default function SpritzPane({ tab }) {
  const { settings, doc } = tab;
  const idx = settings.wordIndex;
  const word = doc.words[idx] || '';
  const orp = orpIndex(word.length);
  const left = word.slice(0, orp);
  const orpCh = orp < word.length ? word[orp] : '';
  const right = orp + 1 < word.length ? word.slice(orp + 1) : '';
  const fontSize = calcFontSize(word);

  // Separate before/after counts; -1 means "inherit the combined contextWordCount".
  const before = settings.contextWordsBefore >= 0 ? settings.contextWordsBefore : settings.contextWordCount || 0;
  const after = settings.contextWordsAfter >= 0 ? settings.contextWordsAfter : settings.contextWordCount || 0;
  const beforeWords = useMemo(() => {
    const out = [];
    for (let i = Math.max(0, idx - before); i < idx; i++) out.push(doc.words[i]);
    return out;
  }, [doc, idx, before]);
  const afterWords = useMemo(() => {
    const out = [];
    for (let i = idx + 1; i < Math.min(doc.words.length, idx + 1 + after); i++) out.push(doc.words[i]);
    return out;
  }, [doc, idx, after]);

  const themeClass = `spritz-pane ${settings.serif ? 'serif' : 'sans'} guide-${settings.guideColor || 'Red'}`;

  return (
    <div className={themeClass}>
      <div className="spritz-context-before">
        {beforeWords.map((w, i) => (
          <ContextWordChar key={i} word={w} highlightOrp={settings.highlightORP} />
        ))}
      </div>
      <div className="spritz-word-row" style={{ fontSize: `${fontSize}px` }}>
        {settings.showGuideLines && <span className={`guide-line left guide-color-${settings.guideColor || 'Red'}`} />}
        <span className="spritz-left">{left}</span>
        <span className="spritz-orp">{orpCh}</span>
        <span className="spritz-right">{right}</span>
        {settings.showGuideLines && <span className={`guide-line right guide-color-${settings.guideColor || 'Red'}`} />}
      </div>
      <div className="spritz-context-after">
        {afterWords.map((w, i) => (
          <ContextWordChar key={i} word={w} highlightOrp={settings.highlightORP} />
        ))}
      </div>
    </div>
  );
}
