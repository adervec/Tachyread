import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { newCard, schedule, dueCards, learnedCount } from '../engine/srs.js';
import { harvestRare, contextAt } from '../engine/vocab.js';
import { importStardict, listDicts, deleteDict } from '../state/storage.js';
import { t, fmtNum } from '../i18n.js';

const GRADES = [{ g: 0, label: t('Again') }, { g: 1, label: t('Hard') }, { g: 2, label: t('Good') }, { g: 3, label: t('Easy') }];
const dictUrl = (w) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(w)}`;

// Spaced-repetition vocabulary deck. Harvests the rare words from the open document (by surprisal
// frequency) and drills them with an SM-2-style scheduler so they stop slowing your reading.
export default function VocabDialog({ doc, onClose }) {
  const { state, updateGlobal } = useApp();
  const deck = state.global.vocabDeck || [];
  const [view, setView] = useState('review'); // review | deck
  const [revealed, setRevealed] = useState(false);
  const [dicts, setDicts] = useState(null); // imported offline dictionaries (loaded when the section opens)
  const refreshDicts = () => listDicts().then(setDicts).catch(() => setDicts([]));
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
    if (deck.some((c) => c.word.toLowerCase() === w.toLowerCase())) { setMsg(t('“{word}” is already in the deck.', { word: w })); return; }
    saveDeck([...deck, newCard(w, '', Date.now())]);
    setAddWord(''); setMsg(t('Added “{word}”.', { word: w }));
  }
  function harvest() {
    const found = harvestRare(doc, deck.map((c) => c.word), 25);
    if (!found.length) { setMsg(doc ? t('No new rare words found in this document.') : t('Open a document first to harvest words.')); return; }
    saveDeck([...deck, ...found.map((f) => newCard(f.word, contextAt(doc, f.idx), Date.now()))]);
    setMsg(t.n('Added {n} rare word from this document.', 'Added {n} rare words from this document.', found.length));
  }
  function remove(word) { saveDeck(deck.filter((c) => c.word.toLowerCase() !== word.toLowerCase())); }

  return (
    <Dialog
      title={t('Vocabulary — drill the rare words you read')}
      onClose={onClose}
      buttons={<>
        <button className={view === 'review' ? 'toggle-on' : ''} onClick={() => setView('review')}>{t('Review ({n})', { n: due.length })}</button>
        <button className={view === 'deck' ? 'toggle-on' : ''} onClick={() => setView('deck')}>{t('Deck ({n})', { n: deck.length })}</button>
        <button onClick={onClose}>{t('Done')}</button>
      </>}
    >
      <div className="vocab">
        {msg && <p className="settings-note" style={{ marginTop: 0 }}>{msg}</p>}
        <details className="lj-fold vocab-dicts" onToggle={(e) => { if (e.currentTarget.open) refreshDicts(); }}>
          <summary>📚 {t('Offline dictionaries')}{dicts?.length ? ` (${dicts.length})` : ''}</summary>
          <p className="settings-note">{t('Import a StarDict dictionary (pick its .ifo, .idx and .dict or .dict.dz files together) and 📖 Define answers from it first — any language, no network.')}</p>
          <input type="file" multiple accept=".ifo,.idx,.dict,.dz" aria-label={t('StarDict files')}
            onChange={async (e) => {
              const files = [...(e.target.files || [])]; e.target.value = ''; // copy first — clearing the input empties its live FileList
              if (!files?.length) return;
              setMsg(t('Importing dictionary…'));
              try { const d = await importStardict(files); setMsg(t.n('Imported “{name}” — {count} word.', 'Imported “{name}” — {count} words.', d.wordcount, { name: d.name, count: fmtNum(d.wordcount) })); refreshDicts(); }
              catch (err) { setMsg(t('Couldn’t import: {error}', { error: err?.message || err })); }
            }} />
          {(dicts || []).map((d) => (
            <div key={d.id} className="lj-inline">
              <b>{d.name}</b> <span className="lj-qdim">{t.n('{count} word · {size} MB', '{count} words · {size} MB', d.wordcount, { count: fmtNum(d.wordcount), size: fmtNum(d.bytes / 1048576, 1, 1) })}</span>
              <button className="grab-trash" onClick={async () => { await deleteDict(d.id); refreshDicts(); }} aria-label={t('Remove {name}', { name: d.name })}>🗑</button>
            </div>
          ))}
        </details>
        {view === 'review' && (
          <div className="vocab-review">
            {!card && <div className="vocab-empty">✓ {t.n('All caught up — {n} word, {learned} learned. Add more from the Deck tab.', 'All caught up — {n} words, {learned} learned. Add more from the Deck tab.', deck.length, { learned })}</div>}
            {card && (
              <div className="vocab-card">
                <div className="vc-word">{card.word}</div>
                {!revealed
                  ? <button className="toggle-on" onClick={() => setRevealed(true)}>{t('Show meaning')}</button>
                  : (
                    <>
                      {card.context && <div className="vc-context">“…{card.context}…”</div>}
                      {card.definition && <div className="vc-def">{card.definition}</div>}
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
              <button onClick={harvest} title={t('Scan the open document for rare words and add them')}>⤓ {t('Harvest from document')}</button>
              <input value={addWord} onChange={(e) => setAddWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} placeholder={t('add a word…')} />
              <button onClick={addManual} disabled={!addWord.trim()}>{t('Add')}</button>
            </div>
            <div className="vd-summary settings-note">{t.n('{n} word · {due} due · {learned} learned', '{n} words · {due} due · {learned} learned', deck.length, { due: due.length, learned })}</div>
            <div className="vd-list">
              {deck.length === 0 && <div className="settings-note">{t('Empty — harvest rare words from a document, or add your own.')}</div>}
              {deck.map((c) => (
                <div key={c.word} className="vd-row">
                  <a href={dictUrl(c.word)} target="_blank" rel="noopener noreferrer">{c.word}</a>
                  <span className="vd-meta">{(c.due || 0) <= now ? t('due') : t('{n}d', { n: Math.max(1, Math.round(((c.due || 0) - now) / 86400000)) })}{c.reps ? ` · ${c.reps}×` : ''}</span>
                  <button className="vd-x" onClick={() => remove(c.word)} title={t('Remove')}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
