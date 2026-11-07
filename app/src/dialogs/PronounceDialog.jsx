import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { getSentenceIndex } from '../document/readerDocument.js';

// Train → Pronunciation Check: read the sentence at your place aloud; a phoneme recogniser (on this
// device) hears the sounds you made and each word is scored against how it should sound, with the
// expected vs heard sounds (IPA) on hover. First use downloads the model (~320 MB, once).
const ESPEAK = { en: 'en-us', de: 'de', fr: 'fr-fr', es: 'es', it: 'it', pt: 'pt', nl: 'nl', hr: 'hr', pl: 'pl', sv: 'sv', ru: 'ru' };
const clean = (w) => String(w).replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');

function sentenceAt(doc, wi) {
  const si = getSentenceIndex(doc, wi);
  let a = wi, b = wi;
  while (a > 0 && getSentenceIndex(doc, a - 1) === si) a--;
  while (b < doc.words.length - 1 && getSentenceIndex(doc, b + 1) === si && b - a < 40) b++;
  return { start: a, end: b, words: doc.words.slice(a, b + 1) };
}

export default function PronounceDialog({ tab, onClose }) {
  const { state } = useApp();
  const [wi, setWi] = useState(tab.settings.wordIndex || 0);
  const sent = useMemo(() => sentenceAt(tab.doc, wi), [tab.doc, wi]);
  const [phase, setPhase] = useState('idle'); // idle | recording | scoring
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');
  const rec = useRef(null);
  const worker = useRef(null);
  useEffect(() => () => { worker.current?.terminate(); rec.current?.stream?.getTracks().forEach((t) => t.stop()); }, []);
  const lang = ESPEAK[(state.global.language || 'en').slice(0, 2)] || 'en-us';

  async function start() {
    setRes(null); setMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); score(new Blob(chunks, { type: mr.mimeType })); };
      mr.start(250);
      rec.current = { mr, stream };
      setPhase('recording');
    } catch (e) { setMsg(e?.name === 'NotAllowedError' ? 'Microphone blocked — allow it for this site.' : `No microphone: ${e?.message || e}`); }
  }
  const stopRec = () => rec.current?.mr.state === 'recording' && rec.current.mr.stop();

  async function score(blob) {
    setPhase('scoring');
    try {
      const buf = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await blob.arrayBuffer());
      const pcm = Float32Array.from(buf.getChannelData(0));
      if (!worker.current) worker.current = new Worker(new URL('../features/phonemeWorker.js', import.meta.url), { type: 'module' });
      const words = sent.words.map(clean).filter(Boolean);
      const out = await new Promise((resolve, reject) => {
        const id = Math.random();
        worker.current.onmessage = (e) => {
          if (e.data?.progress != null) { setMsg(`Downloading the pronunciation model (once, ~320 MB)… ${e.data.progress}%`); return; }
          if (e.data?.id !== id) return;
          if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error));
        };
        worker.current.postMessage({ id, pcm, words, lang }, [pcm.buffer]);
      });
      setRes({ ...out.result, words: out.result.words.map((w, i) => ({ ...w, text: words[i] })), heardText: out.heard });
      setMsg('');
    } catch (e) { setMsg(`Couldn’t score that: ${e?.message || e}`); }
    setPhase('idle');
  }

  const cls = (s) => (s >= 85 ? 'good' : s >= 60 ? 'ok' : 'bad');
  return (
    <Dialog title="Pronunciation check" onClose={onClose} width={640}
      buttons={<>
        {phase === 'recording'
          ? <button className="toggle-on" onClick={stopRec}>■ Stop &amp; score</button>
          : <button className="toggle-on" disabled={phase === 'scoring'} onClick={start}>● Record</button>}
        <button disabled={phase !== 'idle'} onClick={() => { setRes(null); setWi(Math.min(tab.doc.words.length - 1, sent.end + 1)); }}>Next sentence →</button>
        <button onClick={onClose}>Close</button>
      </>}>
      <p className="settings-note" style={{ marginTop: 0 }}>Press Record, read the sentence aloud, then Stop. Each word is scored by how closely your sounds matched; hover a word for the sounds expected vs heard. Runs on this device.</p>
      <p className="pron-sentence">
        {res
          ? res.words.map((w, i) => <span key={i} className={`pron-w ${cls(w.score)}`} title={`${w.score} — expected /${w.expected.join('')}/, heard /${w.heard.join('') || '—'}/`}>{w.text} </span>)
          : sent.words.join(' ')}
      </p>
      {phase === 'recording' && <p className="settings-note" role="status">● Recording… read the sentence, then press Stop.</p>}
      {phase === 'scoring' && !msg && <p className="settings-note" role="status">Listening to your sounds…</p>}
      {res && <p className="settings-note"><b>Overall {res.overall}/100</b> · words in red were furthest off — hover them to see which sounds differed.</p>}
      {msg && <p className="settings-note" role="status">{msg}</p>}
    </Dialog>
  );
}
