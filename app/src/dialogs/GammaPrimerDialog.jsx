import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { createGammaPrimer } from '../features/gammaPrimer.js';
import { DEFAULT_GAMMA, GAMMA_LIMITS } from '../engine/gamma.js';

// 40 Hz auditory focus primer — the most caveated, opt-in feature in the app. AUDIO ONLY (no visual
// flicker → no photosensitive-seizure hazard), gated behind the disclaimer acknowledgement, with an
// explicit per-use "I understand" check, conservative limits, and honest "experimental / unproven"
// framing. It is here as a curiosity, not a study aid.
function ackedDisclaimer() {
  try { return !!localStorage.getItem('tachyread-disclaimer-ack'); } catch { return false; }
}

export default function GammaPrimerDialog({ onClose }) {
  const { state, updateGlobal, openDialog } = useApp();
  const saved = state.global.gammaPrimer || {};
  const [carrierHz, setCarrierHz] = useState(saved.carrierHz ?? DEFAULT_GAMMA.carrierHz);
  const [volume, setVolume] = useState(saved.volume ?? DEFAULT_GAMMA.volume);
  const [durationSec, setDurationSec] = useState(saved.durationSec ?? DEFAULT_GAMMA.durationSec);
  const [running, setRunning] = useState(false);
  const [remain, setRemain] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const primerRef = useRef(null);
  const acked = ackedDisclaimer();

  useEffect(() => () => { primerRef.current?.stop(); }, []);

  function persist(p) {
    updateGlobal({ gammaPrimer: { carrierHz, volume, durationSec, ...p } });
  }
  function start() {
    if (!primerRef.current) primerRef.current = createGammaPrimer();
    const ok = primerRef.current.start(
      { carrierHz, volume, durationSec },
      { onTick: (r) => setRemain(r), onDone: () => { setRunning(false); setRemain(0); } },
    );
    if (ok) { setRunning(true); setRemain(durationSec); }
  }
  function stop() {
    primerRef.current?.stop();
    setRunning(false);
    setRemain(0);
  }

  if (!acked) {
    return (
      <Dialog
        title="Focus Primer (40 Hz) — experimental"
        onClose={onClose}
        width={520}
        buttons={<button onClick={onClose}>Close</button>}
      >
        <p className="settings-note" style={{ fontSize: 13 }}>
          Please read <strong>About / Disclaimer</strong> first — this experimental feature is gated
          behind acknowledging it.
        </p>
        <button onClick={() => openDialog({ kind: 'disclaimer' })}>Open Disclaimer</button>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Focus Primer (40 Hz) — experimental"
      onClose={() => { stop(); onClose(); }}
      width={520}
      buttons={<button onClick={() => { stop(); onClose(); }}>Close</button>}
    >
      <div className="gamma-warn">
        <strong>Experimental and unproven for reading.</strong> Audio only — there is no flashing
        visual. Stop immediately if you feel any discomfort, dizziness, headache, or visual aura, and
        keep the volume comfortable. This is not medical advice.
      </div>

      {running ? (
        <div className="gamma-run">
          <div className="gamma-count">{remain}s</div>
          <button className="dict-rec on" onClick={stop}>■ Stop</button>
        </div>
      ) : (
        <>
          <div className="field-row">
            <label>Carrier tone (Hz)</label>
            <div>
              <input
                type="range"
                min={GAMMA_LIMITS.carrierHz[0]}
                max={GAMMA_LIMITS.carrierHz[1]}
                step={10}
                value={carrierHz}
                onChange={(e) => { const v = Number(e.target.value); setCarrierHz(v); persist({ carrierHz: v }); }}
              />{' '}
              {carrierHz}
            </div>
          </div>
          <div className="field-row">
            <label>Volume</label>
            <div>
              <input
                type="range"
                min={0}
                max={GAMMA_LIMITS.volume[1]}
                step={0.01}
                value={volume}
                onChange={(e) => { const v = Number(e.target.value); setVolume(v); persist({ volume: v }); }}
              />
            </div>
          </div>
          <div className="field-row">
            <label>Duration (seconds)</label>
            <div>
              <input
                type="number"
                min={GAMMA_LIMITS.durationSec[0]}
                max={GAMMA_LIMITS.durationSec[1]}
                value={durationSec}
                onChange={(e) => {
                  const v = Math.max(GAMMA_LIMITS.durationSec[0], Math.min(GAMMA_LIMITS.durationSec[1], Number(e.target.value) || GAMMA_LIMITS.durationSec[0]));
                  setDurationSec(v);
                  persist({ durationSec: v });
                }}
                style={{ width: 70 }}
              />
            </div>
          </div>
          <label className="inline-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I understand this is experimental and will stop if I feel any discomfort.
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="dict-rec" disabled={!agreed} onClick={start}>● Start primer</button>
          </div>
        </>
      )}

      <p className="settings-note" style={{ marginTop: 12 }}>
        Why audio only: a flickering 40 Hz <em>screen</em> can trigger photosensitive seizures, so this
        uses sound. Evidence note: single-session 40 Hz entrains brain rhythms but has not shown an
        acute reading benefit — a curiosity, not a study aid.
      </p>
    </Dialog>
  );
}
