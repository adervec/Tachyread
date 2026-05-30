import { useState } from 'react';
import Dialog from './Dialog.jsx';

function fmtTime(secs) {
  if (!secs) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}

function Stars({ value, onChange }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? 'on' : ''}`}
          onClick={() => onChange(n === value ? 0 : n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// Shown when the reader confirms a book is finished: overall stats, a star rating, and notes.
// Saving records a completion entry plus the rating/notes onto the per-file settings.
export default function BookFinishedDialog({ tab, onPatch, onClose }) {
  const tr = tab.tracker;
  const [rating, setRating] = useState(tab.settings.rating || 0);
  const [notes, setNotes] = useState(tab.settings.notes || '');

  const coverage = tr ? tr.coverage() * 100 : 0;
  const activeSecs = tr ? Math.round(tr.lifetimeActiveMs / 1000) : 0;
  const effWpm = tr ? tr.lifetimeWpm() : 0;
  const readCount = tr ? tr.readCount : 0;
  const completions = tab.settings.completions || [];

  function save() {
    const entry = {
      date: new Date().toISOString(),
      coveragePct: Math.round(coverage),
      activeSecs,
      wpm: effWpm,
      rating,
    };
    onPatch({ rating, notes, completions: [...completions, entry] });
    onClose();
  }

  return (
    <Dialog
      title="Book Finished 🎉"
      onClose={onClose}
      width={520}
      buttons={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="toggle-on" onClick={save}>Save & mark finished</button>
        </>
      }
    >
      <div className="field-section">{tab.doc.fileName}</div>
      <table className="history-table" style={{ marginBottom: 12 }}>
        <tbody>
          <tr><td>Book read (coverage)</td><td>{coverage.toFixed(1)}% ({readCount} / {tab.doc.words.length} words)</td></tr>
          <tr><td>Total active reading time</td><td>{fmtTime(activeSecs)}</td></tr>
          <tr><td>Effective reading speed</td><td>{effWpm} WPM</td></tr>
          <tr><td>Times finished before</td><td>{completions.length}</td></tr>
        </tbody>
      </table>

      <div className="field-row">
        <label>Your rating</label>
        <Stars value={rating} onChange={setRating} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Notes / review</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          style={{ width: '100%', resize: 'vertical' }}
          placeholder="What did you think? Key takeaways, favorite parts…"
        />
      </div>
      {coverage < 90 && (
        <p className="settings-note">
          Note: you've read {coverage.toFixed(0)}% of the book by coverage. Sections you skipped
          aren't counted as read.
        </p>
      )}
    </Dialog>
  );
}
