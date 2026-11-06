import { useEffect, useState } from 'react';
import { lookupWord, glossOf } from '../features/dictionary.js';
import { newCard } from '../engine/srs.js';
import { useApp } from '../state/AppContext.jsx';

// 📖 Define: definitions (English) + a Wikipedia summary for one word, with ＋ Add to Vocabulary
// (the word, its sentence from the book, and a short gloss go on a spaced-repetition card).
export default function DefinePopup({ at, onClose }) {
  const { state, updateGlobal } = useApp();
  const [res, setRes] = useState(null);
  const lang = (state.global.language || 'en').slice(0, 2);
  useEffect(() => {
    let dead = false;
    lookupWord(at.word, lang).then((r) => { if (!dead) setRes(r); });
    return () => { dead = true; };
  }, [at.word, lang]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const deck = state.global.vocabDeck || [];
  const word = res?.word || at.word;
  const inDeck = deck.some((c) => String(c.word).toLowerCase() === word.toLowerCase());
  const add = () => updateGlobal({ vocabDeck: [...deck, { ...newCard(word, at.context || '', Date.now()), definition: res ? glossOf(res.senses) || res.wiki?.extract?.slice(0, 300) || '' : '' }] });
  const style = { left: Math.min(at.x, window.innerWidth - 360), top: Math.min(at.y, window.innerHeight - 320) };
  return (
    <>
      <div className="define-backdrop" onClick={onClose} />
      <div className="define-pop" style={style} role="dialog" aria-label={`Definition of ${word}`}>
        <div className="define-head">
          <b>{word}</b>{res?.phonetic && <span className="lj-qdim"> {res.phonetic}</span>}
          <button className="link-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {!res && <p className="settings-note">Looking up…</p>}
        {res && !res.senses.length && !res.wiki && <p className="settings-note">No definition found{lang !== 'en' ? ' (dictionary definitions are English-only; Wikipedia had nothing either)' : ''}.</p>}
        {res?.senses.map((s) => (
          <div key={s.pos} className="define-sense">
            <i>{s.pos}</i>
            <ol>{s.defs.map((d, i) => <li key={i}>{d.def}{d.example && <span className="lj-qdim"> — “{d.example}”</span>}</li>)}</ol>
          </div>
        ))}
        {res?.wiki && (
          <div className="define-wiki">
            <span className="lj-qdim">Wikipedia · {res.wiki.title}</span>
            <p>{res.wiki.extract.length > 320 ? `${res.wiki.extract.slice(0, 320)}…` : res.wiki.extract}</p>
          </div>
        )}
        <div className="lj-inline">
          <button className="toggle-on" disabled={inDeck || !res} onClick={add} title="Add this word (with its sentence from the book) to your spaced-repetition Vocabulary deck">{inDeck ? '✓ In Vocabulary' : '＋ Add to Vocabulary'}</button>
          {res?.wiki?.url && <a className="link-btn" href={res.wiki.url} target="_blank" rel="noreferrer noopener">Wikipedia ↗</a>}
        </div>
      </div>
    </>
  );
}
