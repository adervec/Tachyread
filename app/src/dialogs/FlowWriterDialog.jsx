import { useState, useRef, useMemo, useEffect } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { COMMON_WORDS } from '../engine/surprisal.js';
import { buildDict, completeWord, throughput } from '../engine/predict.js';

// Flow Writer — a predictive composer that trains output-per-keystroke (the lever behind fast text output:
// stenographers hit ~3× QWERTY by emitting whole words per stroke). Type freely; when a completion appears,
// press Tab to accept the whole word — one keystroke, many characters. Reports net WPM + amplification
// (chars per keystroke). The dictionary blends common words with the open document's vocabulary.
export default function FlowWriterDialog({ doc, onClose }) {
  const { state, updateGlobal } = useApp();
  const dict = useMemo(() => buildDict(COMMON_WORDS, doc && doc.words ? doc.words : []), [doc]);
  const [text, setText] = useState('');
  const [keys, setKeys] = useState(0);
  const startRef = useRef(0);
  const peakRef = useRef(0);
  const savedBest = (() => { const b = Math.round(state.global.bestFlowWpm || 0); return b > 0 && b <= 400 ? b : 0; })(); // ignore implausible stored values
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);

  const prefixMatch = text.match(/[\p{L}\p{N}']+$/u);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const suffix = completeWord(prefix, dict);

  const ms = startRef.current ? Date.now() - startRef.current : 0;
  const { wpm, amplification } = throughput(text.length, keys, ms);
  useEffect(() => { if (ms > 2000 && wpm > peakRef.current && wpm <= 400) peakRef.current = wpm; });
  useEffect(() => () => {
    const peak = Math.min(400, Math.max(savedBest, peakRef.current));
    if (peak > savedBest) updateGlobal({ bestFlowWpm: peak });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChange(e) {
    if (!startRef.current && e.target.value) startRef.current = Date.now();
    setKeys((k) => k + 1);
    setText(e.target.value);
  }
  function onKeyDown(e) {
    if (e.key === 'Tab' && suffix) {
      e.preventDefault();
      if (!startRef.current) startRef.current = Date.now();
      setKeys((k) => k + 1); // one keystroke yields the whole word
      setText((t) => t + suffix + ' ');
    }
  }
  function reset() { setText(''); setKeys(0); startRef.current = 0; peakRef.current = 0; }

  return (
    <Dialog
      title="Flow Writer — more text per keystroke"
      onClose={onClose}
      buttons={<><button onClick={reset}>Reset</button><button onClick={onClose}>Done</button></>}
    >
      <div className="flow-writer">
        <div className="fw-stats">
          <span>net <b>{wpm}</b> wpm</span>
          <span>amp <b>{amplification}×</b></span>
          <span>chars <b>{text.length}</b></span>
          <span>keys <b>{keys}</b></span>
          <span>best <b>{Math.min(400, Math.max(savedBest, peakRef.current, wpm))}</b></span>
        </div>
        <textarea
          className="fw-area" value={text} onChange={onChange} onKeyDown={onKeyDown} rows={6} autoFocus
          placeholder="Type freely. When a completion appears below, press Tab to accept the whole word — one keystroke, many characters (the stenographer's trick for output speed)."
        />
        <div className="fw-suggest">
          {suffix
            ? <span>Tab&nbsp;→&nbsp;<b className="fw-word">{prefix}<span className="fw-ghost">{suffix}</span></b></span>
            : <span className="settings-note" style={{ margin: 0 }}>Completions appear here as you type.</span>}
        </div>
      </div>
    </Dialog>
  );
}
