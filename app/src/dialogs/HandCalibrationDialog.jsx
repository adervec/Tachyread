import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';

// Calibrates the hand-gesture scroll joystick: learns your rest / top / bottom palm heights so
// scroll speed maps to your comfortable range at your seating distance. Drives the live gesture
// monitor (passed in) through three timed phases and saves the result.
function Step({ text, remain }) {
  return (
    <div className="gamma-run" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 15 }}>{text}</p>
      <div className="comfort-count" style={{ fontSize: 40, margin: 0 }}>{remain}s</div>
    </div>
  );
}

export default function HandCalibrationDialog({ monitor, onSave, onClose }) {
  const [phase, setPhase] = useState('intro'); // intro | rest | top | bottom | done | failed | unsupported
  const [remain, setRemain] = useState(0);
  const [result, setResult] = useState(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  async function run() {
    if (!monitor || monitor.getState?.() === 'off') { setPhase('unsupported'); return; }
    setPhase('rest');
    const cal = await monitor.runCalibration(
      {},
      (ph, sec) => { if (aliveRef.current) { setPhase(ph); setRemain(sec); } },
    );
    if (!aliveRef.current) return;
    if (cal) { setResult(cal); setPhase('done'); onSave(cal); }
    else setPhase('failed');
  }

  return (
    <Dialog title="Calibrate hand-gesture scrolling" onClose={onClose} width={480} buttons={<button onClick={onClose}>Close</button>}>
      {phase === 'intro' && (
        <>
          <p className="settings-note">
            This learns your palm's rest, top and bottom heights so the scroll joystick fits your
            reach: holding your open palm above rest scrolls up, below scrolls down — farther means
            faster. Keep your open palm facing the camera through three short steps.
          </p>
          <button className="dict-rec" onClick={run}>● Start calibration</button>
        </>
      )}
      {phase === 'rest' && <Step text="Hold your open palm where it naturally rests…" remain={remain} />}
      {phase === 'top' && <Step text="Now raise it to your comfortable highest point…" remain={remain} />}
      {phase === 'bottom' && <Step text="Now lower it to your comfortable lowest point…" remain={remain} />}
      {phase === 'done' && result && (
        <p className="tw-detected">
          ✓ Calibrated — rest {result.centerY.toFixed(2)}, top {result.topY.toFixed(2)}, bottom {result.bottomY.toFixed(2)}.
          Open palm above rest scrolls up, below scrolls down; a wave toggles play/pause.
        </p>
      )}
      {phase === 'failed' && (
        <p className="settings-note">
          Couldn’t read a steady hand in one of the steps (or top/bottom weren’t clearly above and
          below rest). Make sure your open palm is visible to the camera and try again.
        </p>
      )}
      {phase === 'unsupported' && (
        <p className="settings-note">
          The gesture monitor isn’t running — turn on <strong>Hand gestures</strong> in Application
          Settings first (needs a camera and a WebGL browser), then try again.
        </p>
      )}
    </Dialog>
  );
}
