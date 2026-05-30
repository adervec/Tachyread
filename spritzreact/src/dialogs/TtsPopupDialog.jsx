import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useVoices, speak, cancelSpeech, rateFromIndex } from '../features/tts.js';

export default function TtsPopupDialog({ tab, onClose }) {
  const voices = useVoices();
  const [voice, setVoice] = useState(tab.settings.annunciateVoice || '');
  const [rateIdx, setRateIdx] = useState(tab.settings.annunciateRate || 0);
  const [from, setFrom] = useState(tab.settings.wordIndex);
  const [to, setTo] = useState(Math.min(tab.doc.words.length, tab.settings.wordIndex + 200));
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  async function start() {
    stopRef.current = false;
    setRunning(true);
    const text = tab.doc.words.slice(from, to).join(' ');
    speak(text, {
      voiceName: voice,
      rate: rateFromIndex(rateIdx),
      onEnd: () => setRunning(false),
      onError: () => setRunning(false),
    });
  }
  function stop() {
    stopRef.current = true;
    cancelSpeech();
    setRunning(false);
  }
  useEffect(() => () => cancelSpeech(), []);

  return (
    <Dialog
      title="Text-to-Speech Reader"
      onClose={() => { stop(); onClose(); }}
      width={520}
      buttons={
        <>
          {running ? (
            <button className="toggle-on" onClick={stop}>Stop</button>
          ) : (
            <button className="toggle-on" onClick={start}>Speak</button>
          )}
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="field-row">
        <label>Voice</label>
        <select value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="">(default)</option>
          {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Rate (−5..+8)</label>
        <input type="number" min={-5} max={8} value={rateIdx} onChange={(e) => setRateIdx(Number(e.target.value))} />
      </div>
      <div className="field-row">
        <label>From word</label>
        <input type="number" value={from} min={0} max={tab.doc.words.length - 1} onChange={(e) => setFrom(Number(e.target.value))} />
      </div>
      <div className="field-row">
        <label>To word</label>
        <input type="number" value={to} min={1} max={tab.doc.words.length} onChange={(e) => setTo(Number(e.target.value))} />
      </div>
    </Dialog>
  );
}
