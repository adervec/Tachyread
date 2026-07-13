import { useEffect, useRef, useState } from 'react';
import { GESTURE_INFO } from '../features/handGestures.js';
import { actionLabel } from '../features/commandRegistry.js';

// The Biometric Control Feed: one draggable, resizable popup that unifies the camera and the
// voice/clap subsystems. Shows the live self-view (when a camera feature is on), a mic oscilloscope
// (when voice commands are on), and a single time-ordered event feed of everything detected — hand
// gestures, attention events, spoken commands and claps interleaved. A "?" legend lists every
// possible trigger and whether it's active. Everything is analysed on-device; nothing is uploaded.

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
export default function BiometricFeed({
  stream, camState, handState, scope, mode = 'Both', log,
  feedHeight, onResizeFeed, features, voiceOn, gestureMap, voiceCommands, clapMap,
  pos, onMove, onDrop, canCalibrate, onCalibrate, onCalibrateHand, onMinimize, onClose,
}) {
  const vref = useRef(null);
  const canvasRef = useRef(null);
  const elRef = useRef(null);
  const bodyRef = useRef(null);
  const endRef = useRef(null);
  const drag = useRef(null);
  const [showLegend, setShowLegend] = useState(false);

  useEffect(() => { const v = vref.current; if (!v) return; v.srcObject = stream || null; if (stream) v.play?.().catch(() => {}); }, [stream]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log]);

  // Draggable by its header (same pattern as the floating chips); clamped on-screen; position
  // persisted by App. Pointer capture stays on the header so buttons still work and the panel
  // doesn't stick to the cursor.
  function onDown(e) {
    if (e.target.closest('button')) return;
    const r = elRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current; if (!d) return;
    onMove?.({ x: Math.max(4, Math.min(window.innerWidth - d.w - 4, e.clientX - d.dx)), y: Math.max(48, Math.min(window.innerHeight - d.h - 4, e.clientY - d.dy)) });
  }
  function onUp(e) { if (drag.current) { drag.current = null; e.currentTarget?.releasePointerCapture?.(e.pointerId); onDrop?.(pos); } }
  const posStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  // Oscilloscope: draw the live time-domain waveform from the mic analyser (reused from AudioChat).
  useEffect(() => {
    if (!scope || !canvasRef.current) return undefined;
    const cv = canvasRef.current;
    const g = cv.getContext('2d');
    const buf = new Uint8Array(scope.size);
    let raf = 0;
    const draw = () => {
      scope.wave(buf);
      const W = cv.width, H = cv.height;
      g.clearRect(0, 0, W, H);
      g.lineWidth = 2;
      g.strokeStyle = getComputedStyle(cv).getPropertyValue('color') || '#3a86ff';
      g.beginPath();
      const step = Math.max(1, Math.floor(buf.length / W));
      for (let x = 0, i = 0; x < W; x++, i += step) {
        const y = (buf[i] / 255) * H;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scope]);

  // Feed length: the body is CSS `resize: vertical`; persist the dragged height on release.
  function persistFeedHeight() {
    const h = bodyRef.current?.offsetHeight;
    if (h && h !== feedHeight) onResizeFeed?.(h);
  }

  const ring = camState === 'away' ? 'away' : camState === 'drowsy' ? 'drowsy'
    : (camState === 'denied' || camState === 'error' || camState === 'unsupported') ? 'error' : 'watching';
  const cam = camState ? CAM_EVENT[camState] : null;
  const hand = handState ? HAND_EVENT[handState] : null;
  const clapOn = mode === 'Claps' || mode === 'Both';
  const spokenOn = mode === 'Voice' || mode === 'Both';

  // Combined legend: attention/gesture rows (from camera features) + voice + clap rows. Gesture rows
  // show the command each gesture is currently mapped to (scroll stays the built-in joystick).
  const camLegend = [];
  if (features) {
    camLegend.push({ on: features.attention, icon: '👀', label: 'Attention pause', desc: 'Pauses fast reading when you’re not facing the screen' });
    camLegend.push({ on: features.doze, icon: '💤', label: 'Doze stop', desc: 'Stops read-aloud if your eyes stay shut or you’re away' });
    camLegend.push({ on: features.awayAlarm, icon: '🔔', label: 'Away alarm', desc: 'Sounds an alarm after you look away too long' });
    camLegend.push({ on: features.distanceNudge, icon: '↔', label: 'Posture nudge', desc: 'Reminds you to ease back when you’re too close' });
    camLegend.push({ on: features.focusStats, icon: '📊', label: 'Focus analytics', desc: 'Logs focus % and distractions to Reading History' });
    for (const [k, info] of Object.entries(GESTURE_INFO)) {
      const does = k === 'scroll' ? 'scroll joystick' : (actionLabel(gestureMap?.[k]) || 'unassigned');
      camLegend.push({ on: !!features.handGestures && !!(features.gestures && features.gestures[k]), icon: info.icon, label: `${info.label} → ${does}`, desc: info.desc });
    }
  }

  return (
    <div ref={elRef} className={`bio-feed wb-${ring}`} role="log" aria-live="polite" style={posStyle}>
      <div className="bio-feed-head" onPointerDown={onDown} onPointerMove={onPointerMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to move">
        <span className="wpv-dot" />
        <span className="bf-title">Biometric Control Feed</span>
        <span style={{ flex: 1 }} />
        <button className={showLegend ? 'on' : ''} title={showLegend ? 'Back to the event feed' : 'Legend of every trigger'} onClick={() => setShowLegend((v) => !v)}>{showLegend ? '☰' : '?'}</button>
        {canCalibrate && <button title="Calibrate eye detection" onClick={onCalibrate}>⚙</button>}
        <button title="Minimize (keeps running)" onClick={onMinimize}>–</button>
        <button title="Close — turns the biometric controls off" onClick={onClose}>×</button>
      </div>

      {stream && (
        <div className="cam-video-wrap">
          <video ref={vref} muted playsInline className="cam-video" />
          <div className="cam-overlay" aria-hidden="true">
            {cam && <span className={`cam-ev cam-ev-${ring}`}>{cam.icon} {cam.text}</span>}
            {hand && <span className="cam-ev cam-ev-hand">{hand.icon} {hand.text}</span>}
          </div>
        </div>
      )}
      {scope && <canvas ref={canvasRef} className="bio-scope" width={272} height={38} />}

      {showLegend ? (
        <div className="bio-legend">
          {camLegend.length > 0 && (
            <div className="bl-group">
              <div className="bl-title">🎥 Camera &amp; gestures — ✓ = active</div>
              {camLegend.map((r, i) => (
                <div key={i} className={`bl-row${r.on ? ' on' : ' off'}`} title={r.desc}>
                  <span className="bl-state">{r.on ? '✓' : '·'}</span>
                  <span className="bl-icon">{r.icon}</span>
                  <span className="bl-label">{r.label}</span>
                </div>
              ))}
              {features?.handGestures && <button className="bl-cal" onClick={onCalibrateHand}>🖐 Calibrate hand range…</button>}
            </div>
          )}
          {voiceOn && (
            <>
              <div className={`bl-group${spokenOn ? '' : ' off'}`}>
                <div className="bl-title">🗣 Voice {spokenOn ? '· active' : '· off'}</div>
                {(voiceCommands || []).map((c, i) => <div key={i} className="bl-cmd"><span className="bl-say">“{c.phrase}”</span><span className="bl-does">{actionLabel(c.commandId) || '—'}</span></div>)}
              </div>
              <div className={`bl-group${clapOn ? '' : ' off'}`}>
                <div className="bl-title">👏 Claps {clapOn ? '· active' : '· off'}</div>
                {[1, 2, 3].map((n) => <div key={n} className="bl-cmd"><span className="bl-say">{'👏'.repeat(n)}</span><span className="bl-does">{actionLabel(clapMap?.[n]) || '—'}</span></div>)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          ref={bodyRef}
          className="bio-feed-body"
          style={feedHeight ? { height: feedHeight } : undefined}
          onPointerUp={persistFeedHeight}
        >
          {(!log || log.length === 0) && <div className="bio-feed-empty">Watching &amp; listening… detected events appear here.</div>}
          {(log || []).map((e) => (
            <div key={e.id} className={`bio-feed-line src-${e.source} ${e.tone || ''}`}>
              <span className="bf-ts">{e.time}</span>
              <span className="bf-text">{e.icon ? `${e.icon} ` : ''}{e.text}</span>
              {e.action && <span className="bf-action">→ {e.action}</span>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
