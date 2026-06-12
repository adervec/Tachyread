import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { newCard, schedule, dueCards, learnedCount } from '../engine/srs.js';
import { harvestRare, contextAt } from '../engine/vocab.js';

const GRADES = [{ g: 0, label: 'Again' }, { g: 1, label: 'Hard' }, { g: 2, label: 'Good' }, { g: 3, label: 'Easy' }];
const dictUrl = (w) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(w)}`;

// Spaced-repetition vocabulary deck. Harvests the rare words from the open document (by surprisal
// frequency) and drills them with an SM-2-style scheduler so they stop slowing your reading.
export default function VocabDialog({ doc, onClose }) {
  const { state, updateGlobal } = useApp();
  const deck = state.global.vocabDeck || [];
  const [view, setView] = useState('review'); // review | deck
  const [revealed, setRevealed] = useState(false);
  const [addWord, setAddWord] = useState('');
  const [msg, setMsg] = useState('');

  const now = Date.now();
  const due = dueCards(deck, now);
  const card = due[0] || null;
  const learned = learnedCount(deck);
  const saveDeck = (next) => updateGlobal({ vocabDeck: next });

  function grade(g) {
    if (!card) return;
    const updated = schedule(card, g, Date.now());
    saveDeck(deck.map((c) => (c.word.toLowerCase() === card.word.toLowerCase() ? updated : c)));
    setRevealed(false);
  }
  function addManual() {
    const w = addWord.trim();
    if (!w) return;
    if (deck.some((c) => c.word.toLowerCase() === w.toLowerCase())) { setMsg(`“${w}” is already in the deck.`); return; }
    saveDeck([...deck, newCard(w, '', Date.now())]);
    setAddWord(''); setMsg(`Added “${w}”.`);
  }
  function harvest() {
    const found = harvestRare(doc, deck.map((c) => c.word), 25);
    if (!found.length) { setMsg(doc ? 'No new rare words found in this document.' : 'Open a document first to harvest words.'); return; }
    saveDeck([...deck, ...found.map((f) => newCard(f.word, contextAt(doc, f.idx), Date.now()))]);
    setMsg(`Added ${found.length} rare word(s) from this document.`);
  }
  function remove(word) { saveDeck(deck.filter((c) => c.word.toLowerCase() !== word.toLowerCase())); }

  return (
    <Dialog
      title="Vocabulary — drill the rare words you read"
      onClose={onClose}
      buttons={<>
        <button className={view === 'review' ? 'toggle-on' : ''} onClick={() => setView('review')}>Review ({due.length})</button>
        <button className={view === 'deck' ? 'toggle-on' : ''} onClick={() => setView('deck')}>Deck ({deck.length})</button>
        <button onClick={onClose}>Done</button>
      </>}
    >
      <div className="vocab">
        {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}
        {view === 'review' && (
          <div className="vocab-review">
            {!card && <div className="vocab-empty">✓ All caught up — {deck.length} word(s), {learned} learned. Add more from the Deck tab.</div>}
            {card && (
              <div className="vocab-card">
                <div className="vc-word">{card.word}</div>
                {!revealed
                  ? <button className="toggle-on" onClick={() => setRevealed(true)}>Show meaning</button>
                  : (
                    <>
                      {card.context && <div className="vc-context">“…{card.context}…”</div>}
                      <a className="vc-dict" href={dictUrl(card.word)} target="_blank" rel="noopener noreferrer">Merriam-Webster ↗</a>
                      <div className="vc-grades">
                        {GRADES.map(({ g, label }) => <button key={g} className={`vc-grade g${g}`} onClick={() => grade(g)}>{label}</button>)}
                      </div>
                    </>
                  )}
              </div>
            )}
          </div>
        )}
        {view === 'deck' && (
          <div className="vocab-deck">
            <div className="vd-actions">
              <button onClick={harvest} title="Scan the open document for rare words and add them">⤓ Harvest from document</button>
              <input value={addWord} onChange={(e) => setAddWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} placeholder="add a word…" />
              <button onClick={addManual} disabled={!addWord.trim()}>Add</button>
            </div>
            <div className="vd-summary settings-note">{deck.length} word(s) · {due.length} due · {learned} learned</div>
            <div className="vd-list">
              {deck.length === 0 && <div className="settings-note">Empty — harvest rare words from a document, or add your own.</div>}
              {deck.map((c) => (
                <div key={c.word} className="vd-row">
                  <a href={dictUrl(c.word)} target="_blank" rel="noopener noreferrer">{c.word}</a>
                  <span className="vd-meta">{(c.due || 0) <= now ? 'due' : `${Math.max(1, Math.round(((c.due || 0) - now) / 86400000))}d`}{c.reps ? ` · ${c.reps}×` : ''}</span>
                  <button className="vd-x" onClick={() => remove(c.word)} title="Remove">×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
