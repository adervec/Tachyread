import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createLiveAnalyzer } from '../features/voice/liveMetrics.js';
import { voiceScores, VOICE_ATTRS } from '../features/voice/voiceScore.js';

// The reading-aloud card: what the speech recogniser is hearing right now, what it expects next and
// how far it last moved the text (so a stall is visible, not a mystery), plus optional live
// voice-quality scores (SpeechImprover's acoustic attributes averaged over the session, with a
// trend). Draggable by its grip (position remembered per device), collapsible, and ✕ turns reading
// aloud off. Feedback only — no audio or scores are kept.
const TICK_MS = 110;
const PUBLISH_EVERY = 5; // ticks → scores refresh ~every 0.5 s
const TREND_CAP = 120;   // ~1 min of trend
const POS_KEY = 'tachyread-vf-pos';

const STATUS = {
  starting: '⏳ Starting…',
  listening: '🎧 Listening',
  restarting: '🔁 Reconnecting…',
};
// Recogniser errors in plain words, with what to do about them.
const ERRORS = {
  'not-allowed': 'Microphone or speech recognition is blocked for this site — allow the mic, then turn reading aloud off and on.',
  'service-not-allowed': 'The browser’s speech service is switched off. In Edge, turn on Windows Settings → Privacy → Speech → Online speech recognition; Chrome needs to be online.',
  network: 'Can’t reach the browser’s online speech service — check the connection (and in Edge, Windows “Online speech recognition”).',
  'audio-capture': 'No microphone found, or another app is holding it.',
  'language-not-supported': 'This language isn’t supported by the speech recogniser — change it in App Settings → Language.',
  'bad-grammar': 'The speech recogniser rejected the request.',
  'no-words': 'It hears you speaking but gets no words back — the browser’s online speech service isn’t answering. Check you’re online; in Edge turn on Windows Settings → Privacy → Speech → Online speech recognition; or try Chrome.',
};

function useDragPos() {
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { return null; } });
  const save = (p) => { setPos(p); try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
  return [pos, save];
}
const clampPos = (x, y, el) => {
  const w = el?.offsetWidth || 250, h = el?.offsetHeight || 80;
  return { x: Math.max(0, Math.min(window.innerWidth - w, x)), y: Math.max(0, Math.min(window.innerHeight - h, y)) };
};

export default function VoiceFeedback({ info = {}, nextWords = '', onStop, showScores = true, wordsRef, profile = 'neutral' }) {
  const [v, setV] = useState(null);
  const [trend, setTrend] = useState([]);
  const [micErr, setMicErr] = useState('');
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useDragPos();
  const cardRef = useRef(null);
  const drag = useRef(null);
  const voicedSince = useRef(0); // when our own mic analysis first heard a voice

  useEffect(() => {
    if (!showScores) return undefined;
    let stream, ctx, timer, dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const la = createLiveAnalyzer(ctx.sampleRate);
        const an = ctx.createAnalyser();
        an.fftSize = la.win;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(la.win);
        let n = 0;
        const t0 = performance.now();
        timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          la.pushWindow(buf, ctx.currentTime);
          if (++n % PUBLISH_EVERY) return;
          const snap = la.snapshot();
          if (!snap.voicedSamples) return;
          const speechMins = ((performance.now() - t0) / 60000) * (1 - snap.silenceRatio);
          const wpm = wordsRef?.current && speechMins > 0.05 ? wordsRef.current / speechMins : 0;
          const next = voiceScores({ ...snap, wpm }, profile);
          if (!next) return;
          if (!voicedSince.current) voicedSince.current = performance.now();
          setV(next);
          setTrend((tr) => [...tr.slice(-(TREND_CAP - 1)), next.overall]);
        }, TICK_MS);
      } catch (e) {
        setMicErr(e?.name === 'NotAllowedError' ? 'Microphone blocked — voice scores are off.' : `No voice scores: ${e?.message || e}`);
      }
    })();
    return () => {
      dead = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, [showScores, wordsRef, profile]);

  // Drag by the grip (pointer), or nudge it with the arrow keys when the grip has focus.
  const onGripDown = (e) => {
    const r = cardRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e) => {
    if (!drag.current) return;
    setPos(clampPos(e.clientX - drag.current.dx, e.clientY - drag.current.dy, cardRef.current));
  };
  const onGripUp = () => { drag.current = null; };
  const onGripKey = (e) => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (!d) return;
    e.preventDefault();
    const r = cardRef.current.getBoundingClientRect();
    setPos(clampPos(r.left + d[0], r.top + d[1], cardRef.current));
  };

  // Our analysis hears a voice but the recogniser has returned nothing for a while: the speech
  // service is the problem, not the mic — say so (some browsers never even report speechstart).
  // eslint-disable-next-line react-hooks/purity -- re-evaluated on each ~0.5 s score update
  const silentService = !info.heard && !info.error && v && voicedSince.current && performance.now() - voicedSince.current > 12000;
  const errKey = info.error || (silentService ? 'no-words' : '');
  const errText = errKey ? (ERRORS[errKey] || `Speech recognition error: ${errKey}`) : '';
  const W = 120, H = 22;
  const path = trend.length > 1
    ? trend.map((y, i) => `${i ? 'L' : 'M'}${((i / (trend.length - 1)) * W).toFixed(1)} ${(H - (y / 100) * H).toFixed(1)}`).join(' ')
    : '';
  // Portalled to <body>: it floats over everything, and the phone layout hides the reading column
  // it would otherwise sit in.
  return createPortal(
    <div ref={cardRef} className="vf-card" role="region" aria-label="Reading aloud" style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="vf-head">
        <button type="button" className="vf-grip" aria-label="Move this card (drag, or use the arrow keys)" title="Drag to move"
          onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} onKeyDown={onGripKey}>⠿</button>
        <span className="vf-title">🗣 Reading aloud{showScores && v ? <> · <b>{v.overall}</b></> : ''}</span>
        {path && open && <svg className="vf-trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Overall voice score trend"><path d={path} /></svg>}
        <button type="button" className="vf-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <button type="button" className="vf-btn" onClick={onStop} aria-label="Stop reading aloud" title="Stop reading aloud">✕</button>
      </div>
      <div className={`vf-status${errKey ? ' err' : ''}`} role="status" aria-live="polite">
        {errText || STATUS[info.status] || STATUS.starting}{info.lang ? <span className="vf-lang"> · {info.lang}</span> : ''}
        {info.move && !errKey && <span className={`vf-move${info.move.startsWith('+') ? ' ok' : ''}`}> · {info.move}</span>}
      </div>
      <div className="vf-heard" title="What the speech recogniser hears">
        {info.heard ? (info.final ? info.heard : <i>{info.heard}</i>) : <span className="vf-dim">…nothing heard yet — read the highlighted text aloud</span>}
      </div>
      {open && nextWords && <div className="vf-next" title="The words it expects next">Next: {nextWords}</div>}
      {open && showScores && (
        <>
          {micErr && <div className="vf-note">{micErr}</div>}
          {v && (
            <div className="vf-bars">
              {Object.entries(VOICE_ATTRS).map(([k, [label]]) => (v.scores[k] == null ? null : (
                <div key={k} className="vf-bar" title={`${label}: ${v.scores[k]} / 100`}>
                  <span className="vf-lbl">{label}</span>
                  <span className="vf-track"><span className="vf-fill" style={{ width: `${v.scores[k]}%` }} /></span>
                  <span className="vf-num">{v.scores[k]}</span>
                </div>
              )))}
            </div>
          )}
          {v?.weakest && <div className="vf-note">Work on <b>{VOICE_ATTRS[v.weakest][0].toLowerCase()}</b>: {VOICE_ATTRS[v.weakest][3]}</div>}
        </>
      )}
    </div>,
    document.body,
  );
}
