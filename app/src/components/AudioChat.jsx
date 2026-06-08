import { useEffect, useRef } from 'react';

// Ephemeral, session-only transcript of what the audio-command listener heard — a sanity check
// that listening works. Lines are colour-coded: green when the speech matched a command (with
// the action taken), muted when nothing was recognized. Not persisted; clears when toggled off.
export default function AudioChat({ log }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [log]);
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
