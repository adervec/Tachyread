import { useEffect, useRef, useState } from 'react';
import { GESTURE_INFO } from '../features/handGestures.js';

const CAM_EVENT = {
  starting: { icon: '📷', text: 'starting camera…' },
  watching: { icon: '👀', text: 'watching' },
  away: { icon: '🙈', text: 'looked away' },
  drowsy: { icon: '💤', text: 'drowsy' },
  denied: { icon: '🚫', text: 'camera blocked' },
  error: { icon: '⚠', text: 'camera error' },
  unsupported: { icon: '⚠', text: 'detection unsupported' },
};
const HAND_EVENT = {
  hand: { icon: '✋', text: 'hand' },
  'scroll-up': { icon: '⬆', text: 'scroll up' },
  'scroll-down': { icon: '⬇', text: 'scroll down' },
};

// The camera popup: a live self-view with an event log and an on-video overlay of what the camera is
// currently picking up, plus a help "?" legend of every possible event/gesture and whether it's
// active. Closing it (×) turns the camera features off entirely; − minimizes to the status badge
// (camera keeps running). Everything is analysed on-device; nothing is recorded or uploaded.
export default function CameraPanel({ stream, camState, handState, log, features, canCalibrate, onCalibrate, onCalibrateHand, onMinimize, onClose }) {
  const vref = useRef(null);
  const logEndRef = useRef(null);
  const [showLegend, setShowLegend] = useState(false);
  useEffect(() => { const v = vref.current; if (!v) return; v.srcObject = stream || null; if (stream) v.play?.().catch(() => {}); }, [stream]);
  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }); }, [log]);

  const ring = camState === 'away' ? 'away' : camState === 'drowsy' ? 'drowsy'
    : (camState === 'denied' || camState === 'error' || camState === 'unsupported') ? 'error' : 'watching';
  const cam = CAM_EVENT[camState];
  const hand = HAND_EVENT[handState];

  // Legend of every possible event/gesture, marked ✓ when that feature is currently enabled.
  const legend = [];
  if (features) {
    legend.push({ on: features.attention, icon: '👀', label: 'Attention pause', desc: 'Pauses fast reading when you’re not facing the screen' });
    legend.push({ on: features.doze, icon: '💤', label: 'Doze stop', desc: 'Stops read-aloud if your eyes stay shut or you’re away' });
    legend.push({ on: features.awayAlarm, icon: '🔔', label: 'Away alarm', desc: 'Sounds an alarm after you look away too long' });
    legend.push({ on: features.distanceNudge, icon: '↔', label: 'Posture nudge', desc: 'Reminds you to ease back when you’re too close' });
    legend.push({ on: features.focusStats, icon: '📊', label: 'Focus analytics', desc: 'Logs focus % and distractions to Reading History' });
    for (const [k, info] of Object.entries(GESTURE_INFO)) {
      legend.push({ on: !!features.handGestures && !!(features.gestures && features.gestures[k]), icon: info.icon, label: info.label, desc: info.desc });
    }
  }

  return (
    <div className={`camera-panel wb-${ring}`}>
      <div className="cam-video-wrap">
        <video ref={vref} muted playsInline className="cam-video" />
        <div className="cam-overlay" aria-hidden="true">
          {cam && <span className={`cam-ev cam-ev-${ring}`}>{cam.icon} {cam.text}</span>}
          {hand && <span className="cam-ev cam-ev-hand">{hand.icon} {hand.text}</span>}
        </div>
      </div>
      <div className="cam-bar">
        <span className="wpv-dot" />
        <span className="cam-title">Camera</span>
        <span style={{ flex: 1 }} />
        <button className={showLegend ? 'on' : ''} title={showLegend ? 'Back to event log' : 'Legend of all events / gestures'} onClick={() => setShowLegend((v) => !v)}>{showLegend ? '☰' : '?'}</button>
        {canCalibrate && <button title="Calibrate eye detection" onClick={onCalibrate}>⚙</button>}
        <button title="Minimize (camera keeps running)" onClick={onMinimize}>–</button>
        <button title="Close — turns the camera off" onClick={onClose}>×</button>
      </div>
      {showLegend ? (
        <div className="cam-legend">
          <div className="cam-legend-head">Events &amp; gestures — ✓ = active now</div>
          {legend.map((r, i) => (
            <div key={i} className={`cam-legend-row${r.on ? ' on' : ' off'}`} title={r.desc}>
              <span className="cl-state">{r.on ? '✓' : '·'}</span>
              <span className="cl-icon">{r.icon}</span>
              <span className="cl-label">{r.label}</span>
            </div>
          ))}
          {features?.handGestures && <button className="cam-legend-cal" onClick={onCalibrateHand}>🖐 Calibrate hand range…</button>}
        </div>
      ) : (
        <div className="cam-log" role="log" aria-live="polite">
          {(!log || log.length === 0) && <div className="cam-log-empty">Watching… detected events appear here.</div>}
          {(log || []).map((e) => (
            <div key={e.id} className={`cam-log-line ${e.kind || ''}`}>
              <span className="cam-log-ts">{e.time}</span>
              <span className="cam-log-text">{e.icon} {e.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
