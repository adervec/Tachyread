import { useEffect, useRef, useState } from 'react';

// Ephemeral, session-only transcript of what the audio-command listener heard — a sanity check that
// listening works — plus a live oscilloscope of the incoming mic audio and a help "?" legend of every
// command and whether its mode is active. Lines are colour-coded: green when the speech matched a
// command, muted when nothing was recognized. Not persisted; clears when toggled off.
const VOICE_CMDS = [
  { say: '“play”', does: '▶ start reading' },
  { say: '“pause” / “stop”', does: '❚❚ pause' },
  { say: '“next” / “forward”', does: '→ next word' },
  { say: '“back”', does: '← previous word' },
];
const CLAP_CMDS = [
  { say: '👏', does: '⏯ play / pause' },
  { say: '👏 👏', does: '→ next word' },
  { say: '👏 👏 👏', does: '← previous word' },
];

export default function AudioChat({ log, scope, mode = 'Both', pos, onMove, onDrop, onClose }) {
  const endRef = useRef(null);
  const canvasRef = useRef(null);
  const elRef = useRef(null);
  const drag = useRef(null);
  const [showLegend, setShowLegend] = useState(false);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log]);

  // Draggable by its header (like the floating chips); clamped on-screen; position persisted by App.
  function onDown(e) {
    if (e.target.closest('button')) return; // let header buttons (help / close) work — no drag
    const r = elRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    // Capture on the header (the element that owns these handlers), NOT the whole chat: capturing a
    // parent would retarget move/up away from this handler, so onUp never fires and the chip sticks
    // to the pointer — dragging on mere hover and blocking the × button.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current; if (!d) return;
    onMove?.({ x: Math.max(4, Math.min(window.innerWidth - d.w - 4, e.clientX - d.dx)), y: Math.max(48, Math.min(window.innerHeight - d.h - 4, e.clientY - d.dy)) });
  }
  function onUp(e) { if (drag.current) { drag.current = null; e.currentTarget?.releasePointerCapture?.(e.pointerId); onDrop?.(pos); } }
  const posStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  // Oscilloscope: draw the live time-domain waveform from the mic analyser.
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

  const voiceOn = mode === 'Voice' || mode === 'Both';
  const clapOn = mode === 'Claps' || mode === 'Both';

  return (
    <div ref={elRef} className="audio-chat" role="log" aria-live="polite" style={posStyle}>
      <div className="audio-chat-head" onPointerDown={onDown} onPointerMove={onPointerMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to move">
        🎧 Audio commands
        <button className={`ac-help${showLegend ? ' on' : ''}`} title={showLegend ? 'Back to what was heard' : 'Show all commands'} onClick={() => setShowLegend((v) => !v)}>{showLegend ? '☰' : '?'}</button>
        <button className="ac-close" title="Close — turns voice commands off" onClick={onClose}>×</button>
      </div>
      {scope && <canvas ref={canvasRef} className="audio-scope" width={236} height={38} />}
      {showLegend ? (
        <div className="audio-legend">
          <div className={`al-group${voiceOn ? ' on' : ' off'}`}>
            <div className="al-title">🗣 Voice {voiceOn ? '· active' : '· off'}</div>
            {VOICE_CMDS.map((c, i) => <div key={i} className="al-row"><span className="al-say">{c.say}</span><span className="al-does">{c.does}</span></div>)}
          </div>
          <div className={`al-group${clapOn ? ' on' : ' off'}`}>
            <div className="al-title">👏 Claps {clapOn ? '· active' : '· off'}</div>
            {CLAP_CMDS.map((c, i) => <div key={i} className="al-row"><span className="al-say">{c.say}</span><span className="al-does">{c.does}</span></div>)}
          </div>
        </div>
      ) : (
        <div className="audio-chat-body">
          {log.length === 0 && <div className="audio-chat-empty">Listening… try “play”, “pause”, “next”, “back”.</div>}
          {log.map((e) => (
            <div key={e.id} className={`audio-chat-line ${e.command ? 'valid' : 'noop'}`}>
              <span className="audio-chat-ts">{e.time}</span>
              <span className="audio-chat-text">{e.transcript || '…'}</span>
              {e.action && <span className="audio-chat-action">→ {e.action}</span>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
