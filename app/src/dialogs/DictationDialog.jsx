import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { createRecognizer, speechRecognitionSupported } from '../features/speechRecognition.js';
import { countWords, netWpm, formatElapsed } from '../engine/dictation.js';

// Dictation throughput — put spoken output on the same footing as the typing / Flow Writer track.
// Speech (Web Speech API) fills a transcript; net WPM = words / active minutes. The transcript is an
// editable textarea, so the measurement also works without a microphone (paste or type to test).
export default function DictationDialog({ onClose }) {
  const { state, updateGlobal } = useApp();
  const best = state.global.bestDictationWpm || 0;
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');
  const recRef = useRef(null);
  const startRef = useRef(0);
  const supported = !!speechRecognitionSupported();

  const words = countWords(transcript);
  const wpm = netWpm(words, elapsed);

  // Active-time clock while recording. startRef is offset so Stop/Start pauses and resumes.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  function start() {
    setErr('');
    startRef.current = Date.now() - elapsed; // resume from accumulated elapsed
    setRecording(true);
    const r = createRecognizer({
      onResult: ({ transcript: text, isFinal }) => {
        if (isFinal) {
          setTranscript((prev) => (prev ? prev + ' ' : '') + text);
          setInterim('');
        } else {
          setInterim(text);
        }
      },
      onError: (e) => {
        if (e === 'not-allowed' || e === 'service-not-allowed')
          setErr('Microphone blocked — allow mic access to dictate (you can still type/paste below).');
        else if (e !== 'no-speech' && e !== 'aborted') setErr(`Speech error: ${e}`);
      },
    });
    if (r) {
      try { r.start(); } catch { /* already started */ }
      recRef.current = r;
    }
  }

  function stop() {
    setRecording(false);
    if (recRef.current) { try { recRef.current.stop(); } catch { /* ignore */ } recRef.current = null; }
    setInterim('');
    const w = netWpm(countWords(transcript), Date.now() - startRef.current);
    if (w > best) updateGlobal({ bestDictationWpm: w });
  }

  function clearAll() {
    setTranscript('');
    setInterim('');
    setElapsed(0);
    startRef.current = Date.now();
  }

  return (
    <Dialog
      title="Dictation — speak to write"
      onClose={() => { stop(); onClose(); }}
      width={600}
      buttons={<button onClick={() => { stop(); onClose(); }}>Close</button>}
    >
      <div className="dict-stats">
        <div className="dict-wpm">
          <b>{wpm}</b>
          <span>net WPM</span>
        </div>
        <div className="dict-meta">
          <div><b>{words}</b> words</div>
          <div><b>{formatElapsed(elapsed)}</b> active</div>
          <div><b>{best}</b> best WPM</div>
        </div>
      </div>

      <div className="dict-controls">
        {recording ? (
          <button className="dict-rec on" onClick={stop}>■ Stop</button>
        ) : (
          <button className="dict-rec" onClick={start}>● {elapsed > 0 ? 'Resume' : 'Start'}</button>
        )}
        <button onClick={clearAll} disabled={!transcript && elapsed === 0}>Clear</button>
        <button
          onClick={() => navigator.clipboard?.writeText(transcript).catch(() => {})}
          disabled={!transcript}
        >
          Copy
        </button>
        {recording && <span className="dict-live">● listening{interim ? `: ${interim}` : '…'}</span>}
      </div>

      {!supported && (
        <p className="settings-note">
          Voice input needs a Chromium browser (Chrome/Edge) with the Web Speech API. You can still
          type or paste below to measure throughput.
        </p>
      )}
      {err && <p className="settings-note" style={{ color: 'var(--danger, #c0392b)' }}>{err}</p>}

      <textarea
        className="dict-transcript"
        value={transcript}
        placeholder="Your dictation appears here. Speak after pressing Start (or type/paste to test)."
        onChange={(e) => setTranscript(e.target.value)}
        rows={7}
      />

      <p className="settings-note" style={{ marginTop: 6 }}>
        Net WPM counts words over active (recording) time, pauses included — the honest output rate.
        Recognition uses your browser&rsquo;s Web Speech API — in Chrome and Edge the audio is sent to
        the browser maker&rsquo;s servers to transcribe; this app itself uploads nothing.
      </p>
    </Dialog>
  );
}
