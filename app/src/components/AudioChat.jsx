import { useEffect, useRef, useState } from 'react';

// Ephemeral, session-only transcript of what the audio-command listener heard — a sanity check
// that listening works. Lines are colour-coded: green when the speech matched a command (with
// the action taken), muted when nothing was recognized. Not persisted; clears when toggled off.
// The panel is display-only (pointer-events:none in CSS, so it never blocks the controls beneath)
// and auto-dissipates after a quiet spell, reappearing the moment new speech is heard.
const QUIET_MS = 7000;
export default function AudioChat({ log }) {
  const endRef = useRef(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log]);
  // Show on any new heard line; hide again once nothing has been heard for QUIET_MS.
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), QUIET_MS);
    return () => clearTimeout(t);
  }, [log]);
  if (!visible) return null;
  return (
    <div className="audio-chat" role="log" aria-live="polite">
      <div className="audio-chat-head">🎧 Audio commands — heard this session</div>
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
    </div>
  );
}
