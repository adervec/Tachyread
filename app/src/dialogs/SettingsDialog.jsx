import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useVoices } from '../features/tts.js';
import { THEME_CATEGORIES, HEADING_PACKS } from '../state/themes.js';
import { createMetronome } from '../features/metronome.js';
import { DEFAULT_METRONOME } from '../engine/metronome.js';
import { LINE_SOUNDS, playLineSound } from '../features/clickSound.js';

const FACE_STYLES = ['Man', 'Owl', 'Robot', 'Alien', 'Wizard', 'Cat', 'Baby', 'Skull', 'Panda', 'Frankenstein', 'Vampire', 'Viking', 'Clown', 'Bunny', 'Dragon', 'Ninja'];
const ART_STYLES = ['Cartoon', 'Flat', 'Sketch', 'Neon', 'Watercolor', 'Pastel'];
// Reading-pointer options archived with its Settings section (see below). Restore alongside it.
// const POINTER_STYLES = ['Arrow', 'Diamond', 'Star', 'Circle', 'Hand'];
// const POINTER_PLACEMENTS = ['Above', 'Below', 'Left', 'Right'];
const CURRENT_WORD_STYLES = ['Underline', 'Bold', 'Background', 'Color', 'Box'];

// Back-compat: older saved tabs used a single `currentWordStyle` string.
function readCwStyles(s) {
  if (Array.isArray(s.currentWordStyles)) return s.currentWordStyles;
  if (s.currentWordStyle) return [s.currentWordStyle];
  return ['Underline'];
}

const GUIDE_COLORS = ['Red', 'Pink', 'Orange', 'Green', 'Blue', 'Purple'];
const ALIGNMENTS = ['Left', 'Center', 'Right', 'Justify'];

function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

function Section({ children }) {
  return <div className="field-section">{children}</div>;
}

export default function SettingsDialog({ settings, onPatch, onClose, title = 'Tab Settings', matchCurrent, onResetFactory }) {
  const [s, setS] = useState(settings);
  const voices = useVoices();
  const metroRef = useRef(null);

  function patch(p) {
    const next = { ...s, ...p };
    setS(next);
    onPatch(p);
  }

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
      {matchCurrent && (
        <p className="settings-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { const next = matchCurrent(); if (next) patch(next); }}>⤓ Match current tab</button>
          <span>Copy the open tab’s appearance &amp; behaviour into these defaults (its reading progress isn’t copied).</span>
        </p>
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
      <Field label="Serif font (Fast Reader word)">
        <input type="checkbox" checked={s.serif} onChange={(e) => patch({ serif: e.target.checked })} />
      </Field>
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
      <Field label="Right pane font size (px)">
        <input
          type="number"
          min={10}
          max={20}
          value={s.rightPaneFontSize}
          onChange={(e) => patch({ rightPaneFontSize: Number(e.target.value) })}
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
          value={s.lineLongPressMs ?? 3000}
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

      <Section>Right pane</Section>
      <Field label="Blur lines before">
        <input type="number" min={0} max={10} value={s.blurLinesBefore || 0} onChange={(e) => patch({ blurLinesBefore: Number(e.target.value) })} />
      </Field>
      <Field label="Blur lines after">
        <input type="number" min={0} max={10} value={s.blurLinesAfter || 0} onChange={(e) => patch({ blurLinesAfter: Number(e.target.value) })} />
      </Field>
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

      <Section>Read aloud (TTS)</Section>
      <Field label={`Voice (${voices.length} available)`}>
        <select value={s.annunciateVoice || ''} onChange={(e) => patch({ annunciateVoice: e.target.value })}>
          <option value="">(default)</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.lang}){v.localService ? '' : ' — online'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Rate (−5..+8)">
        <input
          type="number"
          min={-5}
          max={8}
          value={s.annunciateRate}
          onChange={(e) => patch({ annunciateRate: Number(e.target.value) })}
        />
      </Field>

      <Section>Minigames</Section>
      <Field label="Typing — case sensitive">
        <input
          type="checkbox"
          checked={!!s.typing?.caseSensitive}
          onChange={(e) => patch({ typing: { ...s.typing, caseSensitive: e.target.checked } })}
        />
      </Field>
      <Field label="Typing — strip punctuation">
        <input
          type="checkbox"
          checked={s.typing?.stripPunctuation ?? true}
          onChange={(e) => patch({ typing: { ...s.typing, stripPunctuation: e.target.checked } })}
        />
      </Field>
      <Field label="Typing — per-word timeout (ms, 0 = off)">
        <input
          type="number"
          min={0}
          max={60000}
          value={s.typing?.perWordTimeoutMs || 0}
          onChange={(e) => patch({ typing: { ...s.typing, perWordTimeoutMs: Number(e.target.value) } })}
        />
      </Field>
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
    </Dialog>
  );
}
