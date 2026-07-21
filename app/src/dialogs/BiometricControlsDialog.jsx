import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { DEFAULT_GESTURES, GESTURE_INFO, HELD_GESTURES, DEFAULT_HOLD_MS, HOLD_MIN_MS, HOLD_MAX_MS, clampHoldMs } from '../features/handGestures.js';
import { COMMANDS, DEFAULT_GESTURE_MAP, DEFAULT_VOICE_COMMANDS, DEFAULT_CLAP_MAP } from '../features/commandRegistry.js';
import { stepLabel } from '../features/triggerSequences.js';
import { EYE_KINDS, FACE_KINDS, ALL_KINDS, validateEyeMappings, kindFloorMs, DELIBERATE_MS, MAX_HOLD_MS } from '../features/eyeGestures.js';
import { createEyeCue } from '../features/eyeCue.js';
import { createRecognizer, speechRecognitionSupported } from '../features/speechRecognition.js';
import { getLanguage } from '../state/languages.js';

// One page for every hands-free control: camera attention guards, hand gestures + their command
// mapping, and voice/clap commands with custom, recordable trigger phrases. Replaces the old separate
// "Camera & Gestures" dialog and the Audio Settings "Hands-free" section.
function Field({ label, children }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

// A <select> of every reader command (plus an "unassigned" option). Value is a commandId.
function CommandSelect({ value, onChange, disabled }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {COMMANDS.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
    </select>
  );
}

export default function BiometricControlsDialog({ global, onPatch, onCalibrate, onCalibrateHand, isCompact = false, hold = null, onClose }) {
  const [g, setG] = useState(global);
  function patch(p) { setG({ ...g, ...p }); onPatch(p); }

  // Eye gestures: rows live in global.eyeGestures. Validation runs on every edit so overlapping or
  // natural-blink-range windows are called out (and block arming) before they can misfire.
  const eye = g.eyeGestures || {};
  const eyeRows = eye.rows || [];
  const eyeProblems = validateEyeMappings(eyeRows);
  const eyeOk = eyeProblems.every((p) => p.level !== 'error');
  const patchEye = (p) => patch({ eyeGestures: { ...eye, ...p } });
  const setEyeRows = (rows) => {
    // Never leave the feature armed with a broken set — turn it off with the same edit.
    const stillOk = validateEyeMappings(rows).every((p) => p.level !== 'error');
    patchEye({ rows, ...(stillOk ? {} : { on: false }) });
  };
  const cueRef = useRef(null);
  if (!cueRef.current) cueRef.current = createEyeCue();
  useEffect(() => () => cueRef.current?.close(), []);

  const gestureMap = { ...DEFAULT_GESTURE_MAP, ...(g.gestureMap || {}) };
  const clapMap = { ...DEFAULT_CLAP_MAP, ...(g.clapMap || {}) };
  const voiceRows = g.voiceCommands?.length ? g.voiceCommands : DEFAULT_VOICE_COMMANDS;
  const rowsRef = useRef(voiceRows);
  rowsRef.current = voiceRows;

  // Record a trigger phrase: capture exactly what the recognizer hears once and save it into a row.
  const [recIdx, setRecIdx] = useState(-1);
  const [recErr, setRecErr] = useState('');
  const recRef = useRef(null);
  function stopRec() { try { recRef.current?.stop(); } catch { /* ignore */ } recRef.current = null; setRecIdx(-1); }
  useEffect(() => () => stopRec(), []);
  function recordPhrase(idx) {
    if (recIdx >= 0) { stopRec(); return; }
    if (!speechRecognitionSupported()) { setRecErr('Voice recording needs a Chromium browser with microphone access.'); return; }
    setRecErr('');
    const rec = createRecognizer({
      lang: getLanguage(g.language || 'en').bcp,
      continuous: false,
      interimResults: false,
      onResult: ({ transcript, isFinal }) => {
        if (!isFinal) return;
        const phrase = (transcript || '').toLowerCase().trim();
        if (phrase) patch({ voiceCommands: rowsRef.current.map((r, i) => (i === idx ? { ...r, phrase } : r)) });
        stopRec();
      },
      onError: () => stopRec(),
    });
    if (!rec) { setRecErr('Speech recognition is unavailable.'); return; }
    recRef.current = rec;
    setRecIdx(idx);
    try { rec.start(); } catch { stopRec(); }
  }

  const setRows = (rows) => patch({ voiceCommands: rows });

  return (
    <Dialog title="Biometric Controls" onClose={onClose} width={600} buttons={<button onClick={onClose}>Close</button>}>
      <Field label="Front camera on phones & tablets">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.mobileCamera} onChange={(e) => patch({ mobileCamera: e.target.checked })} />
          Let the camera features below run on a small screen too
        </label>
      </Field>
      <p className="settings-note" style={{ marginTop: 0 }}>
        {g.mobileCamera
          ? '📱 Camera features are enabled on mobile. They are battery- and CPU-heavy, and a hand-held phone rarely faces you squarely — if reading gets sluggish or warm, turn this back off.'
          : '📵 Off by default on mobile: the camera guards (attention, doze, alarms, posture) and hand gestures run on desktop only, because they are battery/CPU-heavy and a phone rarely faces you squarely. Voice and clap commands work everywhere; eye gestures below bring the camera up on any device on their own.'}
      </p>
      {isCompact && !g.mobileCamera && (
        <p className="settings-note" style={{ marginTop: 0, color: 'var(--ox-bright, #b0413e)' }}>
          You’re on a small screen, so the camera settings below are inactive until you tick that box.
        </p>
      )}

      <div className="field-section">Attention guards (experimental)</div>
      <Field label="Webcam attention">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamAttention} onChange={(e) => patch({ webcamAttention: e.target.checked })} />
          Pause fast reading when the camera can’t see you facing the screen with eyes open
        </label>
      </Field>
      <Field label="Doze detection">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamDoze} onChange={(e) => patch({ webcamDoze: e.target.checked })} />
          Stop read-aloud if your eyes stay shut or you’re away for a while
        </label>
      </Field>
      <Field label="Away alarm">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamAwayAlarm} onChange={(e) => patch({ webcamAwayAlarm: e.target.checked })} />
          Sound an alarm if you look away for too long
        </label>
      </Field>
      <Field label="Alarm after (seconds)">
        <input type="number" min={3} max={300} value={g.webcamAwayAlarmSec ?? 15} disabled={!g.webcamAwayAlarm}
          onChange={(e) => patch({ webcamAwayAlarmSec: Math.max(3, Math.min(300, Number(e.target.value) || 15)) })} style={{ width: 70 }} />
      </Field>
      <Field label="Escalating alarm">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamEscalatingAlarm} disabled={!g.webcamAwayAlarm} onChange={(e) => patch({ webcamEscalatingAlarm: e.target.checked })} />
          Start quiet and get louder the longer you stay away
        </label>
      </Field>
      <Field label="Posture nudge">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamDistanceNudge} onChange={(e) => patch({ webcamDistanceNudge: e.target.checked })} />
          Remind me to ease back when I’m sitting too close to the screen
        </label>
      </Field>
      <Field label="Look-away analytics">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.webcamFocusStats} onChange={(e) => patch({ webcamFocusStats: e.target.checked })} />
          Log focus % and distractions per session into Reading History
        </label>
      </Field>
      <Field label="Show the feed">
        <label className="inline-check">
          <input type="checkbox" checked={g.webcamPreview !== false} onChange={(e) => patch({ webcamPreview: e.target.checked })} />
          Show the Biometric Control Feed popup (self-view + oscilloscope + event log) while active
        </label>
      </Field>
      <Field label="Eye calibration">
        <button onClick={onCalibrate} disabled={!onCalibrate}>⚙ Calibrate eye detection…</button>
      </Field>

      <div className="field-section">Hand gestures (experimental)</div>
      <Field label="Hand gestures">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.handGestures} onChange={(e) => patch({ handGestures: e.target.checked })} />
          Control the reader with hand gestures via the camera (enable + map each below)
        </label>
      </Field>
      <Field label="Enabled gestures">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(GESTURE_INFO).map(([k, info]) => {
            const gset = { ...DEFAULT_GESTURES, ...(g.handGestureSet || {}) };
            return (
              <label key={k} className="inline-check" title={info.desc} style={{ opacity: g.handGestures ? 1 : 0.55 }}>
                <input type="checkbox" disabled={!g.handGestures} checked={!!gset[k]} onChange={(e) => patch({ handGestureSet: { ...gset, [k]: e.target.checked } })} />
                {info.icon} <strong>{info.label}</strong>
              </label>
            );
          })}
        </div>
      </Field>
      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Gesture → command</div>
      <Field label="Distinguish hands">
        <label className="inline-check">
          <input type="checkbox" checked={!!g.gestureHands} onChange={(e) => patch({ gestureHands: e.target.checked })} />
          Map the left and right hand separately (per-hand override wins; empty = the any-hand mapping)
        </label>
      </Field>
      {Object.entries(GESTURE_INFO).filter(([k]) => k !== 'scroll').map(([k, info]) => (
        <Field key={k} label={`${info.icon} ${info.label}`}>
          <div className="bio-gesture-maps">
            <CommandSelect value={gestureMap[k]} disabled={!g.handGestures} onChange={(v) => patch({ gestureMap: { ...gestureMap, [k]: v } })} />
            {g.gestureHands && (
              <>
                <span className="bio-hand-lbl" title="Left-hand override">L</span>
                <CommandSelect value={gestureMap[`${k}:L`]} disabled={!g.handGestures} onChange={(v) => patch({ gestureMap: { ...gestureMap, [`${k}:L`]: v } })} />
                <span className="bio-hand-lbl" title="Right-hand override">R</span>
                <CommandSelect value={gestureMap[`${k}:R`]} disabled={!g.handGestures} onChange={(v) => patch({ gestureMap: { ...gestureMap, [`${k}:R`]: v } })} />
              </>
            )}
            {/* Held gestures only — a wave/swipe is motion, not a hold, so a minimum hold makes no
                sense for them. Raise this to reject accidental flicks. */}
            {HELD_GESTURES.includes(k) && (
              <label className="bio-hold" title="Hold this gesture at least this long before it fires — raise it to filter accidental flicks">
                <span className="bio-hand-lbl">hold</span>
                <input
                  type="number" min={HOLD_MIN_MS} max={HOLD_MAX_MS} step={50}
                  disabled={!g.handGestures}
                  value={(g.handHoldMs || {})[k] ?? DEFAULT_HOLD_MS}
                  onChange={(e) => patch({ handHoldMs: { ...(g.handHoldMs || {}), [k]: clampHoldMs(e.target.value) } })}
                />
                <span className="bio-hand-lbl">ms</span>
              </label>
            )}
          </div>
        </Field>
      ))}
      <p className="settings-note">
        The open-palm <strong>joystick</strong> (scroll) isn’t remappable — it scrolls the Lines pane by how
        far your palm is from its rest height. Fewer enabled gestures = fewer false positives, and each
        held gesture only fires after you hold it for its <strong>hold time</strong> (default {DEFAULT_HOLD_MS}ms) —
        raise a jittery one to filter accidentals. Unticking a gesture above <strong>disables it but keeps
        its mapping</strong> for later.
      </p>
      <Field label="Hand calibration">
        <button onClick={onCalibrateHand} disabled={!onCalibrateHand || !g.handGestures} title={g.handGestures ? '' : 'Turn on Hand gestures first'}>
          🖐 Calibrate hand range…
        </button>
      </Field>

      <div className="field-section">Voice &amp; clap commands</div>
      <Field label="Hands-free mode">
        <select value={g.audioCtrlMode || 'Both'} onChange={(e) => patch({ audioCtrlMode: e.target.value })}>
          <option>Voice</option>
          <option>Claps</option>
          <option>Both</option>
        </select>
      </Field>
      <p className="settings-note">
        Turn listening on per tab with <strong>VOICE COMMAND</strong> in the controls bar. Voice needs a
        Chromium browser + microphone; audio is analysed on your device.
      </p>

      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Spoken phrases → command</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {voiceRows.map((row, i) => (
          <div key={i} className="bio-voice-row" style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: row.on === false ? 0.55 : 1 }}>
            <input
              type="checkbox"
              checked={row.on !== false}
              title="Enable / disable this phrase (the mapping is kept while disabled; it can still be a sequence step)"
              onChange={(e) => setRows(voiceRows.map((r, j) => (j === i ? { ...r, on: e.target.checked } : r)))}
            />
            <input
              type="text"
              value={row.phrase}
              placeholder="say…"
              onChange={(e) => setRows(voiceRows.map((r, j) => (j === i ? { ...r, phrase: e.target.value } : r)))}
              style={{ flex: '1 1 auto', minWidth: 0 }}
            />
            <button title={recIdx === i ? 'Listening… stop' : 'Record what you say and use it as the phrase'} onClick={() => recordPhrase(i)}>
              {recIdx === i ? '● …' : '● Record'}
            </button>
            <CommandSelect value={row.commandId} onChange={(v) => setRows(voiceRows.map((r, j) => (j === i ? { ...r, commandId: v } : r)))} />
            <button title="Remove this phrase" onClick={() => setRows(voiceRows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <button style={{ marginTop: 6 }} onClick={() => setRows([...voiceRows, { phrase: '', commandId: 'nextWord' }])}>+ Add phrase</button>
      {recErr && <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>{recErr}</p>}
      <p className="settings-note">
        Several phrases can point at one command. A phrase matches when the words you speak contain it,
        so short, distinct words work best.
      </p>

      <div className="field-section" style={{ fontSize: 12, opacity: 0.85 }}>Claps → command</div>
      {[1, 2, 3].map((n) => (
        <Field key={n} label={`${'👏'.repeat(n)} ${n} clap${n > 1 ? 's' : ''}`}>
          <div className="bio-gesture-maps">
            <input
              type="checkbox"
              checked={!(g.clapOff || {})[n]}
              title="Enable / disable this clap pattern (the mapping is kept while disabled; it can still be a sequence step)"
              onChange={(e) => patch({ clapOff: { ...(g.clapOff || {}), [n]: !e.target.checked } })}
            />
            <CommandSelect value={clapMap[n]} disabled={!!(g.clapOff || {})[n]} onChange={(v) => patch({ clapMap: { ...clapMap, [n]: v } })} />
          </div>
        </Field>
      ))}

      <div className="field-section">Sequences (combos)</div>
      <p className="settings-note">
        Chain 2–3 triggers — any mix of gestures, phrases, and claps — into one command (e.g. ✊ fist
        then “go” = restart). Steps must follow each other within ~5 seconds, in order, with nothing
        in between. Note: each step ALSO runs its own mapping — untick a step’s own mapping above if
        it should only count inside the sequence.
      </p>
      {(g.triggerSeqs || []).map((seq, i) => {
        const setSeq = (p) => patch({ triggerSeqs: g.triggerSeqs.map((s, j) => (j === i ? { ...s, ...p } : s)) });
        const setStep = (si, v) => setSeq({ steps: (seq.steps || ['', '']).map((s, j) => (j === si ? v : s)) });
        return (
          <div key={i} className="bio-seq-row" style={{ opacity: seq.on === false ? 0.55 : 1 }}>
            <input
              type="checkbox"
              checked={seq.on !== false}
              title="Enable / disable this sequence (kept while disabled)"
              onChange={(e) => setSeq({ on: e.target.checked })}
            />
            {[0, 1, 2].map((si) => (
              <select key={si} value={(seq.steps || [])[si] || ''} onChange={(e) => setStep(si, e.target.value)} title={si === 2 ? 'Optional third step' : `Step ${si + 1}`}>
                <option value="">{si === 2 ? '(no 3rd step)' : `step ${si + 1}…`}</option>
                <optgroup label="Gestures">
                  {Object.entries(GESTURE_INFO).filter(([k]) => k !== 'scroll').flatMap(([k, info]) => [
                    <option key={k} value={`g:${k}`}>{info.icon} {info.label}</option>,
                    ...(g.gestureHands ? [
                      <option key={`${k}L`} value={`g:${k}:L`}>{info.icon} {info.label} (left)</option>,
                      <option key={`${k}R`} value={`g:${k}:R`}>{info.icon} {info.label} (right)</option>,
                    ] : []),
                  ])}
                </optgroup>
                <optgroup label="Phrases">
                  {voiceRows.filter((r) => r.phrase).map((r) => <option key={r.phrase} value={`v:${r.phrase}`}>🗣 “{r.phrase}”</option>)}
                </optgroup>
                <optgroup label="Claps">
                  {[1, 2, 3].map((n) => <option key={n} value={`c:${n}`}>👏×{n}</option>)}
                </optgroup>
              </select>
            ))}
            <span className="bio-seq-arrow">→</span>
            <CommandSelect value={seq.commandId} onChange={(v) => setSeq({ commandId: v })} />
            <button title="Remove this sequence" onClick={() => patch({ triggerSeqs: g.triggerSeqs.filter((_, j) => j !== i) })}>✕</button>
            <span className="settings-note" style={{ margin: 0, flexBasis: '100%' }}>
              {(seq.steps || []).filter(Boolean).map((s) => stepLabel(s, GESTURE_INFO)).join('  →  ') || 'pick the steps…'}
            </span>
          </div>
        );
      })}
      <button style={{ marginTop: 6 }} onClick={() => patch({ triggerSeqs: [...(g.triggerSeqs || []), { steps: ['', ''], commandId: '', on: true }] })}>+ Add sequence</button>

      <div className="field-section">👁 Eye &amp; face gestures</div>
      <p className="settings-note">
        Deliberate blinks, winks, eye rolls and held face poses (tongue out, puffed cheeks, raised
        brows…), mapped by <b>how long you hold them</b>. Each gesture has a floor below which it's
        just a face you were making anyway — {DELIBERATE_MS}ms for the eyes, longer for the poses
        people strike without meaning to — so reading, talking and smiling never trigger anything.
        These run on a phone whether or not the camera box above is ticked: switching them on is
        consent enough.
      </p>
      <Field label="Eye gestures on">
        <input
          type="checkbox"
          checked={!!eye.on}
          disabled={!eyeOk && !eye.on}
          title={!eyeOk && !eye.on ? 'Fix the mapping problems below first' : 'Turns on the front camera while reading'}
          onChange={(e) => patchEye({ on: e.target.checked })}
        />
      </Field>
      {eye.on && !eyeOk && (
        <p className="settings-note" style={{ color: 'var(--ox-bright, #b0413e)' }}>
          ⚠ These mappings can’t be armed until the errors below are fixed.
        </p>
      )}
      <Field label="Audio timing cue">
        <div className="bio-gesture-maps">
          <input type="checkbox" checked={!!eye.cue} onChange={(e) => patchEye({ cue: e.target.checked })} />
          <span className="settings-note" style={{ margin: 0 }}>
            A tick when the hold enters a window (let go now), a lower one when it drops into a gap, a
            buzz once you’re past them all.
          </span>
        </div>
      </Field>
      {eye.cue && (
        <Field label="Cue volume">
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round((eye.cueVolume ?? 1) * 100)}
            onChange={(e) => patchEye({ cueVolume: Number(e.target.value) / 100 })}
          />
          <button style={{ marginLeft: 6 }} onClick={() => cueRef.current.play('enter', eye.cueVolume ?? 1)}>Test ♪</button>
        </Field>
      )}
      {/* Live meter: the hold you're doing right now and which window it's in. Without it, tuning
          duration windows is pure guesswork. */}
      {eye.on && (
        <div className="bio-eye-meter">
          {hold ? (
            <>
              <span className="bio-eye-kind">{ALL_KINDS.find((k) => k.id === hold.kind)?.icon} {ALL_KINDS.find((k) => k.id === hold.kind)?.label}</span>
              <span className={`bio-eye-ms${hold.inWindow ? ' in' : ''}`}>{Math.round(hold.ms)}ms</span>
              <span className="settings-note" style={{ margin: 0 }}>
                {hold.inWindow
                  ? `→ ${COMMANDS.find((c) => c.id === hold.inWindow.commandId)?.label || hold.inWindow.commandId} — release now`
                  : hold.next ? `next window at ${hold.next.minMs}ms` : 'past every window'}
              </span>
            </>
          ) : <span className="settings-note" style={{ margin: 0 }}>Hold a blink, wink or face pose to see it measured here…</span>}
        </div>
      )}
      {eyeRows.map((r, i) => {
        const setRow = (p) => setEyeRows(eyeRows.map((x, j) => (j === i ? { ...x, ...p } : x)));
        const mine = eyeProblems.filter((p) => p.index === i);
        const err = mine.find((p) => p.level === 'error');
        return (
          <div key={i} className={`bio-eye-row${err ? ' bad' : ''}`} style={{ opacity: r.on === false ? 0.55 : 1 }}>
            <input
              type="checkbox"
              checked={r.on !== false}
              title="Enable / disable this mapping (kept while disabled — a disabled row can't conflict)"
              onChange={(e) => setRow({ on: e.target.checked })}
            />
            <select value={r.kind || ''} onChange={(e) => setRow({ kind: e.target.value })}>
              <option value="">gesture…</option>
              <optgroup label="Eyes">
                {EYE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
              </optgroup>
              <optgroup label="Face poses (held)">
                {FACE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label} — min {k.floor}ms</option>)}
              </optgroup>
            </select>
            <span className="bio-eye-range">
              <input
                type="number" min={kindFloorMs(r.kind)} max={MAX_HOLD_MS} step={50} value={r.minMs ?? ''}
                title={`Shortest hold that counts (at least ${kindFloorMs(r.kind)}ms for this gesture)`}
                onChange={(e) => setRow({ minMs: Number(e.target.value) })}
              />
              <span>–</span>
              <input
                type="number" min={kindFloorMs(r.kind)} max={MAX_HOLD_MS} step={50} value={r.maxMs ?? ''}
                title="Longest hold that counts" onChange={(e) => setRow({ maxMs: Number(e.target.value) })}
              />
              <span>ms</span>
            </span>
            <span className="bio-seq-arrow">→</span>
            <CommandSelect value={r.commandId} onChange={(v) => setRow({ commandId: v })} />
            <button title="Remove this mapping" onClick={() => setEyeRows(eyeRows.filter((_, j) => j !== i))}>✕</button>
            {mine.map((p, k) => (
              <span key={k} className={`bio-eye-problem ${p.level}`}>{p.level === 'error' ? '⛔' : '⚠'} {p.message}</span>
            ))}
            {FACE_KINDS.find((k) => k.id === r.kind)?.natural && (
              <span className="bio-eye-problem warn">
                ⚠ You’ll make this face without meaning to — hold it noticeably longer than feels natural, and
                prefer it for harmless actions.
              </span>
            )}
            {FACE_KINDS.find((k) => k.id === r.kind)?.hint && (
              <span className="bio-eye-problem warn">ℹ {FACE_KINDS.find((k) => k.id === r.kind).hint}</span>
            )}
          </div>
        );
      })}
      <button
        style={{ marginTop: 6 }}
        onClick={() => setEyeRows([...eyeRows, { kind: 'blink', minMs: 600, maxMs: 1000, commandId: '', on: true }])}
      >
        + Add eye mapping
      </button>
      {!eyeRows.length && (
        <button
          style={{ marginTop: 6, marginLeft: 6 }}
          title="A sane starting set you can edit"
          onClick={() => setEyeRows([
            { kind: 'blink', minMs: 600, maxMs: 1000, commandId: 'playPause', on: true },
            { kind: 'winkL', minMs: 600, maxMs: 1200, commandId: 'prevLine', on: true },
            { kind: 'winkR', minMs: 600, maxMs: 1200, commandId: 'nextLine', on: true },
            { kind: 'tongueOut', minMs: 500, maxMs: 1400, commandId: 'jumpToCurrent', on: true },
          ])}
        >
          Use a starter set
        </button>
      )}

      <p className="settings-note">
        Everything runs on-device — camera frames and microphone audio are analysed locally and never
        recorded or uploaded; the camera/mic only run while a control here is on. The face/hand models
        download once on first use and need a WebGL browser.
      </p>
    </Dialog>
  );
}
