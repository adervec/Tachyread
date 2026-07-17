import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { THEME_CATEGORIES, HEADING_PACKS } from '../state/themes.js';
import { offDefaultKeys, defaultFileSettings, tabDefaultsFrom } from '../state/settings.js';
import ProfilesBar from '../components/ProfilesBar.jsx';
import { createMetronome } from '../features/metronome.js';
import { DEFAULT_METRONOME } from '../engine/metronome.js';
import { LINE_SOUNDS, playLineSound } from '../features/clickSound.js';
import { FACE_STYLES } from '../components/faceDecor3d.js';
import { STATS_CHIP_ITEMS } from '../components/ReadingStats.jsx';

const ART_STYLES = ['Cartoon', 'Flat', 'Sketch', 'Neon', 'Watercolor', 'Pastel'];
// Reading-pointer options archived with its Settings section (see below). Restore alongside it.
// const POINTER_STYLES = ['Arrow', 'Diamond', 'Star', 'Circle', 'Hand'];
// const POINTER_PLACEMENTS = ['Above', 'Below', 'Left', 'Right'];
const CURRENT_WORD_STYLES = ['Underline', 'Overline', 'Bold', 'Italic', 'Color', 'Background', 'Box', 'Glow'];
// Named highlight colours shared by the current-word highlight and the source cursor. '' = theme default.
const HIGHLIGHT_COLORS = [
  ['', 'Theme'], ['#ffd54f', 'Amber'], ['#4fd8ff', 'Cyan'], ['#7dff8a', 'Green'],
  ['#ff7ab0', 'Pink'], ['#ffb04f', 'Orange'], ['#b58cff', 'Purple'], ['#ff5c5c', 'Red'],
];

// Back-compat: older saved tabs used a single `currentWordStyle` string.
function readCwStyles(s) {
  if (Array.isArray(s.currentWordStyles)) return s.currentWordStyles;
  if (s.currentWordStyle) return [s.currentWordStyle];
  return ['Underline'];
}

const GUIDE_COLORS = ['Red', 'Pink', 'Orange', 'Green', 'Blue', 'Purple'];
const ALIGNMENTS = ['Left', 'Center', 'Right', 'Justify'];

// One-line explanations shown when you click a setting's label (keyed by label, so the Fields don't
// each need editing). Only the non-obvious settings need an entry; the rest show no ⓘ.
const HINTS = {
  'Context words before': 'How many words before the current one to show faintly around the Fast Reader word, for peripheral context.',
  'Context words after': 'How many words after the current one to show faintly around the Fast Reader word.',
  'Show guide lines': 'Draw crosshair guides through the Fast Reader word to anchor your gaze.',
  'Highlight ORP character': 'Tint the Optimal Recognition Point (the letter your eye should land on) so words centre themselves.',
  'ORP horizontal position (%)': 'Where across the pane the ORP letter is pinned — 50% centres it. The word halves grow to keep the ORP at this spot every word.',
  'Eye focuser at the ORP': 'An extra effect that pulls the eye onto the ORP letter each word: fisheye (nearby letters swell toward it), pulse (the ORP flares), or converge (two bars sweep in and settle on it).',
  'Breathe the pace (sinusoidal WPM)': 'Let the reading speed rise and fall smoothly around your WPM so the eye gets brief rests. The average speed is unchanged.',
  'Breathe depth (± fraction of WPM)': 'How far the pace swings above and below your WPM. 0.25 = ±25%.',
  'Breathe period (sec per cycle)': 'Seconds for one full fast → slow → fast cycle of the breathing pace.',
  'Hide Fast Reader pane': 'Remove the flashing-word pane entirely and read only from the Lines pane.',
  'Line spacing (1 = single)': 'Vertical spacing between lines in the Lines pane.',
  '% separators': 'Show faint percentage markers down the Lines pane so you can see how far through you are.',
  'Wall of text (merge lines into blocks)': 'Flow the source lines together into solid blocks (line breaks become spaces; paragraph breaks become an indent tab) instead of one row per source line. Blocks break at headings, % markers, or the interval below.',
  'Wall: break every N lines (0 = sections / % only)': 'In wall-of-text mode, also start a new block every this-many source lines. 0 keeps blocks running until the next heading or % marker.',
  'Alternate unread sentence colours': 'Give consecutive not-yet-read sentences a slightly different colour so where one ends and the next begins is easy to see.',
  'Split pane (before / current / after)': 'Split the Lines pane into what you have read, the current line, and what is ahead.',
  'Center current line': 'Keep the line you are reading pinned to the middle of the Lines pane instead of scrolling naturally.',
  'Line jump: long-press hold (ms, 0 = instant click)': 'How long to hold a tap on a line before it jumps there (0 = a plain click jumps immediately).',
  'Reveal mode (hide text ahead)': 'Progressively hide upcoming text (by word/line/sentence/paragraph) so you cannot read ahead.',
  'Bionic font': 'Bold the first few letters of each word to pull your eye through the line faster.',
  'Current-line highlight': 'Tint the whole current line in the Lines pane. Off, the line looks like any other and only the current-word highlight marks your position.',
  'Current-word highlight (combine any)': 'How the word you are on is marked in the Lines pane — combine any of underline, bold, background, colour, box.',
  'Auto-collapse completed sections': 'Fold away ToC sections once you have finished reading them.',
  'Show faces': 'Animated reader faces whose expression tracks your pace and progress.',
  'Paragraph break (sec)': 'Extra pause the auto-player takes at the end of a paragraph.',
  'Line break pause (ms)': 'Extra pause the auto-player takes at the end of each line.',
  'Detect proper names (heavy on large docs)': 'Find names/entities so they can be indexed and optionally dwelt on longer — slower on big books.',
  'Auto-skip headers/footers': 'Skip repeated running headers/footers (page numbers, book title) while reading.',
  'Surprisal-weighted dwell': 'Spend longer on rare/informative words and less on predictable ones — your average WPM is unchanged.',
  'Enable beat at reading pace': 'A metronome click locked to your current WPM — a rhythm to read along with.',
  'Obscure with': 'How the text past your readable window is hidden — blur, hide, redact (blackout bar), illegible dots, or translated into another language — to discourage backtracking or reading too far ahead.',
  'Readable lines before (0 = off)': 'How many already-read lines above the current one stay clear. Set above 0, the next 100 lines beyond that window are obscured (stops deep backtracking); farther back is left clear for deliberate peeking. 0 = nothing above is obscured.',
  'Readable lines after (0 = off)': 'How many upcoming lines below the current one stay clear. Set above 0, the next 100 lines beyond that window are obscured (stops accidental read-ahead); farther down is left clear. 0 = nothing below is obscured.',
  'Side-by-side translation': 'Show each line in two columns: the original next to its translation (service + language from Application Settings → Translation). Lines are translated one-by-one so the columns always align.',
  'Blur strength (%)': 'Overall blur strength. Your readable window stays clear; blur ramps to full over the first few lines of the obscured band beyond it. Lines past the 100-line band are left clear.',
  'Scroll read point (%)': 'In scroll-to-read, where a line is counted as read: 0% = only once it scrolls off the top; higher = further down the clear (unblurred) area, up to as soon as it appears.',
};

function hueOf(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function Field({ label, children }) {
  const hint = HINTS[label];
  const [show, setShow] = useState(false);
  return (
    <div className="field-row">
      <label className={hint ? 'has-hint' : ''} title={hint || undefined} onClick={hint ? () => setShow((v) => !v) : undefined}>
        {label}{hint && <span className="field-hint-mark" aria-hidden="true">ⓘ</span>}
      </label>
      <div>{children}</div>
      {show && hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function Section({ children }) {
  return <div className="field-section" style={{ '--sec-hue': hueOf(children) }}>{children}</div>;
}

// 'rightPaneFontSize' → 'right pane font size' for the difference chips.
const prettyKey = (k) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();

export default function SettingsDialog({ settings, onPatch, onClose, title = 'Tab Settings', matchCurrent, onResetFactory, onOpenFontManager, diffAgainst, profiles, onProfilesChange }) {
  const [s, setS] = useState(settings);
  const metroRef = useRef(null);

  function patch(p) {
    const next = { ...s, ...p };
    setS(next);
    onPatch(p);
  }

  // Difference chips: Tab Settings and Default Tab Settings share this dialog, and the settings
  // that currently DIFFER between the open tab and the defaults are named individually here.
  // diffAgainst = { other, label, resettable } — resettable chips carry an ✕ that restores that
  // one setting to its default.
  const diffKeys = diffAgainst?.other
    ? (diffAgainst.resettable ? offDefaultKeys(s, diffAgainst.other) : offDefaultKeys(diffAgainst.other, s))
    : [];
  const diffBase = diffAgainst?.other ? { ...defaultFileSettings(), ...diffAgainst.other } : null;

  const metro = { ...DEFAULT_METRONOME, ...(s.metronome || {}) };
  function patchMetro(p) {
    patch({ metronome: { ...metro, ...p } });
  }
  function tryMetro() {
    if (!metroRef.current) metroRef.current = createMetronome();
    metroRef.current.preview(
      { wpm: s.wpm || 300, subdivision: metro.subdivision, accentEvery: metro.accentEvery, volume: metro.volume },
      8,
    );
  }

  const cwStyles = readCwStyles(s);
  function toggleCwStyle(name) {
    const set = new Set(cwStyles);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ currentWordStyles: [...set] });
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={620}
      buttons={
        <>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      {profiles && onProfilesChange && (
        <ProfilesBar
          kind="tab"
          profiles={profiles}
          onChange={onProfilesChange}
          capture={() => tabDefaultsFrom(s)}
          apply={(data) => { setS({ ...s, ...data }); onPatch(data); }}
        />
      )}
      {matchCurrent && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const next = matchCurrent(); if (next) patch(next); }}>⤓ Match current tab</button>
          <span>Copy the open tab’s appearance &amp; behaviour into these defaults (its reading progress isn’t copied).</span>
        </p>
      )}
      {diffAgainst && (
        <div className="sd-diffs">
          <span className="sd-diffs-label">{diffAgainst.label}</span>
          {diffKeys.length === 0 && <span className="sd-diff-none">none — identical</span>}
          {diffKeys.map((k) => (
            <span key={k} className="sd-diff-chip" title={diffAgainst.resettable ? 'Click ✕ to restore this setting to your default' : ''}>
              {prettyKey(k)}
              {diffAgainst.resettable && (
                <button type="button" onClick={() => patch({ [k]: diffBase[k] })} title="Reset to default">✕</button>
              )}
            </span>
          ))}
        </div>
      )}
      {onResetFactory && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => {
              if (!window.confirm('Reset these default tab settings to the original factory defaults? Open tabs keep their own settings.')) return;
              const d = onResetFactory();
              if (d) setS(d);
            }}
          >↺ Reset to factory defaults</button>
          <span>Restore the original out-of-the-box defaults for new tabs.</span>
        </p>
      )}
      <div className="dlg-cols">
      <Section>Fast Reader</Section>
      <Field label="Context words before">
        <input
          type="number"
          min={0}
          max={10}
          value={s.contextWordsBefore >= 0 ? s.contextWordsBefore : s.contextWordCount || 0}
          onChange={(e) => patch({ contextWordsBefore: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label="Context words after">
        <input
          type="number"
          min={0}
          max={10}
          value={s.contextWordsAfter >= 0 ? s.contextWordsAfter : s.contextWordCount || 0}
          onChange={(e) => patch({ contextWordsAfter: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      {onOpenFontManager && (
        <Field label="Reading font">
          <button type="button" onClick={onOpenFontManager} title="One font for the Fast Reader word, the Lines pane, and typing — with search, favorites and readability sorting">
            🗛 Open Font Manager…
          </button>
        </Field>
      )}
      <Field label="Show guide lines">
        <input type="checkbox" checked={s.showGuideLines} onChange={(e) => patch({ showGuideLines: e.target.checked })} />
      </Field>
      <Field label="Guide color">
        <select value={s.guideColor} onChange={(e) => patch({ guideColor: e.target.value })}>
          {GUIDE_COLORS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Highlight ORP character">
        <input type="checkbox" checked={s.highlightORP} onChange={(e) => patch({ highlightORP: e.target.checked })} />
      </Field>
      <Field label="ORP highlight colour (Lines)">
        <div className="swatch-row">
          {HIGHLIGHT_COLORS.map(([hex, label]) => (
            <button
              key={hex || 'theme'}
              type="button"
              className={`swatch${(s.orpColor || '') === hex ? ' on' : ''}`}
              style={hex ? { background: hex } : undefined}
              title={hex ? label : 'Theme default (usually red)'}
              onClick={() => patch({ orpColor: hex })}
            >{hex ? '' : 'A'}</button>
          ))}
          <input type="color" className="swatch-custom" value={s.orpColor || '#d24a43'} onChange={(e) => patch({ orpColor: e.target.value })} title="Custom colour" />
        </div>
      </Field>
      <Field label="ORP horizontal position (%)">
        <input
          type="range"
          min={10}
          max={90}
          step={5}
          value={Math.round((s.orpHorizontalPercent ?? 0.5) * 100)}
          onChange={(e) => patch({ orpHorizontalPercent: Math.max(0.1, Math.min(0.9, Number(e.target.value) / 100)) })}
        />
        <span className="range-val">{Math.round((s.orpHorizontalPercent ?? 0.5) * 100)}%</span>
      </Field>
      <Field label="Eye focuser at the ORP">
        <select value={s.rsvpFocus || 'none'} onChange={(e) => patch({ rsvpFocus: e.target.value })}>
          <option value="none">None</option>
          <option value="fisheye">Fisheye lens</option>
          <option value="pulse">ORP pulse</option>
          <option value="converge">Converge</option>
        </select>
      </Field>
      <Field label="Breathe the pace (sinusoidal WPM)">
        <input type="checkbox" checked={!!s.wpmWave} onChange={(e) => patch({ wpmWave: e.target.checked })} />
      </Field>
      {s.wpmWave && (
        <>
          <Field label="Breathe depth (± fraction of WPM)">
            <input
              type="range"
              min={0.05}
              max={0.6}
              step={0.05}
              value={s.wpmWaveDepth ?? 0.25}
              onChange={(e) => patch({ wpmWaveDepth: Math.max(0.05, Math.min(0.6, Number(e.target.value))) })}
            />
            <span className="range-val">±{Math.round((s.wpmWaveDepth ?? 0.25) * 100)}%</span>
          </Field>
          <Field label="Breathe period (sec per cycle)">
            <input
              type="number"
              min={4}
              max={120}
              value={s.wpmWavePeriodSec ?? 18}
              onChange={(e) => patch({ wpmWavePeriodSec: Math.max(4, Math.min(120, Number(e.target.value) || 18)) })}
            />
          </Field>
        </>
      )}
      <Field label="Hide Fast Reader pane">
        <input type="checkbox" checked={s.hideRsvpPane} onChange={(e) => patch({ hideRsvpPane: e.target.checked })} />
      </Field>

      <Section>Reading theme</Section>
      <Field label="Theme">
        <select
          value={s.themeName || (s.darkMode ? 'Dark' : 'Light')}
          onChange={(e) => patch({ themeName: e.target.value })}
        >
          {THEME_CATEGORIES.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.themes.map((n) => <option key={n} value={n}>{n}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      <Section>Line view (right pane)</Section>
      <Field label="Lines pane font size (px)">
        <input
          type="number"
          min={8}
          max={40}
          value={s.rightPaneFontSize}
          onChange={(e) => patch({ rightPaneFontSize: Math.max(8, Math.min(40, Number(e.target.value) || 12)) })}
        />
      </Field>
      <Field label="Line spacing (1 = single)">
        <input
          type="number"
          min={1}
          max={3}
          step={0.1}
          value={s.lineSpacing ?? 1.5}
          onChange={(e) => patch({ lineSpacing: Math.max(1, Math.min(3, Number(e.target.value) || 1.5)) })}
        />
      </Field>
      <Field label="Text alignment">
        <select value={s.textAlignment} onChange={(e) => patch({ textAlignment: e.target.value })}>
          {ALIGNMENTS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Field>
      <Field label="% separators">
        <input
          type="checkbox"
          checked={s.showPercentSeparators}
          onChange={(e) => patch({ showPercentSeparators: e.target.checked })}
        />
      </Field>
      <Field label="Faint gridlines (Lines pane background)">
        <label className="inline-check" title="Faint horizontal rules at the line rhythm">
          <input type="checkbox" checked={!!s.linesGridH} onChange={(e) => patch({ linesGridH: e.target.checked })} /> Horizontal
        </label>
        <label className="inline-check" title="Faint vertical rules across the pane">
          <input type="checkbox" checked={!!s.linesGridV} onChange={(e) => patch({ linesGridV: e.target.checked })} /> Vertical
        </label>
      </Field>
      <Field label="Word substitutions (this document)">
        <WordSwapsEditor swaps={s.wordSwaps || {}} onChange={(m) => patch({ wordSwaps: m })} />
      </Field>
      <Field label="Wall of text (merge lines into blocks)">
        <input type="checkbox" checked={!!s.wallText} onChange={(e) => patch({ wallText: e.target.checked })} />
      </Field>
      {s.wallText && (
        <Field label="Wall: break every N lines (0 = sections / % only)">
          <input
            type="number"
            min={0}
            max={500}
            value={s.wallBreakEvery || 0}
            onChange={(e) => patch({ wallBreakEvery: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })}
          />
        </Field>
      )}
      <Field label="Alternate unread sentence colours">
        <input
          type="checkbox"
          checked={!!s.altSentenceColors}
          onChange={(e) => patch({ altSentenceColors: e.target.checked })}
        />
      </Field>
      <Field label="Split pane (before / current / after)">
        <input
          type="checkbox"
          checked={!!s.linePaneSplit}
          onChange={(e) => patch({ linePaneSplit: e.target.checked })}
        />
      </Field>
      <Field label="Center current line">
        <input
          type="checkbox"
          checked={s.centerOnCurrent !== false}
          onChange={(e) => patch({ centerOnCurrent: e.target.checked })}
        />
      </Field>
      <Field label="Line jump: long-press hold (ms, 0 = instant click)">
        <input
          type="number"
          min={0}
          max={6000}
          step={250}
          value={s.lineLongPressMs ?? 450}
          onChange={(e) => patch({ lineLongPressMs: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label="Reveal mode (hide text ahead)">
        <select value={s.hideMode || 'None'} onChange={(e) => patch({ hideMode: e.target.value })}>
          <option>None</option>
          <option>Words</option>
          <option>Lines</option>
          <option>Sentences</option>
          <option>Paragraphs</option>
        </select>
      </Field>
      <Field label="Scroll read point (%)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={0} max={100} step={5} value={Math.round((s.scrollReadPoint ?? 0) * 100)} onChange={(e) => patch({ scrollReadPoint: Number(e.target.value) / 100 })} />
          <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{Math.round((s.scrollReadPoint ?? 0) * 100)}%</span>
        </div>
      </Field>
      <Field label="Click sound on line advance">
        <input
          type="checkbox"
          checked={!!s.lineAdvanceSound}
          onChange={(e) => patch({ lineAdvanceSound: e.target.checked })}
        />
      </Field>
      <Field label="Line sound">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={s.lineSoundKind || 'soft'}
            disabled={!s.lineAdvanceSound}
            onChange={(e) => { patch({ lineSoundKind: e.target.value }); if (e.target.value !== 'random') playLineSound(e.target.value); }}
          >
            {LINE_SOUNDS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" disabled={!s.lineAdvanceSound} title="Preview" onClick={() => playLineSound(s.lineSoundKind || 'soft')}>▶ Test</button>
        </div>
      </Field>
      <Field label="Bionic font">
        <input type="checkbox" checked={s.bionicFont} onChange={(e) => patch({ bionicFont: e.target.checked })} />
      </Field>
      <Field label="Current-line highlight">
        <input
          type="checkbox"
          checked={s.currentLineHighlight !== false}
          onChange={(e) => patch({ currentLineHighlight: e.target.checked })}
        />
      </Field>
      <Field label="Current-word highlight (combine any)">
        <div className="checkbox-group">
          {CURRENT_WORD_STYLES.map((name) => {
            const active = cwStyles.includes(name);
            return (
              <label key={name} className="checkbox-pill">
                <input type="checkbox" checked={active} onChange={() => toggleCwStyle(name)} />
                {name}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label="Current-word colour">
        <div className="swatch-row">
          {HIGHLIGHT_COLORS.map(([hex, label]) => (
            <button
              key={hex || 'theme'}
              type="button"
              className={`swatch${(s.currentWordColor || '') === hex ? ' on' : ''}`}
              style={hex ? { background: hex } : undefined}
              title={label}
              onClick={() => patch({ currentWordColor: hex })}
            >{hex ? '' : 'A'}</button>
          ))}
          <input type="color" className="swatch-custom" value={s.currentWordColor || '#ffd54f'} onChange={(e) => patch({ currentWordColor: e.target.value })} title="Custom colour" />
        </div>
      </Field>
      <Field label="Current-word font size adjust (pt)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={-3} max={3} step={0.5}
            value={s.currentWordFontDelta ?? 0}
            onChange={(e) => patch({ currentWordFontDelta: Math.max(-3, Math.min(3, Number(e.target.value) || 0)) })}
          />
          <span>{(s.currentWordFontDelta ?? 0) > 0 ? '+' : ''}{s.currentWordFontDelta ?? 0}pt</span>
          {(s.currentWordFontDelta ?? 0) !== 0 && <button type="button" onClick={() => patch({ currentWordFontDelta: 0 })}>Reset</button>}
        </div>
      </Field>

      <Section>Table of contents</Section>
      <Field label="Heading line style (line view)">
        <select value={s.tocHeadingStyle ?? 'auto'} onChange={(e) => patch({ tocHeadingStyle: e.target.value })}>
          <option value="auto">Auto (match theme)</option>
          <option value="off">Off (plain)</option>
          {HEADING_PACKS.map((p) => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        Styles the lines that are chapter/section headings in the Lines pane, with a distinct look per
        tier. “Auto” picks a style that suits the current theme.
      </p>
      <Field label="Auto-collapse completed sections">
        <input
          type="checkbox"
          checked={!!s.tocCollapseCompleted}
          onChange={(e) => patch({ tocCollapseCompleted: e.target.checked })}
        />
      </Field>
      <Field label="ToC-bar numeral">
        <select value={s.tocBarNumeralStyle || 'none'} onChange={(e) => patch({ tocBarNumeralStyle: e.target.value })}>
          <option value="none">None</option>
          <option value="arabic">Arabic (2)</option>
          <option value="roman">Roman (II)</option>
          <option value="words">Words (Two)</option>
        </select>
      </Field>
      {[0, 1, 2].map((lvl) => (
        <Field key={lvl} label={`Tier ${lvl} numeral regex`}>
          <input
            type="text"
            placeholder="auto (capture group 1)"
            value={(s.tocNumeralRegex || [])[lvl] || ''}
            onChange={(e) => {
              const arr = [...(s.tocNumeralRegex || [])];
              arr[lvl] = e.target.value;
              patch({ tocNumeralRegex: arr });
            }}
            style={{ width: '100%' }}
          />
        </Field>
      ))}
      <p className="settings-note">
        Numeral regex handles odd headings (e.g. <code>Chapter II: Three by 2</code>): the first
        capture group is the numeral. Leave blank to auto-detect a roman or arabic number.
      </p>

      <Section>Animated faces</Section>
      <Field label="Show faces">
        <input type="checkbox" checked={!!s.showEyes} onChange={(e) => patch({ showEyes: e.target.checked })} />
      </Field>
      <Field label="Face count (1–3)">
        <input
          type="number"
          min={1}
          max={3}
          value={s.faceCount || 1}
          onChange={(e) => patch({ faceCount: Math.max(1, Math.min(3, Number(e.target.value))) })}
        />
      </Field>
      {[0, 1, 2].slice(0, s.faceCount || 1).map((slot) => (
        <Field key={slot} label={`Face ${slot + 1} style`}>
          <select
            value={(s.faceStyles && s.faceStyles[slot]) || FACE_STYLES[slot] || 'Man'}
            onChange={(e) => {
              const arr = [...(s.faceStyles || [])];
              while (arr.length < 3) arr.push(FACE_STYLES[arr.length] || 'Man');
              arr[slot] = e.target.value;
              patch({ faceStyles: arr });
            }}
          >
            {FACE_STYLES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
      ))}
      <Field label="Art style">
        <select value={s.artStyle || 'Cartoon'} onChange={(e) => patch({ artStyle: e.target.value })}>
          {ART_STYLES.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Field>
      <Field label="Mobile face transparency">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={s.faceOpacity ?? 0.9}
            onChange={(e) => patch({ faceOpacity: Number(e.target.value) })}
          />
          <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{Math.round((s.faceOpacity ?? 0.9) * 100)}%</span>
        </div>
      </Field>
      <Field label="Mobile stats transparency">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={s.statsOpacity ?? 0.92}
            onChange={(e) => patch({ statsOpacity: Number(e.target.value) })}
          />
          <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{Math.round((s.statsOpacity ?? 0.92) * 100)}%</span>
        </div>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        On phones the face and the reading stats each float as separate draggable popups — drag
        them anywhere over the page; these set how see-through each is. Toggle them from the menu’s
        Faces / Stats panel chips.
      </p>

      <Section>Stats chip</Section>
      <p className="settings-note" style={{ margin: '2px 0 4px' }}>Choose what the reading-stats block (dock &amp; floating chip) shows. Defaults match the original layout; the rest are extras.</p>
      <div className="stats-chip-picks">
        {STATS_CHIP_ITEMS.map(([key, label, def]) => (
          <label key={key} className="inline-check">
            <input
              type="checkbox"
              checked={s.statsChip?.[key] ?? def}
              onChange={(e) => patch({ statsChip: { ...(s.statsChip || {}), [key]: e.target.checked } })}
            /> {label}
          </label>
        ))}
      </div>

      {/* Reading-pointer settings archived — the feature isn't useful right now. Re-enable by
          restoring this block and flipping POINTER_ENABLED in LinePane.jsx.
      <Section>Reading pointer</Section>
      <Field label="Show pointer">
        <input type="checkbox" checked={!!s.showPointer} onChange={(e) => patch({ showPointer: e.target.checked })} />
      </Field>
      <Field label="Pointer style">
        <select value={s.pointerStyle || 'Arrow'} onChange={(e) => patch({ pointerStyle: e.target.value })}>
          {POINTER_STYLES.map((p) => (<option key={p}>{p}</option>))}
        </select>
      </Field>
      <Field label="Pointer placement">
        <select value={s.pointerPlacement || 'Left'} onChange={(e) => patch({ pointerPlacement: e.target.value })}>
          {POINTER_PLACEMENTS.map((p) => (<option key={p}>{p}</option>))}
        </select>
      </Field>
      <Field label="Pointer blink interval (ms, 0 = steady)">
        <input type="number" min={0} max={3000} step={100} value={s.pointerBlinkMs || 0}
          onChange={(e) => patch({ pointerBlinkMs: Number(e.target.value) })} />
      </Field>
      */}

      <Section>Focus window (obscure before / after)</Section>
      <Field label="Obscure with">
        <select value={s.obscureMode || 'blur'} onChange={(e) => patch({ obscureMode: e.target.value })}>
          <option value="blur">Blur</option>
          <option value="hide">Hide</option>
          <option value="redact">Redact (blackout)</option>
          <option value="illegible">Illegible (dots)</option>
          <option value="translate">Translate (another language)</option>
        </select>
      </Field>
      {(s.obscureMode === 'translate') && (
        <p className="settings-note" style={{ margin: '2px 0 0' }}>
          Windowed lines are shown translated into another language instead of English — pick the
          service and target under <b>Settings → Application Settings → Translation</b>.
        </p>
      )}
      <Field label="Side-by-side translation">
        <input type="checkbox" checked={!!s.parallelTranslation} onChange={(e) => patch({ parallelTranslation: e.target.checked })} />
      </Field>
      <Field label="Readable lines before (0 = off)">
        <input type="number" min={0} max={50} value={s.blurLinesBefore || 0} onChange={(e) => patch({ blurLinesBefore: Number(e.target.value) })} />
      </Field>
      <Field label="Readable lines after (0 = off)">
        <input type="number" min={0} max={50} value={s.blurLinesAfter || 0} onChange={(e) => patch({ blurLinesAfter: Number(e.target.value) })} />
      </Field>
      {(s.obscureMode || 'blur') === 'blur' && (
        <Field label="Blur strength (%)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min={0} max={100} step={5} value={s.blurGradient ?? 100} onChange={(e) => patch({ blurGradient: Number(e.target.value) })} />
            <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{s.blurGradient ?? 100}%</span>
          </div>
        </Field>
      )}
      <Field label="Current-line font boost (px)">
        <input type="number" min={0} max={12} value={s.currentLineFontSizeBoost || 0} onChange={(e) => patch({ currentLineFontSizeBoost: Number(e.target.value) })} />
      </Field>

      <Section>Playback</Section>
      <Field label="Paragraph break (sec)">
        <input
          type="number"
          step="0.1"
          min={0}
          max={3}
          value={s.paragraphBreakSecs}
          onChange={(e) => patch({ paragraphBreakSecs: Number(e.target.value) })}
        />
      </Field>
      <Field label="Line break pause (ms)">
        <input
          type="number"
          min={0}
          max={2000}
          value={s.lineBreakPauseMs}
          onChange={(e) => patch({ lineBreakPauseMs: Number(e.target.value) })}
        />
      </Field>
      <Field label="Detect proper names (heavy on large docs)">
        <input
          type="checkbox"
          checked={!!s.enableProperNames}
          onChange={(e) => patch({ enableProperNames: e.target.checked })}
        />
      </Field>
      <Field label="Auto-skip headers/footers">
        <input
          type="checkbox"
          checked={s.autoSkipHeaders}
          onChange={(e) => patch({ autoSkipHeaders: e.target.checked })}
        />
      </Field>

      <Section>Rhythmic pacing (metronome)</Section>
      <Field label="Enable beat at reading pace">
        <input
          type="checkbox"
          checked={!!metro.enabled}
          onChange={(e) => patchMetro({ enabled: e.target.checked })}
        />
      </Field>
      <Field label="Volume">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={metro.volume}
          onChange={(e) => patchMetro({ volume: Number(e.target.value) })}
        />
      </Field>
      <Field label="Ticks per word">
        <select value={metro.subdivision} onChange={(e) => patchMetro({ subdivision: Number(e.target.value) })}>
          <option value={1}>1 — one beat per word</option>
          <option value={2}>2 — half-beats</option>
          <option value={3}>3 — triplets</option>
          <option value={4}>4 — quarter-beats</option>
        </select>
      </Field>
      <Field label="Accent every N beats (0 = off)">
        <input
          type="number"
          min={0}
          max={8}
          value={metro.accentEvery}
          onChange={(e) => patchMetro({ accentEvery: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label="Preview">
        <button type="button" onClick={tryMetro}>♪ Try 8 beats</button>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        A steady pace cue at your current WPM — a cadence to read along with. The adaptive pacer
        still controls the actual speed, so the beat always matches the words. Plays only while reading.
      </p>

      <Section>Double-time multipliers (1.0 = off)</Section>
      <Field label="Proper names">
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeProperNamesMultiplier}
          onChange={(e) => patch({ doubleTimeProperNamesMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label="Long words">
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeLongWordsMultiplier}
          onChange={(e) => patch({ doubleTimeLongWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label="Long-word threshold">
        <input
          type="number"
          min={4}
          max={20}
          value={s.longWordThreshold}
          onChange={(e) => patch({ longWordThreshold: Number(e.target.value) })}
        />
      </Field>
      <Field label="Digit words">
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeDigitWordsMultiplier}
          onChange={(e) => patch({ doubleTimeDigitWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label="Special-char words">
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeSpecialWordsMultiplier}
          onChange={(e) => patch({ doubleTimeSpecialWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label="Surprisal-weighted dwell">
        <input type="checkbox" checked={!!s.surprisalDwell} onChange={(e) => patch({ surprisalDwell: e.target.checked })} />
      </Field>
      {s.surprisalDwell && (
        <Field label="Surprisal strength">
          <input type="range" min={0} max={1.5} step={0.1} value={s.surprisalStrength ?? 1} onChange={(e) => patch({ surprisalStrength: Number(e.target.value) })} />
        </Field>
      )}
      <p className="settings-note" style={{ margin: '2px 0 0' }}>Spends more time on rare/informative words and less on common ones — your average WPM is unchanged.</p>

      {/* Read-aloud voice/rate live in Audio → Audio Settings; typing rules in Typing → Typing Settings. */}
      <Section>Speaking minigame</Section>
      <Field label="Speaking — confidence">
        <select
          value={s.speaking?.confidence || 'Medium'}
          onChange={(e) => patch({ speaking: { ...s.speaking, confidence: e.target.value } })}
        >
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
        </select>
      </Field>
      <Field label="Speaking — per-word timeout (ms)">
        <input
          type="number"
          min={0}
          max={60000}
          value={s.speaking?.perWordTimeoutMs || 0}
          onChange={(e) => patch({ speaking: { ...s.speaking, perWordTimeoutMs: Number(e.target.value) } })}
        />
      </Field>
      </div>
    </Dialog>
  );
}

// Per-document word-substitution list editor (render one word as another; display only).
function WordSwapsEditor({ swaps, onChange }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rows = Object.entries(swaps);
  const add = () => {
    if (!from.trim() || !to.trim()) return;
    onChange({ ...swaps, [from.trim().toLowerCase()]: to.trim() });
    setFrom(''); setTo('');
  };
  return (
    <div className="wordswap-ed">
      {rows.map(([f, t]) => (
        <div key={f} className="wordswap-row">
          <code>{f}</code><span>→</span><code>{t}</code>
          <button type="button" className="close-x" title="Remove this substitution" onClick={() => { const m = { ...swaps }; delete m[f]; onChange(m); }}>×</button>
        </div>
      ))}
      <div className="wordswap-row">
        <input placeholder="word in text" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 110 }} />
        <span>→</span>
        <input placeholder="show as" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 110 }} />
        <button type="button" disabled={!from.trim() || !to.trim()} onClick={add}>＋ Add</button>
      </div>
      <p className="settings-note" style={{ margin: '4px 0 0' }}>
        Display-only, this document only. Whole words, case-insensitive; a leading capital is kept
        (shown in the Lines pane and the Fast Reader — search and read-aloud use the original text).
      </p>
    </div>
  );
}
