import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';

// Calibrates the eyes-open vs eyes-shut threshold for the current user, so doze / attention detection
// is robust across faces, glasses and lighting. Drives the live monitor (passed in) through an open
// phase then a closed phase and saves the resulting threshold.
function Step({ text, remain }) {
  return (
    <div className="gamma-run" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 15 }}>{text}</p>
      <div className="comfort-count" style={{ fontSize: 40, margin: 0 }}>{remain}s</div>
    </div>
  );
}

export default function WebcamCalibrationDialog({ monitor, onSave, onClose }) {
  const [phase, setPhase] = useState('intro'); // intro | open | closed | done | unsupported
  const [remain, setRemain] = useState(0);
  const [result, setResult] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  async function run() {
    if (!monitor?.eyesAvailable?.()) { setPhase('unsupported'); return; }
    setPhase('open');
    const res = await monitor.runCalibration(
      { openMs: 2800, closedMs: 2800 },
      (ph, sec) => { if (aliveRef.current) { setPhase(ph); setRemain(sec); } },
    );
    if (!aliveRef.current) return;
    if (res && res.threshold != null) { setResult(res); setPhase('done'); onSave(res.threshold); }
    else setPhase('unsupported');
  }

  return (
    <Dialog title="Calibrate eye detection" onClose={onClose} width={460} buttons={<button onClick={onClose}>Close</button>}>
      {phase === 'intro' && (
        <>
          <p className="settings-note">
            This learns your eyes-open vs eyes-shut so doze / attention detection works across faces,
            glasses and lighting. You’ll look at the screen for a moment, then gently close your eyes.
            The camera must be running (turn on a webcam guard first).
          </p>
          <button className="dict-rec" onClick={run}>● Start calibration</button>
        </>
      )}
      {phase === 'open' && <Step text="Look at the screen with your eyes open…" remain={remain} />}
      {phase === 'closed' && <Step text="Now gently close your eyes…" remain={remain} />}
      {phase === 'done' && result && (
        <p className="tw-detected">✓ Calibrated — eyes-shut threshold set to {result.threshold.toFixed(2)} (open ≈ {result.open?.toFixed(2)}{result.closed != null ? `, shut ≈ ${result.closed.toFixed(2)}` : ''}).</p>
      )}
      {phase === 'unsupported' && (
        <p className="settings-note">
          Calibration needs the eye-landmark model running — turn on a webcam guard (Attention or Doze)
          so the camera + model are active, in a WebGL/Chromium browser, then try again.
        </p>
      )}
    </Dialog>
  );
}
