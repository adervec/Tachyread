import { useState, useRef, useEffect } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { pickChunk, scoreRecall, nextDrill, DEFAULT_DRILL } from '../engine/spanDrill.js';

// Tachistoscopic perceptual-span drill: a short horizontal run of words flashes briefly; the reader recalls
// what they caught in one glance. An adaptive staircase widens the span as they succeed, training how much
// text is taken in per fixation. Pulls phrases from the open document (falls back to a built-in corpus).
const FALLBACK = (
  'the quick brown fox jumps over a lazy dog while seven bright kites drift above the calm green valley and ' +
  'a curious otter studies the smooth round stones beneath the clear cold stream near the old stone bridge at dusk'
).split(' ');

export default function SpanDrillDialog({ doc, onClose }) {
  const { state, updateGlobal } = useApp();
  const corpus = doc && Array.isArray(doc.words) && doc.words.length >= 12 ? doc : { words: FALLBACK };
  const [phase, setPhase] = useState('ready'); // ready | flash | recall | result
  const [span, setSpan] = useState(DEFAULT_DRILL.span);
  const [flashMs, setFlashMs] = useState(DEFAULT_DRILL.flashMs);
  const [chunk, setChunk] = useState(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);
  const [rounds, setRounds] = useState(0);
  const [passes, setPasses] = useState(0);
  const bestRef = useRef(state.global.drillBestSpan || 0);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  function startFlash(sp, fm) {
    const c = pickChunk(corpus, sp);
    if (!c) return;
    setChunk(c); setTyped(''); setResult(null); setPhase('flash');
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setPhase('recall'), fm);
  }
  function submit() {
    const r = scoreRecall(chunk.words, typed);
    const passed = r.frac >= DEFAULT_DRILL.passFrac;
    setResult({ ...r, passed });
    setRounds((n) => n + 1);
    if (passed) {
      setPasses((n) => n + 1);
      if (span > bestRef.current) { bestRef.current = span; updateGlobal({ drillBestSpan: span }); }
    }
    setPhase('result');
  }
  function next() {
    const n = nextDrill({ span, flashMs }, !!(result && result.passed));
    setSpan(n.span); setFlashMs(n.flashMs);
    startFlash(n.span, n.flashMs);
  }

  const acc = rounds ? Math.round((passes / rounds) * 100) : 0;
  return (
    <Dialog
      title="Span drill — widen what you read per glance"
      onClose={onClose}
      buttons={<button onClick={onClose}>Done</button>}
    >
      <div className="span-drill">
        <div className="sd-stats">
          <span>span <b>{span}</b> words</span>
          <span>flash <b>{flashMs}</b> ms</span>
          <span>rounds <b>{rounds}</b></span>
          <span>acc <b>{acc}%</b></span>
          <span>best <b>{Math.max(bestRef.current, span)}</b></span>
        </div>
        <div className="sd-stage">
          {phase === 'ready' && (
            <div className="sd-ready">
              <p className="settings-note">A short line flashes for a moment. Read it in one glance, then type the words you caught — order doesn’t matter. The span widens as you keep up.</p>
              <button className="toggle-on" onClick={() => startFlash(span, flashMs)}>Flash ▸</button>
            </div>
          )}
          {phase === 'flash' && chunk && <div className="sd-flash">{chunk.words.join(' ')}</div>}
          {phase === 'recall' && (
            <form className="sd-recall" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <p className="settings-note">What did you read?</p>
              <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="type the words you saw…" />
              <button className="toggle-on" type="submit">Check</button>
            </form>
          )}
          {phase === 'result' && result && (
            <div className={`sd-result ${result.passed ? 'pass' : 'fail'}`}>
              <div className="sd-verdict">{result.passed ? `✓ ${result.matched}/${result.total} — span up` : `· ${result.matched}/${result.total} — easing off`}</div>
              <div className="sd-shown">shown: <b>{chunk.words.join(' ')}</b></div>
              <button className="toggle-on" onClick={next}>Next ▸</button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
