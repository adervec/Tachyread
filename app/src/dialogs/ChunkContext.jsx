import { useEffect, useRef, useState } from 'react';

// The chunk you are narrating with the FULL text of the chunks around it in book order, so you can
// read into and out of it naturally. `n` = chunks shown on each side (0 = just a two-line peek at
// the immediate neighbours, the old behaviour). The choice is remembered per device.
const KEY = 'tachyread-narrate-context';
export function useContextSize() {
  const [n, setN] = useState(() => { try { return Number(localStorage.getItem(KEY) ?? 1) || 0; } catch { return 1; } });
  const set = (v) => { setN(v); try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ } };
  return [n, set];
}

export function ContextPicker({ n, onChange }) {
  return (
    <label className="ck-pick">
      Context
      <select value={n} onChange={(e) => onChange(Number(e.target.value))} aria-label="Neighbouring chunks to show">
        <option value={0}>peek</option>
        <option value={1}>1 chunk each side</option>
        <option value={2}>2 chunks each side</option>
        <option value={3}>3 chunks each side</option>
      </select>
    </label>
  );
}

export default function ChunkContext({ chunks, chunk, n, className = '', currentClass = '', dim = false }) {
  // Keep the chunk being read in view inside the scroll box as you move through the book.
  const cur = useRef(null);
  useEffect(() => { cur.current?.scrollIntoView?.({ block: 'nearest' }); }, [chunk, n]);
  const i = chunks ? chunks.findIndex((c) => c.startLine === chunk.startLine) : -1;
  const before = i < 0 ? [] : chunks.slice(Math.max(0, i - Math.max(1, n)), i);
  const after = i < 0 ? [] : chunks.slice(i + 1, i + 1 + Math.max(1, n));
  const side = (c, cls) => <div key={c.startLine} className={`ck-side ${cls}${n === 0 ? ' peek' : ''}`}>{c.text}</div>;
  return (
    <div className={`ck-wrap ${className}`}>
      {before.map((c) => side(c, 'before'))}
      <div ref={cur} className={`ck-current ${currentClass}${dim ? ' dim' : ''}`}>{chunk.text}</div>
      {after.map((c) => side(c, 'after'))}
    </div>
  );
}
