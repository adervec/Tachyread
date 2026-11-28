import { useRef, useState } from 'react';
import { HEADING_DETAIL_ITEMS } from '../features/headingMeta.js';
import Dialog from './Dialog.jsx';
import { THEME_CATEGORIES, HEADING_PACKS, tabThemeName } from '../state/themes.js';
import { offDefaultKeys, defaultFileSettings, tabDefaultsFrom } from '../state/settings.js';
import ProfilesBar from '../components/ProfilesBar.jsx';
import { createMetronome } from '../features/metronome.js';
import { DEFAULT_METRONOME } from '../engine/metronome.js';
import { LINE_SOUNDS, playLineSound } from '../features/clickSound.js';
import { FACE_STYLES } from '../components/faceDecor3d.js';
import { STATS_CHIP_ITEMS } from '../components/ReadingStats.jsx';
import { HIGHLIGHT_ALGOS, HIGHLIGHT_STYLES, highlightAlgoById } from '../features/highlightAlgos.js';
import { speakParams } from '../features/speakAlign.js';
import { t } from '../i18n.js';

// Shown text for a stored option value (the value itself stays English; only the label is translated).
const lbl = (map, v) => map[v] ?? v;

const ART_STYLES = ['Cartoon', 'Flat', 'Sketch', 'Neon', 'Watercolor', 'Pastel'];
const ART_STYLE_LABELS = {
  Cartoon: t('Cartoon'), Flat: t('Flat'), Sketch: t('Sketch'), Neon: t('Neon'), Watercolor: t('Watercolor'), Pastel: t('Pastel'),
};
// Reading-pointer options archived with its Settings section (see below). Restore alongside it.
// const POINTER_STYLES = ['Arrow', 'Diamond', 'Star', 'Circle', 'Hand'];
// const POINTER_PLACEMENTS = ['Above', 'Below', 'Left', 'Right'];
const CURRENT_WORD_STYLES = ['Underline', 'Overline', 'Bold', 'Italic', 'Color', 'Background', 'Box', 'Glow'];
// Looks for the already-read words in the CURRENT line (combinable; empty = they look like any other).
const DONE_WORD_STYLES = ['Dim', 'Faint', 'Strikethrough', 'Italic', 'Color', 'Background'];
// Lines-pane ORP looks (combinable). Larger/Caps change glyph metrics, so they re-wrap lines, and
// Tilt/Bob use an inline box that can add a wrap point at the letter — the titles say so; the rest
// are paint-only.
const ORP_STYLES = ['Bold', 'Glow', 'Pulse', 'Shimmer', 'Flash', 'Underline', 'Overline', 'Box', 'Ring', 'Background', 'Invert', 'Outline', 'Shadow', 'Dot', 'Italic', 'Tilt', 'Bob', 'Larger', 'Caps'];
// Display labels for the style names above (current-word, already-read and ORP looks).
const STYLE_LABELS = {
  Underline: t('Underline'), Overline: t('Overline'), Bold: t('Bold'), Italic: t('Italic'), Color: t('Color'),
  Background: t('Background'), Box: t('Box'), Glow: t('Glow'), Dim: t('Dim'), Faint: t('Faint'),
  Strikethrough: t('Strikethrough'), Pulse: t('Pulse'), Shimmer: t('Shimmer'), Flash: t('Flash'), Ring: t('Ring'),
  Invert: t('Invert'), Outline: t('Outline'), Shadow: t('Shadow'), Dot: t('Dot'), Tilt: t('Tilt'), Bob: t('Bob'),
  Larger: t('Larger'), Caps: t('Caps'),
};
// ORP letter fonts (Lines pane). '' = same font as the surrounding text. Font names stay as they are.
const ORP_FONTS = [
  ['', t('Same as the text')],
  ['Georgia, serif', 'Georgia (serif)'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ['Verdana, sans-serif', 'Verdana'],
  ["'Courier New', monospace", 'Courier New (mono)'],
  ["'Lexend', sans-serif", 'Lexend'],
  ["'Atkinson Hyperlegible', sans-serif", 'Atkinson Hyperlegible'],
  ["'OpenDyslexic', 'Comic Sans MS', sans-serif", 'OpenDyslexic'],
  ["'Comic Sans MS', cursive", 'Comic Sans MS'],
  ['Impact, sans-serif', 'Impact'],
  ["'Segoe Script', 'Comic Sans MS', cursive", 'Segoe Script'],
];
// Named highlight colours shared by the current-word highlight and the source cursor. '' = theme default.
const HIGHLIGHT_COLORS = [
  ['', t('Theme')], ['#ffd54f', t('Amber')], ['#4fd8ff', t('Cyan')], ['#7dff8a', t('Green')],
  ['#ff7ab0', t('Pink')], ['#ffb04f', t('Orange')], ['#b58cff', t('Purple')], ['#ff5c5c', t('Red')],
];

// Back-compat: older saved tabs used a single `currentWordStyle` string.
function readCwStyles(s) {
  if (Array.isArray(s.currentWordStyles)) return s.currentWordStyles;
  if (s.currentWordStyle) return [s.currentWordStyle];
  return ['Underline'];
}

// Wall-of-text newline markers. '' = a plain space (prose default); anything else is drawn faintly
// where each source line ended. Custom text goes in the box beside them.
const WALL_JOINERS = [
  ['', t('Nothing — just a space')], ['¶', t('Pilcrow')], ['·', t('Middle dot')], ['•', t('Bullet')],
  ['↵', t('Return arrow')], ['⏎', t('Return symbol')], ['/', t('Slash')], ['—', t('Em dash')],
  ['🔹', t('Blue diamond')], ['🍃', t('Leaf')], ['✦', t('Star')],
];

// Temporary style a line gets as it first scrolls into the Lines pane (settles back over N seconds).
const LINE_ENTRY_EFFECTS = ['Fade', 'Glow', 'Highlight', 'Rise', 'Color'];
const LINE_ENTRY_LABELS = { Fade: t('Fade'), Glow: t('Glow'), Highlight: t('Highlight'), Rise: t('Rise'), Color: t('Color') };

const GUIDE_COLORS = ['Red', 'Pink', 'Orange', 'Green', 'Blue', 'Purple'];
const GUIDE_COLOR_LABELS = { Red: t('Red'), Pink: t('Pink'), Orange: t('Orange'), Green: t('Green'), Blue: t('Blue'), Purple: t('Purple') };
const ALIGNMENTS = ['Left', 'Center', 'Right', 'Justify'];
const ALIGNMENT_LABELS = { Left: t('Left'), Center: t('Center'), Right: t('Right'), Justify: t('Justify') };

// Avatar style names come from faceDecor3d.js (stored values); only their display is translated.
// i18n-keys: Man | Owl | Robot | Alien | Wizard | Cat | Baby | Skull | Panda | Frankenstein | Vampire | Viking | Clown | Bunny | Dragon | Ninja | Devil | Goblin | Pirate | Zombie | Pig | Bear | Fox | Mouse | Penguin | Astronaut | Unicorn | Santa | Knight | Witch | Frog | Lion | Koala | Tiger | Ghost | Elf | Chef | Cowboy | Professor | Grandma | Pumpkin | Snowman
const faceLabel = (f) => t(f);

// One-line explanations shown when you click a setting's label (keyed by label, so the Fields don't
// each need editing). Only the non-obvious settings need an entry; the rest show no ⓘ.
// Keyed by the TRANSLATED label, because each Field is given its label already translated.
const HINTS = {
  [t('Context words before')]: t('How many words before the current one to show faintly around the Fast Reader word, for peripheral context.'),
  [t('Context words after')]: t('How many words after the current one to show faintly around the Fast Reader word.'),
  [t('Show guide lines')]: t('Draw crosshair guides through the Fast Reader word to anchor your gaze.'),
  [t('Highlight ORP character')]: t('Tint the Optimal Recognition Point (the letter your eye should land on) so words centre themselves.'),
  [t('ORP larger size (+%)')]: t('How much bigger the "Larger" ORP style draws the pivot letter, as a percentage of the text size. Changing it re-wraps lines.'),
  [t('ORP letter font (Lines)')]: t('Draw the pivot letter in a font of its own so it stands apart from the text. A different font changes the letter’s width, so lines re-wrap.'),
  [t('ORP horizontal position (%)')]: t('Where across the pane the ORP letter is pinned — 50% centres it. The word halves grow to keep the ORP at this spot every word.'),
  [t('Eye focuser at the ORP')]: t('An extra effect that pulls the eye onto the ORP letter each word: fisheye (nearby letters swell toward it), pulse (the ORP flares), or converge (two bars sweep in and settle on it).'),
  [t('Breathe the pace (sinusoidal WPM)')]: t('Let the reading speed rise and fall smoothly around your WPM so the eye gets brief rests. The average speed is unchanged.'),
  [t('Breathe depth (± fraction of WPM)')]: t('How far the pace swings above and below your WPM. 0.25 = ±25%.'),
  [t('Breathe period (sec per cycle)')]: t('Seconds for one full fast → slow → fast cycle of the breathing pace.'),
  [t('Hide Fast Reader pane')]: t('Remove the flashing-word pane entirely and read only from the Lines pane.'),
  [t('Line spacing (1 = single)')]: t('Vertical spacing between lines in the Lines pane.'),
  [t('Auto font size (target chars per line)')]: t('Let the pane WIDTH drive the font: the size auto-adjusts so roughly this many characters fit on each line, and it follows window resizes and device rotation. Overrides the fixed font size; the A− / A+ buttons then nudge this target instead. 0 = off.'),
  [t('% separators')]: t('Show faint percentage markers down the Lines pane so you can see how far through you are.'),
  [t('Wall of text (merge lines into blocks)')]: t('Flow the source lines together into solid blocks (line breaks become spaces; paragraph breaks become an indent tab) instead of one row per source line. Blocks break at headings, % markers, or the interval below.'),
  [t('Wall: break every N lines (0 = sections / % only)')]: t('In wall-of-text mode, also start a new block every this-many source lines. 0 keeps blocks running until the next heading or % marker.'),
  [t('Alternate unread sentence colours')]: t('Give consecutive not-yet-read sentences a slightly different colour so where one ends and the next begins is easy to see.'),
  [t('Split pane (before / current / after)')]: t('Split the Lines pane into what you have read, the current line, and what is ahead.'),
  [t('Center current line')]: t('Keep the line you are reading pinned to the middle of the Lines pane instead of scrolling naturally.'),
  [t('Line jump: long-press hold (ms, 0 = instant click)')]: t('How long to hold a tap on a line before it jumps there (0 = a plain click jumps immediately).'),
  [t('Reveal mode (hide text ahead)')]: t('Progressively hide upcoming text (by word/line/sentence/paragraph) so you cannot read ahead.'),
  [t('Bionic font')]: t('Bold the first few letters of each word to pull your eye through the line faster.'),
  [t('Current-line highlight')]: t('Tint the whole current line in the Lines pane. Off, the line looks like any other and only the current-word highlight marks your position.'),
  [t('Current-word highlight (combine any)')]: t('How the word you are on is marked in the Lines pane — combine any of underline, bold, background, colour, box.'),
  [t('Completed words in current line (combine any)')]: t('Style the words you have already read within the current line — dim, strike through, tint… Handy when lines are paragraph-sized (wall of text), so you can see at a glance where you are inside the block. Empty = off.'),
  [t('Auto-collapse completed sections')]: t('Fold away ToC sections once you have finished reading them.'),
  [t('Show avatars')]: t('Animated reader faces whose expression tracks your pace and progress.'),
  [t('Paragraph break (sec)')]: t('Extra pause the auto-player takes at the end of a paragraph.'),
  [t('Line break pause (ms)')]: t('Extra pause the auto-player takes at the end of each line.'),
  [t('Detect proper names (heavy on large docs)')]: t('Find names/entities so they can be indexed and optionally dwelt on longer — slower on big books.'),
  [t('Auto-skip headers/footers')]: t('Skip repeated running headers/footers (page numbers, book title) while reading.'),
  [t('Surprisal-weighted dwell')]: t('Spend longer on rare/informative words and less on predictable ones — your average WPM is unchanged.'),
  [t('Enable beat at reading pace')]: t('A metronome click locked to your current WPM — a rhythm to read along with.'),
  [t('Obscure with')]: t('How the text past your readable window is hidden — blur, hide, redact (blackout bar), illegible dots, or translated into another language — to discourage backtracking or reading too far ahead.'),
  [t('Readable lines before (0 = off)')]: t('How many already-read lines above the current one stay clear. Set above 0, the next 100 lines beyond that window are obscured (stops deep backtracking); farther back is left clear for deliberate peeking. 0 = nothing above is obscured.'),
  [t('Readable lines after (0 = off)')]: t('How many upcoming lines below the current one stay clear. Set above 0, the next 100 lines beyond that window are obscured (stops accidental read-ahead); farther down is left clear. 0 = nothing below is obscured.'),
  [t('Side-by-side translation')]: t('Show each line in two columns: the original next to its translation (service + language from Application Settings → Translation). Lines are translated one-by-one so the columns always align.'),
  [t('Blur strength (%)')]: t('Overall blur strength. Your readable window stays clear; blur ramps to full over the first few lines of the obscured band beyond it. Lines past the 100-line band are left clear.'),
  [t('Scroll read point (%)')]: t('In scroll-to-read, where a line is counted as read: 0% = only once it scrolls off the top; higher = further down the clear (unblurred) area, up to as soon as it appears.'),
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

export default function SettingsDialog({ settings, onPatch, onClose, title = t('Tab Settings'), matchCurrent, onResetFactory, onOpenFontManager, diffAgainst, profiles, onProfilesChange, tabCount = 0, onApplyAll }) {
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

  const ghostStyles = Array.isArray(s.ghostWordStyles) ? s.ghostWordStyles : ['Box'];
  function toggleGhostStyle(name) {
    const set = new Set(ghostStyles);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ ghostWordStyles: [...set] });
  }

  const headingDetails = Array.isArray(s.headingDetails) ? s.headingDetails : [];
  function toggleHeadingDetail(name) {
    const set = new Set(headingDetails);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ headingDetails: [...set] });
  }

  const doneStyles = Array.isArray(s.doneWordStyles) ? s.doneWordStyles : [];
  function toggleDoneStyle(name) {
    const set = new Set(doneStyles);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ doneWordStyles: [...set] });
  }

  const orpStyles = Array.isArray(s.orpStyles) ? s.orpStyles : ['Bold'];
  function toggleOrpStyle(name) {
    const set = new Set(orpStyles);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ orpStyles: [...set] });
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={620}
      buttons={
        <>
          <button onClick={onClose}>{t('Close')}</button>
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
          applyAll={onApplyAll && tabCount > 1 ? (data) => { setS({ ...s, ...data }); onApplyAll(data); } : null}
          allCount={tabCount}
        />
      )}
      {matchCurrent && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const next = matchCurrent(); if (next) patch(next); }}>⤓ {t('Match current tab')}</button>
          <span>{t('Copy the open tab’s appearance & behaviour into these defaults (its reading progress isn’t copied).')}</span>
        </p>
      )}
      {diffAgainst && (
        <div className="sd-diffs">
          <span className="sd-diffs-label">{diffAgainst.label}</span>
          {diffKeys.length === 0 && <span className="sd-diff-none">{t('none — identical')}</span>}
          {diffKeys.map((k) => (
            <span key={k} className="sd-diff-chip" title={diffAgainst.resettable ? t('Click ✕ to restore this setting to your default') : ''}>
              {prettyKey(k)}
              {diffAgainst.resettable && (
                <button type="button" onClick={() => patch({ [k]: diffBase[k] })} title={t('Reset to default')}>✕</button>
              )}
            </span>
          ))}
        </div>
      )}
      {onResetFactory && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => {
              if (!window.confirm(t('Reset these default tab settings to the original factory defaults? Open tabs keep their own settings.'))) return;
              const d = onResetFactory();
              if (d) setS(d);
            }}
          >↺ {t('Reset to factory defaults')}</button>
          <span>{t('Restore the original out-of-the-box defaults for new tabs.')}</span>
        </p>
      )}
      <div className="dlg-cols">
      <Section>{t('Fast Reader')}</Section>
      <Field label={t('Context words before')}>
        <input
          type="number"
          min={0}
          max={10}
          value={s.contextWordsBefore >= 0 ? s.contextWordsBefore : s.contextWordCount || 0}
          onChange={(e) => patch({ contextWordsBefore: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label={t('Context words after')}>
        <input
          type="number"
          min={0}
          max={10}
          value={s.contextWordsAfter >= 0 ? s.contextWordsAfter : s.contextWordCount || 0}
          onChange={(e) => patch({ contextWordsAfter: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      {onOpenFontManager && (
        <Field label={t('Reading font')}>
          <button type="button" onClick={onOpenFontManager} title={t('One font for the Fast Reader word, the Lines pane, and typing — with search, favorites and readability sorting')}>
            🗛 {t('Open Font Manager…')}
          </button>
        </Field>
      )}
      <Field label={t('Show guide lines')}>
        <input type="checkbox" checked={s.showGuideLines} onChange={(e) => patch({ showGuideLines: e.target.checked })} />
      </Field>
      <Field label={t('Guide color')}>
        <select value={s.guideColor} onChange={(e) => patch({ guideColor: e.target.value })}>
          {GUIDE_COLORS.map((c) => (
            <option key={c} value={c}>{lbl(GUIDE_COLOR_LABELS, c)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('Highlight ORP character')}>
        <input type="checkbox" checked={s.highlightORP} onChange={(e) => patch({ highlightORP: e.target.checked })} />
      </Field>
      <Field label={t('ORP highlight colour (Lines)')}>
        <div className="swatch-row">
          {HIGHLIGHT_COLORS.map(([hex, label]) => (
            <button
              key={hex || 'theme'}
              type="button"
              className={`swatch${(s.orpColor || '') === hex ? ' on' : ''}`}
              style={hex ? { background: hex } : undefined}
              title={hex ? label : t('Theme default (usually red)')}
              onClick={() => patch({ orpColor: hex })}
            >{hex ? '' : 'A'}</button>
          ))}
          <input type="color" className="swatch-custom" value={s.orpColor || '#d24a43'} onChange={(e) => patch({ orpColor: e.target.value })} title={t('Custom colour')} />
        </div>
      </Field>
      <Field label={t('ORP style (Lines, combine any)')}>
        <div className="checkbox-group">
          {ORP_STYLES.map((name) => (
            <label
              key={name}
              className="checkbox-pill"
              title={name === 'Larger' || name === 'Caps'
                ? t('{name} — changes the letter’s size, so lines re-wrap', { name: lbl(STYLE_LABELS, name) })
                : name === 'Tilt' || name === 'Bob'
                  ? t('{name} — the letter sits in its own little box, which can let a line wrap at it', { name: lbl(STYLE_LABELS, name) })
                  : lbl(STYLE_LABELS, name)}
            >
              <input type="checkbox" checked={orpStyles.includes(name)} onChange={() => toggleOrpStyle(name)} />
              {lbl(STYLE_LABELS, name)}
            </label>
          ))}
        </div>
      </Field>
      {orpStyles.includes('Larger') && (
        <Field label={t('ORP larger size (+%)')}>
          <input
            type="range" min={5} max={80} step={1}
            value={s.orpLargerPct ?? 18}
            onChange={(e) => patch({ orpLargerPct: Math.max(5, Math.min(80, Number(e.target.value) || 18)) })}
          />
          <span className="range-val">+{s.orpLargerPct ?? 18}%</span>
        </Field>
      )}
      <Field label={t('ORP letter font (Lines)')}>
        <select value={s.orpFont || ''} onChange={(e) => patch({ orpFont: e.target.value })}>
          {s.orpFont && !ORP_FONTS.some(([v]) => v === s.orpFont) && <option value={s.orpFont}>{s.orpFont.split(',')[0].replace(/['"]/g, '')}</option>}
          {ORP_FONTS.map(([v, l]) => <option key={v || 'same'} value={v}>{l}</option>)}
        </select>
      </Field>
      {/* Live preview — these are purely visual (the sample sentence stays English: its ORP letters
          are picked by position), and hunting for the effect in the pane behind the
          dialog is a pain. Reuses the real .line-row/.orp-* rules so it can't drift. */}
      <div
        className="line-row orp-preview"
        style={{
          ...(s.orpColor ? { '--lines-orp': s.orpColor } : {}),
          ...(s.orpLargerPct != null ? { '--orp-larger': `${(100 + s.orpLargerPct) / 100}em` } : {}),
          ...(s.orpFont ? { '--orp-font': s.orpFont } : {}),
        }}
      >
        <span className="text">
          The qu<span className={['orp-char', ...orpStyles.map((st) => `orp-${st}`)].join(' ')}>i</span>ck brown fox
          {' '}jumps o<span className={['orp-char', ...orpStyles.map((st) => `orp-${st}`)].join(' ')}>v</span>er the lazy dog
        </span>
      </div>
      <Field label={t('ORP horizontal position (%)')}>
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

      <Section>{t('Highlight algorithm (Lines)')}</Section>
      <Field label={t('Algorithm')}>
        <select value={s.highlightAlgo || 'off'} onChange={(e) => patch({ highlightAlgo: e.target.value })}>
          {HIGHLIGHT_ALGOS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </Field>
      {(s.highlightAlgo || 'off') !== 'off' && (
        <>
          <p className="settings-note">{highlightAlgoById(s.highlightAlgo).desc}</p>
          <Field label={t('Flagged-word style')}>
            <select value={s.highlightStyle || 'bold'} onChange={(e) => patch({ highlightStyle: e.target.value })}>
              {HIGHLIGHT_STYLES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
            </select>
            {['tint', 'underline', 'glow'].includes(s.highlightStyle || 'bold') && (
              <>
                {' '}<input type="color" value={s.highlightColor || '#3a86ff'} title={t('Highlight colour')}
                  onChange={(e) => patch({ highlightColor: e.target.value })} />
                <button onClick={() => patch({ highlightColor: '' })} title={t('Back to the theme accent')}>↺</button>
              </>
            )}
          </Field>
        </>
      )}
      <Field label={t('Eye focuser at the ORP')}>
        <select value={s.rsvpFocus || 'none'} onChange={(e) => patch({ rsvpFocus: e.target.value })}>
          <option value="none">{t('None')}</option>
          <option value="fisheye">{t('Fisheye lens')}</option>
          <option value="pulse">{t('ORP pulse')}</option>
          <option value="converge">{t('Converge')}</option>
        </select>
      </Field>
      <Field label={t('Breathe the pace (sinusoidal WPM)')}>
        <input type="checkbox" checked={!!s.wpmWave} onChange={(e) => patch({ wpmWave: e.target.checked })} />
      </Field>
      {s.wpmWave && (
        <>
          <Field label={t('Breathe depth (± fraction of WPM)')}>
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
          <Field label={t('Breathe period (sec per cycle)')}>
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
      <Field label={t('Hide Fast Reader pane')}>
        <input type="checkbox" checked={s.hideRsvpPane} onChange={(e) => patch({ hideRsvpPane: e.target.checked })} />
      </Field>

      <Section>{t('Reading theme')}</Section>
      <Field label={t('Theme')}>
        <select
          value={tabThemeName(s)}
          onChange={(e) => patch({ themeName: e.target.value })}
        >
          {THEME_CATEGORIES.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.themes.map((n) => <option key={n} value={n}>{t(n)}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      <Section>{t('Line view (right pane)')}</Section>
      <Field label={t('Lines pane font size (px)')}>
        <input
          type="number"
          min={8}
          max={40}
          value={s.rightPaneFontSize}
          disabled={(s.autoFontCpl || 0) > 0}
          title={(s.autoFontCpl || 0) > 0 ? t('Auto font size is on — the pane width drives the font') : ''}
          onChange={(e) => patch({ rightPaneFontSize: Math.max(8, Math.min(40, Number(e.target.value) || 12)) })}
        />
      </Field>
      <Field label={t('Auto font size (target chars per line)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={0} max={140} step={5}
            value={s.autoFontCpl || 0}
            onChange={(e) => { const v = Number(e.target.value) || 0; patch({ autoFontCpl: v === 0 ? 0 : Math.max(20, v) }); }}
          />
          <span className="range-val">{s.autoFontCpl ? t('~{n} chars', { n: s.autoFontCpl }) : t('Off')}</span>
        </div>
      </Field>
      <Field label={t('Line spacing (1 = single)')}>
        <input
          type="number"
          min={1}
          max={3}
          step={0.1}
          value={s.lineSpacing ?? 1.5}
          onChange={(e) => patch({ lineSpacing: Math.max(1, Math.min(3, Number(e.target.value) || 1.5)) })}
        />
      </Field>
      <Field label={t('Text alignment')}>
        <select value={s.textAlignment} onChange={(e) => patch({ textAlignment: e.target.value })}>
          {ALIGNMENTS.map((a) => (
            <option key={a} value={a}>{lbl(ALIGNMENT_LABELS, a)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('% separators')}>
        <input
          type="checkbox"
          checked={s.showPercentSeparators}
          onChange={(e) => patch({ showPercentSeparators: e.target.checked })}
        />
      </Field>
      <Field label={t('Faint gridlines (Lines pane background)')}>
        <label className="inline-check" title={t('Faint horizontal rules at the line rhythm')}>
          <input type="checkbox" checked={!!s.linesGridH} onChange={(e) => patch({ linesGridH: e.target.checked })} /> {t('Horizontal')}
        </label>
        <label className="inline-check" title={t('Faint vertical rules across the pane')}>
          <input type="checkbox" checked={!!s.linesGridV} onChange={(e) => patch({ linesGridV: e.target.checked })} /> {t('Vertical')}
        </label>
      </Field>
      <Field label={t('New-line entry effect (Lines pane)')}>
        <select value={s.linesEntryEffect || ''} onChange={(e) => patch({ linesEntryEffect: e.target.value })} title={t('Give each line a brief style as it first scrolls into view, easing back to normal')}>
          <option value="">{t('Off')}</option>
          {LINE_ENTRY_EFFECTS.map((n) => <option key={n} value={n}>{lbl(LINE_ENTRY_LABELS, n)}</option>)}
        </select>
        {s.linesEntryEffect && (
          <>
            <input
              type="range" min={1} max={10} step={1}
              value={Math.max(1, Math.min(10, s.linesEntrySecs || 3))}
              onChange={(e) => patch({ linesEntrySecs: Number(e.target.value) })}
              title={t('How long the effect lasts before the line settles to normal')}
            />
            <span className="range-val">{Math.max(1, Math.min(10, s.linesEntrySecs || 3))}s</span>
          </>
        )}
      </Field>
      <Field label={t('Word substitutions (this document)')}>
        <WordSwapsEditor swaps={s.wordSwaps || {}} onChange={(m) => patch({ wordSwaps: m })} />
      </Field>
      <Field label={t('Wall of text (merge lines into blocks)')}>
        <input type="checkbox" checked={!!s.wallText} onChange={(e) => patch({ wallText: e.target.checked })} />
      </Field>
      {s.wallText && (
        <Field label={t('Wall: break every N lines (0 = sections / % only)')}>
          <input
            type="number"
            min={0}
            max={500}
            value={s.wallBreakEvery || 0}
            onChange={(e) => patch({ wallBreakEvery: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })}
          />
        </Field>
      )}
      {s.wallText && (
        <Field label={t('Wall: newline marker')}>
          <div className="joiner-row">
            {WALL_JOINERS.map(([val, label]) => (
              <button
                key={val || 'none'}
                type="button"
                className={`swatch joiner-preset${(s.wallJoiner || '') === val ? ' on' : ''}`}
                title={label}
                onClick={() => patch({ wallJoiner: val })}
              >{val || '␣'}</button>
            ))}
            <input
              type="text"
              maxLength={8}
              className="joiner-custom"
              value={s.wallJoiner || ''}
              placeholder={t('custom')}
              onChange={(e) => patch({ wallJoiner: e.target.value.replace(/\s+/g, '') })}
              title={t('Any characters or emoji — shown where each source newline was (spaces are stripped)')}
            />
          </div>
        </Field>
      )}
      <Field label={t('Alternate unread sentence colours')}>
        <input
          type="checkbox"
          checked={!!s.altSentenceColors}
          onChange={(e) => patch({ altSentenceColors: e.target.checked })}
        />
      </Field>
      <Field label={t('Split pane (before / current / after)')}>
        <input
          type="checkbox"
          checked={!!s.linePaneSplit}
          onChange={(e) => patch({ linePaneSplit: e.target.checked })}
        />
      </Field>
      <Field label={t('Center current line')}>
        <input
          type="checkbox"
          checked={s.centerOnCurrent !== false}
          onChange={(e) => patch({ centerOnCurrent: e.target.checked })}
        />
      </Field>
      <Field label={t('Line jump: long-press hold (ms, 0 = instant click)')}>
        <input
          type="number"
          min={0}
          max={6000}
          step={250}
          value={s.lineLongPressMs ?? 450}
          onChange={(e) => patch({ lineLongPressMs: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label={t('Reveal mode (hide text ahead)')}>
        <select value={s.hideMode || 'None'} onChange={(e) => patch({ hideMode: e.target.value })}>
          <option value="None">{t('None')}</option>
          <option value="Words">{t('Words')}</option>
          <option value="Lines">{t('Lines')}</option>
          <option value="Sentences">{t('Sentences')}</option>
          <option value="Paragraphs">{t('Paragraphs')}</option>
        </select>
      </Field>
      <Field label={t('Scroll read point (%)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={0} max={100} step={5} disabled={!!s.scrollReadCrosshair} value={Math.round((s.scrollReadPoint ?? 0) * 100)} onChange={(e) => patch({ scrollReadPoint: Number(e.target.value) / 100 })} />
          <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{s.scrollReadCrosshair ? `🎯 ${t('crosshair')}` : `${Math.round((s.scrollReadPoint ?? 0) * 100)}%`}</span>
        </div>
      </Field>
      <Field label={t('Tie read point to crosshair')}>
        <label className="inline-check" title={t('The scroll-read line sits at your first placed crosshair’s height — drag the crosshair in the Lines area to move where scrolled text counts as read (Extras → Crosshairs to place one)')}>
          <input type="checkbox" checked={!!s.scrollReadCrosshair} onChange={(e) => patch({ scrollReadCrosshair: e.target.checked })} />
          {t('Use the first placed crosshair as the scroll-read line')}
        </label>
      </Field>
      <Field label={t('Click sound on line advance')}>
        <input
          type="checkbox"
          checked={!!s.lineAdvanceSound}
          onChange={(e) => patch({ lineAdvanceSound: e.target.checked })}
        />
      </Field>
      <Field label={t('Line sound')}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={s.lineSoundKind || 'soft'}
            disabled={!s.lineAdvanceSound}
            onChange={(e) => { patch({ lineSoundKind: e.target.value }); if (e.target.value !== 'random') playLineSound(e.target.value); }}
          >
            {LINE_SOUNDS.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
          </select>
          <button type="button" disabled={!s.lineAdvanceSound} title={t('Preview')} onClick={() => playLineSound(s.lineSoundKind || 'soft')}>▶ {t('Test')}</button>
        </div>
      </Field>
      <Field label={t('Bionic font')}>
        <input type="checkbox" checked={s.bionicFont} onChange={(e) => patch({ bionicFont: e.target.checked })} />
      </Field>
      <Field label={t('Current-line highlight')}>
        <input
          type="checkbox"
          checked={s.currentLineHighlight !== false}
          onChange={(e) => patch({ currentLineHighlight: e.target.checked })}
        />
      </Field>
      <Field label={t('Current-word highlight (combine any)')}>
        <div className="checkbox-group">
          {CURRENT_WORD_STYLES.map((name) => {
            const active = cwStyles.includes(name);
            return (
              <label key={name} className="checkbox-pill">
                <input type="checkbox" checked={active} onChange={() => toggleCwStyle(name)} />
                {lbl(STYLE_LABELS, name)}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label={t('Current-word colour')}>
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
          <input type="color" className="swatch-custom" value={s.currentWordColor || '#ffd54f'} onChange={(e) => patch({ currentWordColor: e.target.value })} title={t('Custom colour')} />
        </div>
      </Field>
      <Field label={t('Completed words in current line (combine any)')}>
        <div className="checkbox-group">
          {DONE_WORD_STYLES.map((name) => {
            const active = doneStyles.includes(name);
            return (
              <label key={name} className="checkbox-pill">
                <input type="checkbox" checked={active} onChange={() => toggleDoneStyle(name)} />
                {lbl(STYLE_LABELS, name)}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label={t('Current-word font size adjust (pt)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={-3} max={3} step={0.5}
            value={s.currentWordFontDelta ?? 0}
            onChange={(e) => patch({ currentWordFontDelta: Math.max(-3, Math.min(3, Number(e.target.value) || 0)) })}
          />
          <span>{(s.currentWordFontDelta ?? 0) > 0 ? '+' : ''}{s.currentWordFontDelta ?? 0}pt</span>
          {(s.currentWordFontDelta ?? 0) !== 0 && <button type="button" onClick={() => patch({ currentWordFontDelta: 0 })}>{t('Reset')}</button>}
        </div>
      </Field>

      <Section>{t('Pace ghost')}</Section>
      <Field label={t('Lead ghost in scroll mode')}>
        <input type="checkbox" checked={!!s.scrollGhost} onChange={(e) => patch({ scrollGhost: e.target.checked })} />
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 6px' }}>
        {t('In scroll-to-read, a ghost runs ahead of your scrolled word at the WPM above — the speed auto-play would go — so your eye can follow it while you keep scroll mode’s calm, manual control.')}
        {' '}{t('Every forward scroll restarts it from your new word; it keeps going while you don’t scroll, up to 250 words ahead.')}
        {' '}{t('Its look is the ghost style below.')}
      </p>
      <Field label={t('Race a pace ghost')}>
        <input type="checkbox" checked={!!s.paceGhost} onChange={(e) => patch({ paceGhost: e.target.checked })} />
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 6px' }}>
        {t('While you read manually, a ghost marker walks the text at the WPM above so you have something to race.')}
        {' '}{t('The controls bar shows how far ahead or behind you are, with ↺ to restart it from your word; it also restarts itself whenever you go idle or jump.')}
        {' '}{t('Auto-play already moves at that speed, so the ghost stands down while it’s running.')}
      </p>
      <Field label={t('Ghost-word highlight (combine any)')}>
        <div className="checkbox-group">
          {CURRENT_WORD_STYLES.map((name) => {
            const active = ghostStyles.includes(name);
            return (
              <label key={name} className="checkbox-pill">
                <input type="checkbox" checked={active} onChange={() => toggleGhostStyle(name)} />
                {lbl(STYLE_LABELS, name)}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label={t('Ghost-word colour')}>
        <div className="swatch-row">
          {HIGHLIGHT_COLORS.map(([hex, label]) => (
            <button
              key={hex || 'theme'}
              type="button"
              className={`swatch${(s.ghostWordColor || '') === hex ? ' on' : ''}`}
              style={hex ? { background: hex } : undefined}
              title={label}
              onClick={() => patch({ ghostWordColor: hex })}
            >{hex ? '' : 'A'}</button>
          ))}
          <input type="color" className="swatch-custom" value={s.ghostWordColor || '#7c5cff'} onChange={(e) => patch({ ghostWordColor: e.target.value })} title={t('Custom colour')} />
        </div>
      </Field>
      <Field label={t('Ghost-word font size adjust (pt)')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range" min={-3} max={3} step={0.5}
            value={s.ghostWordFontDelta ?? 0}
            onChange={(e) => patch({ ghostWordFontDelta: Math.max(-3, Math.min(3, Number(e.target.value) || 0)) })}
          />
          <span>{(s.ghostWordFontDelta ?? 0) > 0 ? '+' : ''}{s.ghostWordFontDelta ?? 0}pt</span>
          {(s.ghostWordFontDelta ?? 0) !== 0 && <button type="button" onClick={() => patch({ ghostWordFontDelta: 0 })}>{t('Reset')}</button>}
        </div>
      </Field>

      <Section>{t('Table of contents')}</Section>
      <Field label={t('Heading line style (line view)')}>
        <select value={s.tocHeadingStyle ?? 'auto'} onChange={(e) => patch({ tocHeadingStyle: e.target.value })}>
          <option value="auto">{t('Auto (match theme)')}</option>
          <option value="off">{t('Off (plain)')}</option>
          {HEADING_PACKS.map((p) => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('Section header details (combine any)')}>
        <div className="checkbox-group">
          {HEADING_DETAIL_ITEMS.map(([id, label]) => (
            <label key={id} className="checkbox-pill">
              <input type="checkbox" checked={headingDetails.includes(id)} onChange={() => toggleHeadingDetail(id)} />
              {label}
            </label>
          ))}
        </div>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 8px' }}>
        {t('Prints these facts under each heading in the Lines pane.')}
        {' '}{t('Section length runs to the next heading at the same or a shallower level, so a part reports its whole span rather than just its first chapter.')}
        {' '}{t('A detail with nothing to say (no parent, no sub-sections, an only child) is left out rather than shown empty, and progress only appears once you’ve reached the section.')}
        {' '}{t('Leave everything unticked for plain headings.')}
      </p>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        {t('Styles the lines that are chapter/section headings in the Lines pane, with a distinct look per tier.')}
        {' '}{t('“Auto” picks a style that suits the current theme.')}
      </p>
      <Field label={t('Auto-collapse completed sections')}>
        <input
          type="checkbox"
          checked={!!s.tocCollapseCompleted}
          onChange={(e) => patch({ tocCollapseCompleted: e.target.checked })}
        />
      </Field>
      <Field label={t('ToC-bar numeral')}>
        <select value={s.tocBarNumeralStyle || 'none'} onChange={(e) => patch({ tocBarNumeralStyle: e.target.value })}>
          <option value="none">{t('None')}</option>
          <option value="arabic">{t('Arabic (2)')}</option>
          <option value="roman">{t('Roman (II)')}</option>
          <option value="words">{t('Words (Two)')}</option>
        </select>
      </Field>
      {[0, 1, 2].map((lvl) => (
        <Field key={lvl} label={t('Tier {level} numeral regex', { level: lvl })}>
          <input
            type="text"
            placeholder={t('auto (capture group 1)')}
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
        {t('Numeral regex handles odd headings (e.g. “{example}”): the first capture group is the numeral.', { example: 'Chapter II: Three by 2' })}
        {' '}{t('Leave blank to auto-detect a roman or arabic number.')}
      </p>

      <Section>{t('Avatars')}</Section>
      <Field label={t('Show avatars')}>
        <input type="checkbox" checked={!!s.showEyes} onChange={(e) => patch({ showEyes: e.target.checked })} />
      </Field>
      <Field label={t('Floating hands')}>
        <label className="inline-check" title={t('Floating hands beside each avatar that mirror your biometric controls (gestures, scroll joystick, claps, voice commands) and move with the current activity')}>
          <input type="checkbox" checked={!!s.avatarHands} onChange={(e) => patch({ avatarHands: e.target.checked })} />
          {t('Floating hands that mimic the biometric controls')}
        </label>
      </Field>
      <Field label={t('Avatar count (1–3)')}>
        <input
          type="number"
          min={1}
          max={3}
          value={s.faceCount || 1}
          onChange={(e) => patch({ faceCount: Math.max(1, Math.min(3, Number(e.target.value))) })}
        />
      </Field>
      {[0, 1, 2].slice(0, s.faceCount || 1).map((slot) => (
        <Field key={slot} label={t('Avatar {n} style', { n: slot + 1 })}>
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
              <option key={f} value={f}>{faceLabel(f)}</option>
            ))}
          </select>
        </Field>
      ))}
      <Field label={t('Art style')}>
        <select value={s.artStyle || 'Cartoon'} onChange={(e) => patch({ artStyle: e.target.value })}>
          {ART_STYLES.map((a) => (
            <option key={a} value={a}>{lbl(ART_STYLE_LABELS, a)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('Mobile avatar transparency')}>
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
      <Field label={t('Mobile stats transparency')}>
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
        {t('On phones the avatar and the reading stats each float as separate draggable popups — drag them anywhere over the page; these set how see-through each is.')}
        {' '}{t('Toggle them from the menu’s Avatars / Stats panel chips.')}
      </p>

      <Section>{t('Stats chip')}</Section>
      <p className="settings-note" style={{ margin: '2px 0 4px' }}>{t('Choose what the reading-stats block (dock & floating chip) shows. Defaults match the original layout; the rest are extras.')}</p>
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

      <Section>{t('Reading aids')}</Section>
      <Field label={t('Focus aid')}>
        <select value={s.focusAid || 'off'} onChange={(e) => patch({ focusAid: e.target.value })}
          title={t('Ruler: a band on the current line, everything else dimmed. Paragraph: only the current paragraph stays bright.')}>
          <option value="off">{t('Off')}</option>
          <option value="ruler">{t('Reading ruler (current line)')}</option>
          <option value="paragraph">{t('Paragraph focus')}</option>
        </select>
      </Field>
      <Field label={t('Line colour gradient (BeeLine-style)')}>
        <input type="checkbox" checked={!!s.beeline} onChange={(e) => patch({ beeline: e.target.checked })}
          title={t('Text fades into blue across one line and back out across the next (then red), so your eye follows the colour from the end of a line to the start of the next')} />
      </Field>
      {s.beeline && (
        <Field label={t('Gradient strength (%)')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min={20} max={100} step={5} value={s.beelineStrength ?? 70} onChange={(e) => patch({ beelineStrength: Number(e.target.value) })} />
            <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{s.beelineStrength ?? 70}%</span>
          </div>
        </Field>
      )}

      <Section>{t('Focus window (obscure before / after)')}</Section>
      <Field label={t('Obscure with')}>
        <select value={s.obscureMode || 'blur'} onChange={(e) => patch({ obscureMode: e.target.value })}>
          <option value="blur">{t('Blur')}</option>
          <option value="hide">{t('Hide')}</option>
          <option value="redact">{t('Redact (blackout)')}</option>
          <option value="illegible">{t('Illegible (dots)')}</option>
          <option value="translate">{t('Translate (another language)')}</option>
        </select>
      </Field>
      {(s.obscureMode === 'translate') && (
        <p className="settings-note" style={{ margin: '2px 0 0' }}>
          {t('Windowed lines are shown translated into another language instead of English — pick the service and target under Settings → General → Translation.')}
        </p>
      )}
      <Field label={t('Side-by-side translation')}>
        <input type="checkbox" checked={!!s.parallelTranslation} onChange={(e) => patch({ parallelTranslation: e.target.checked })} />
      </Field>
      <Field label={t('Readable lines before (0 = off)')}>
        <input type="number" min={0} max={50} value={s.blurLinesBefore || 0} onChange={(e) => patch({ blurLinesBefore: Number(e.target.value) })} />
      </Field>
      <Field label={t('Readable lines after (0 = off)')}>
        <input type="number" min={0} max={50} value={s.blurLinesAfter || 0} onChange={(e) => patch({ blurLinesAfter: Number(e.target.value) })} />
      </Field>
      {(s.obscureMode || 'blur') === 'blur' && (
        <Field label={t('Blur strength (%)')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min={0} max={100} step={5} value={s.blurGradient ?? 100} onChange={(e) => patch({ blurGradient: Number(e.target.value) })} />
            <span style={{ fontSize: 12, color: 'var(--status-fg)' }}>{s.blurGradient ?? 100}%</span>
          </div>
        </Field>
      )}
      <Field label={t('Current-line font boost (px)')}>
        <input type="number" min={0} max={12} value={s.currentLineFontSizeBoost || 0} onChange={(e) => patch({ currentLineFontSizeBoost: Number(e.target.value) })} />
      </Field>

      <Section>{t('Playback')}</Section>
      <Field label={t('Paragraph break (sec)')}>
        <input
          type="number"
          step="0.1"
          min={0}
          max={3}
          value={s.paragraphBreakSecs}
          onChange={(e) => patch({ paragraphBreakSecs: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Fast Reader words per flash')}>
        <select value={s.rsvpChunk || 1} onChange={(e) => patch({ rsvpChunk: Number(e.target.value) })}
          title={t('Flash short phrases instead of single words — a phrase never runs past punctuation or a line end, and lasts as long as its words would one by one')}>
          <option value={1}>{t('1 word')}</option><option value={2}>{t('up to 2 words')}</option><option value={3}>{t('up to 3 words')}</option>
        </select>
      </Field>
      <Field label={t('Ease in after Play')}>
        <input type="checkbox" checked={s.rsvpRamp !== false} onChange={(e) => patch({ rsvpRamp: e.target.checked })}
          title={t('The first 20 words after Play run from 70% of your WPM up to full speed')} />
      </Field>
      <Field label={t('Resume hold (ms)')}>
        <input type="number" min={0} max={2000} step={50} value={s.rsvpResumeHoldMs ?? 300} onChange={(e) => patch({ rsvpResumeHoldMs: Number(e.target.value) })}
          title={t('Extra time on the word you press Play on, so your eye can find it')} />
      </Field>
      <Field label={t('Split words longer than (letters, 0 = off)')}>
        <input type="number" min={0} max={30} value={s.rsvpHyphenLen || 0} onChange={(e) => patch({ rsvpHyphenLen: Number(e.target.value) })}
          title={t('In the Fast Reader, very long words show in two hyphenated halves (e.g. extraor- / dinarily) so they stay big')} />
      </Field>
      <Field label={t('Line break pause (ms)')}>
        <input
          type="number"
          min={0}
          max={2000}
          value={s.lineBreakPauseMs}
          onChange={(e) => patch({ lineBreakPauseMs: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Detect proper names (heavy on large docs)')}>
        <input
          type="checkbox"
          checked={!!s.enableProperNames}
          onChange={(e) => patch({ enableProperNames: e.target.checked })}
        />
      </Field>
      <Field label={t('Auto-skip headers/footers')}>
        <input
          type="checkbox"
          checked={s.autoSkipHeaders}
          onChange={(e) => patch({ autoSkipHeaders: e.target.checked })}
        />
      </Field>

      <Section>{t('Rhythmic pacing (metronome)')}</Section>
      <Field label={t('Enable beat at reading pace')}>
        <input
          type="checkbox"
          checked={!!metro.enabled}
          onChange={(e) => patchMetro({ enabled: e.target.checked })}
        />
      </Field>
      <Field label={t('Volume')}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={metro.volume}
          onChange={(e) => patchMetro({ volume: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Ticks per word')}>
        <select value={metro.subdivision} onChange={(e) => patchMetro({ subdivision: Number(e.target.value) })}>
          <option value={1}>{t('1 — one beat per word')}</option>
          <option value={2}>{t('2 — half-beats')}</option>
          <option value={3}>{t('3 — triplets')}</option>
          <option value={4}>{t('4 — quarter-beats')}</option>
        </select>
      </Field>
      <Field label={t('Accent every N beats (0 = off)')}>
        <input
          type="number"
          min={0}
          max={8}
          value={metro.accentEvery}
          onChange={(e) => patchMetro({ accentEvery: Math.max(0, Number(e.target.value)) })}
        />
      </Field>
      <Field label={t('Preview')}>
        <button type="button" onClick={tryMetro}>♪ {t('Try 8 beats')}</button>
      </Field>
      <p className="settings-note" style={{ margin: '2px 0 0' }}>
        {t('A steady pace cue at your current WPM — a cadence to read along with.')}
        {' '}{t('The adaptive pacer still controls the actual speed, so the beat always matches the words.')}
        {' '}{t('Plays only while reading.')}
      </p>

      <Section>{t('Double-time multipliers (1.0 = off)')}</Section>
      <Field label={t('Proper names')}>
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeProperNamesMultiplier}
          onChange={(e) => patch({ doubleTimeProperNamesMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Long words')}>
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeLongWordsMultiplier}
          onChange={(e) => patch({ doubleTimeLongWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Long-word threshold')}>
        <input
          type="number"
          min={4}
          max={20}
          value={s.longWordThreshold}
          onChange={(e) => patch({ longWordThreshold: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Digit words')}>
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeDigitWordsMultiplier}
          onChange={(e) => patch({ doubleTimeDigitWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Special-char words')}>
        <input
          type="number"
          step="0.5"
          min={1}
          max={4}
          value={s.doubleTimeSpecialWordsMultiplier}
          onChange={(e) => patch({ doubleTimeSpecialWordsMultiplier: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Surprisal-weighted dwell')}>
        <input type="checkbox" checked={!!s.surprisalDwell} onChange={(e) => patch({ surprisalDwell: e.target.checked })} />
      </Field>
      {s.surprisalDwell && (
        <Field label={t('Surprisal strength')}>
          <input type="range" min={0} max={1.5} step={0.1} value={s.surprisalStrength ?? 1} onChange={(e) => patch({ surprisalStrength: Number(e.target.value) })} />
        </Field>
      )}
      <p className="settings-note" style={{ margin: '2px 0 0' }}>{t('Spends more time on rare/informative words and less on common ones — your average WPM is unchanged.')}</p>

      {/* Read-aloud voice/rate live in Listen → Audio Settings; typing rules in Practice → Typing Settings. */}
      <Section>{t('Advance by reading aloud')}</Section>
      <p className="settings-note" style={{ marginTop: 0 }}>{t('Turn it on from the controls bar (Biometric → 🗣); the card that appears has a one-slider Strictness control.')}{' '}{t('Fine-tune here: how strict the text follows your voice — loose enough that a missed word doesn’t stop it, strict enough that a grunt can’t move it.')}</p>
      {(() => {
        const sp = { ...(s.speaking || {}), ...speakParams(s.speaking) };
        const set = (k, v) => patch({ speaking: { ...s.speaking, [k]: v } });
        const slider = (k, label, min, max, step, fmt, hint) => (
          <Field label={label}>
            <input type="range" min={min} max={max} step={step} value={sp[k]} onChange={(e) => set(k, Number(e.target.value))} aria-label={label} title={hint} />
            <span className="settings-note" style={{ margin: '0 0 0 6px' }}>{fmt(sp[k])}</span>
          </Field>
        );
        return (
          <>
            {slider('minRun', t('Words to match before moving'), 1, 5, 1, (v) => t.n('{n} word', '{n} words', v), t('Higher = random sounds and single stray words can’t move the text'))}
            {slider('fuzz', t('How closely words must match'), 0.5, 1, 0.05, (v) => (v >= 1 ? t('exact') : t('{pct}% alike', { pct: Math.round(v * 100) })), t('Lower = accents and mishearings still count'))}
            {slider('skip', t('Words you may skip between matches'), 0, 4, 1, (v) => String(v), t('How many text words can be missed or misheard between two words that were heard'))}
            {slider('window', t('How far ahead you can start reading'), 2, 20, 1, (v) => t.n('{n} word', '{n} words', v), t('Lets you skip ahead a little without it losing track'))}
            {slider('density', t('Evidence needed to move'), 0.2, 0.9, 0.05, (v) => t('{pct}% of words moved', { pct: Math.round(v * 100) }), t('Matched words needed per word the text moves — higher stops one right word carrying it through a sentence'))}
            <Field label={t('Word effect')}>
              <select value={sp.wordFx || 'glow'} onChange={(e) => set('wordFx', e.target.value)} title={t('Words the text moves past flash — brighter the better they were read; skipped ones flash faint red')}>
                <option value="glow">{t('Glow')}</option>
                <option value="pop">{t('Glow + flash on perfect words')}</option>
                <option value="off">{t('Off')}</option>
              </select>
            </Field>
            <Field label={t('Live voice feedback')}>
              <input type="checkbox" checked={sp.feedback !== false} onChange={(e) => set('feedback', e.target.checked)} />
              <span className="settings-note" style={{ margin: '0 0 0 6px' }}>{t('Depth, clarity, pace… while you read (not recorded)')}</span>
            </Field>
          </>
        );
      })()}
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
      {rows.map(([f, rep]) => (
        <div key={f} className="wordswap-row">
          <code>{f}</code><span>→</span><code>{rep}</code>
          <button type="button" className="close-x" title={t('Remove this substitution')} onClick={() => { const m = { ...swaps }; delete m[f]; onChange(m); }}>×</button>
        </div>
      ))}
      <div className="wordswap-row">
        <input placeholder={t('word in text')} value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 110 }} />
        <span>→</span>
        <input placeholder={t('show as')} value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ width: 110 }} />
        <button type="button" disabled={!from.trim() || !to.trim()} onClick={add}>＋ {t('Add')}</button>
      </div>
      <p className="settings-note" style={{ margin: '4px 0 0' }}>
        {t('Display-only, this document only.')}
        {' '}{t('Whole words, case-insensitive; a leading capital is kept (shown in the Lines pane and the Fast Reader — search and read-aloud use the original text).')}
      </p>
    </div>
  );
}
