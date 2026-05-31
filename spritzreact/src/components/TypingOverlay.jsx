import { useEffect, useMemo, useRef, useState } from 'react';

// Monkeytype-style "type-along": you type the actual document text at the current reading
// position. Each completed word advances the real reading index (so it counts as read via the
// tracker) while a separate HUD tracks your typing speed + accuracy. Toggle TYPE off to "lock
// in" and resume serious reading from wherever you typed to.

function sameChar(a, b, caseSensitive) {
  return caseSensitive ? a === b : a?.toLowerCase() === b?.toLowerCase();
}

export default function TypingOverlay({ tab, onAdvance, onExit, onPatch }) {
  const { doc, settings } = tab;
  const cfg = settings.typing || {};
  const idx = settings.wordIndex;
  const word = doc.words[idx] || '';
  const inputRef = useRef(null);

  const [buf, setBuf] = useState('');
  const [, setTick] = useState(0);

  // Live, mutable session stats (don't trigger re-render on every keystroke beyond buf).
  const stats = useRef({ start: 0, typed: 0, correct: 0, errors: 0, words: 0, best: cfg.bestWpm || 0 });

  // Reset the per-word buffer whenever the active word changes (self-advance or manual jump).
  useEffect(() => {
    setBuf('');
    inputRef.current?.focus();
  }, [idx]);

  // 1s ticker for live WPM while typing.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  // Optional per-word timeout (advances if you stall).
  useEffect(() => {
    const t = cfg.perWordTimeoutMs || 0;
    if (!t) return undefined;
    const id = setTimeout(() => onAdvance(), t);
    return () => clearTimeout(id);
  }, [idx, cfg.perWordTimeoutMs, onAdvance]);

  // Persist best WPM on unmount ("locking in").
  useEffect(() => {
    return () => {
      const s = stats.current;
      const best = Math.round(s.best);
      if (best > (cfg.bestWpm || 0)) onPatch?.({ typing: { ...cfg, bestWpm: best } });
    };
    // eslint-disable-next-line
  }, []);

  function liveWpm() {
    const s = stats.current;
    if (!s.start) return 0;
    const min = (Date.now() - s.start) / 60000;
    return min > 0.02 ? Math.max(0, Math.round(s.correct / 5 / min)) : 0;
  }

  function commitWord() {
    stats.current.words += 1;
    stats.current.typed += 1; // count the space
    stats.current.correct += 1;
    const w = liveWpm();
    if (w > stats.current.best) stats.current.best = w;
    onAdvance();
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let shortcuts through
    const s = stats.current;
    if (e.key === 'Escape') {
      e.preventDefault();
      onExit?.();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (buf.length === 0) return; // ignore leading spaces
      commitWord();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      setBuf((b) => b.slice(0, -1));
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      if (!s.start) s.start = Date.now();
      const pos = buf.length;
      const target = word[pos];
      s.typed += 1;
      if (target !== undefined && sameChar(e.key, target, cfg.caseSensitive)) s.correct += 1;
      else s.errors += 1;
      setBuf((b) => b + e.key);
    }
  }

  // Render window of words around the active one.
  const windowWords = useMemo(() => {
    const start = Math.max(0, idx - 6);
    const end = Math.min(doc.words.length, idx + 60);
    return { start, end, list: doc.words.slice(start, end) };
  }, [doc, idx]);

  const s = stats.current;
  const acc = s.typed ? ((s.correct / s.typed) * 100).toFixed(1) : '100.0';

  return (
    <div className="type-along" onMouseDown={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        className="type-sink"
        autoFocus
        value=""
        onChange={() => {}}
        onKeyDown={onKeyDown}
        aria-label="Type-along input"
      />

      <div className="type-hud">
        <div className="type-stat type-stat-hero">
          <span className="type-num">{liveWpm()}</span>
          <span className="type-lbl">WPM</span>
        </div>
        <div className="type-stat">
          <span className="type-num">{acc}%</span>
          <span className="type-lbl">accuracy</span>
        </div>
        <div className="type-stat">
          <span className="type-num">{s.words}</span>
          <span className="type-lbl">words</span>
        </div>
        <div className="type-stat">
          <span className="type-num">{Math.round(s.best)}</span>
          <span className="type-lbl">best</span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="type-lock" onClick={() => onExit?.()} title="Lock in and read seriously (Esc)">
          🔒 Lock in & read
        </button>
      </div>

      <div className="type-text">
        {windowWords.list.map((w, k) => {
          const gi = windowWords.start + k;
          if (gi < idx) return <span key={gi} className="tw done">{w} </span>;
          if (gi > idx) return <span key={gi} className="tw pending">{w} </span>;
          // active word — per-character coloring + caret
          const len = Math.max(w.length, buf.length);
          const chars = [];
          for (let i = 0; i < len; i++) {
            if (i === buf.length) chars.push(<span key={`c${i}`} className="caret" />);
            const typed = i < buf.length;
            const cls = !typed
              ? 'tc pending'
              : i >= w.length
              ? 'tc wrong'
              : sameChar(buf[i], w[i], cfg.caseSensitive)
              ? 'tc correct'
              : 'tc wrong';
            chars.push(
              <span key={i} className={cls}>
                {i >= w.length ? buf[i] : w[i]}
              </span>
            );
          }
          if (buf.length >= len) chars.push(<span key="cend" className="caret" />);
          return (
            <span key={gi} className="tw active">
              {chars}{' '}
            </span>
          );
        })}
      </div>

      <div className="type-hint">Type the highlighted text · Space = next word · Esc = lock in</div>
    </div>
  );
}
