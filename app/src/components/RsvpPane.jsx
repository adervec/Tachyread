import { useMemo } from 'react';
import { orpIndex } from '../document/readerDocument.js';
import { useReportVisibility } from '../state/useReportVisibility.js';

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
      <span className="rsvp-context-orp">{word[o]}</span>
      {word.slice(o + 1)}{' '}
    </>
  );
}

// RSVP word display only — the ORP word, context words, and guide lines.
// Animated faces and stats live in DashboardPane so the panes resize independently.
export default function RsvpPane({ tab, onVisible }) {
  const { settings, doc } = tab;
  const visRef = useReportVisibility(onVisible || (() => {}));
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

  const themeClass = `rsvp-pane ${settings.serif ? 'serif' : 'sans'} guide-${settings.guideColor || 'Red'}`;
  const gc = settings.guideColor || 'Red';
  const focus = settings.rsvpFocus || 'none';
  // ORP horizontal focus point (0=far left .. 1=far right). flex-grow ratios pin the ORP glyph there
  // and let the two halves fill the rest, so the eye lands on the SAME spot every word.
  const orpPct = Math.max(0.1, Math.min(0.9, settings.orpHorizontalPercent ?? 0.5));

  return (
    // The Font Manager's per-tab font wins; the legacy serif/sans class is the fallback look.
    <div className={themeClass} ref={visRef} style={settings.fontFamily ? { fontFamily: settings.fontFamily } : undefined}>
      <div className="rsvp-context-before">
        {beforeWords.map((w, i) => (
          <ContextWordChar key={i} word={w} highlightOrp={settings.highlightORP} />
        ))}
      </div>
      {/* key={idx} restarts the per-word focus animations (pulse / converge). */}
      <div className={`rsvp-word-row focus-${focus}`} style={{ fontSize: `${fontSize}px` }} key={idx}>
        <span className="rsvp-left" style={{ flexGrow: orpPct }}>{focus === 'fisheye' ? fisheyeSide(left, 'left') : left}</span>
        <span className="rsvp-orp">
          {settings.showGuideLines && <span className={`guide-tick top guide-color-${gc}`} />}
          {orpCh}
          {settings.showGuideLines && <span className={`guide-tick bottom guide-color-${gc}`} />}
          {focus === 'converge' && (
            <>
              <span className={`orp-converge left guide-color-${gc}`} />
              <span className={`orp-converge right guide-color-${gc}`} />
            </>
          )}
        </span>
        <span className="rsvp-right" style={{ flexGrow: 1 - orpPct }}>{focus === 'fisheye' ? fisheyeSide(right, 'right') : right}</span>
      </div>
      <div className="rsvp-context-after">
        {afterWords.map((w, i) => (
          <ContextWordChar key={i} word={w} highlightOrp={settings.highlightORP} />
        ))}
      </div>
    </div>
  );
}

// Fisheye: enlarge the letters nearest the ORP so the eye is drawn to the focus point. `side` says
// which end abuts the ORP (left side's last char is nearest; right side's first char is nearest).
// transform (not font-size) so the layout — and the ORP's position — never shift.
function fisheyeSide(text, side) {
  const chars = [...text];
  const n = chars.length;
  return chars.map((c, i) => {
    const d = side === 'left' ? n - 1 - i : i; // distance from the ORP
    const scale = d <= 2 ? 1 + 0.26 * (1 - d / 3) : 1;
    return <span key={i} className="fe-ch" style={scale !== 1 ? { transform: `scale(${scale.toFixed(3)})` } : undefined}>{c}</span>;
  });
}
