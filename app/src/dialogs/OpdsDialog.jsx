import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { DEFAULT_CATALOGS, parseOpds, searchTemplate, fillSearch, fileNameFor } from '../features/opds.js';

// File → Browse Online Catalogs: OPDS catalogues (Project Gutenberg built in; add Calibre-web,
// Komga, …). Navigate, search, and Open a book straight into a tab — or, when the server doesn't let
// browsers download its files (Gutenberg's case), Download it and drop the file in.
export default function OpdsDialog({ onClose }) {
  const { state, updateGlobal, openFiles } = useApp();
  const catalogs = state.global.opdsCatalogs?.length ? state.global.opdsCatalogs : DEFAULT_CATALOGS;
  const [stack, setStack] = useState([]); // feed URLs visited (last = current)
  const [feed, setFeed] = useState(null);
  const [tpl, setTpl] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState({ name: '', url: '' });
  const cur = stack[stack.length - 1];

  useEffect(() => {
    if (!cur) { setFeed(null); return undefined; }
    let dead = false;
    setBusy(true); setMsg('');
    (async () => {
      try {
        const r = await fetch(cur);
        if (!r.ok) throw new Error(`The catalogue answered HTTP ${r.status}${r.status === 401 ? ' (it needs a login, which isn’t supported here)' : ''}.`);
        const f = parseOpds(await r.text(), cur);
        if (dead) return;
        setFeed(f);
        setTpl(await searchTemplate(f.search, cur).catch(() => ''));
      } catch (e) {
        if (!dead) setMsg(e instanceof TypeError ? 'That catalogue doesn’t let browsers read it (no CORS) — it can only be used from an e-reader app.' : String(e?.message || e));
      }
      if (!dead) setBusy(false);
    })();
    return () => { dead = true; };
  }, [cur]);

  async function openBook(e) {
    setMsg(`Fetching “${e.title}”…`);
    try {
      const r = await fetch(e.acq.href);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      await openFiles([new File([blob], fileNameFor(e.title, e.acq), { type: e.acq.type.split(';')[0] })]);
      onClose();
    } catch (err) {
      setMsg(err instanceof TypeError
        ? `This catalogue doesn’t let browsers download its files directly — use ⬇ Download, then drop the file into Tachyread.`
        : `Couldn’t open it: ${err?.message || err}`);
    }
  }
  const saveCatalogs = (list) => updateGlobal({ opdsCatalogs: list });

  return (
    <Dialog title="Online catalogs (OPDS)" onClose={onClose} width={760}>
      {!cur ? (
        <div className="opds">
          <p className="settings-note">Browse free and personal book catalogues that publish OPDS. Project Gutenberg is built in; add your own Calibre-web / Komga address if it allows browser access (CORS).</p>
          {catalogs.map((c, i) => (
            <div key={c.url} className="lj-inline">
              <button className="toggle-on" onClick={() => setStack([c.url])}>{c.name}</button>
              <span className="lj-qdim">{c.url}</span>
              {state.global.opdsCatalogs?.length > 0 && <button className="grab-trash" aria-label={`Remove ${c.name}`} onClick={() => saveCatalogs(catalogs.filter((_, j) => j !== i))}>🗑</button>}
            </div>
          ))}
          <form className="lj-inline" onSubmit={(ev) => { ev.preventDefault(); if (!/^https?:\/\//.test(adding.url)) return; saveCatalogs([...catalogs, { name: adding.name.trim() || new URL(adding.url).hostname, url: adding.url.trim() }]); setAdding({ name: '', url: '' }); }}>
            <input value={adding.name} onChange={(ev) => setAdding({ ...adding, name: ev.target.value })} placeholder="Name" aria-label="Catalogue name" />
            <input value={adding.url} onChange={(ev) => setAdding({ ...adding, url: ev.target.value })} placeholder="https://…/opds" aria-label="Catalogue address" style={{ flex: 1 }} />
            <button type="submit" disabled={!/^https?:\/\//.test(adding.url)}>＋ Add catalogue</button>
          </form>
        </div>
      ) : (
        <div className="opds">
          <div className="lj-inline">
            <button onClick={() => setStack(stack.slice(0, -1))}>← Back</button>
            <b>{feed?.title || '…'}</b>
            {tpl && (
              <form className="lj-inline" onSubmit={(ev) => { ev.preventDefault(); if (q.trim()) setStack([...stack, fillSearch(tpl, q.trim())]); }} style={{ marginLeft: 'auto' }}>
                <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search this catalogue" aria-label="Search this catalogue" />
                <button type="submit" disabled={!q.trim()}>Search</button>
              </form>
            )}
          </div>
          {msg && <p className="settings-note" role="status">{msg}</p>}
          {busy && <p className="settings-note">Loading…</p>}
          <div className="opds-list">
            {feed?.entries.map((e, i) => (
              <div key={i} className="opds-entry">
                {e.thumb && <img src={e.thumb} alt="" loading="lazy" />}
                <div className="opds-meta">
                  <div><b>{e.title}</b>{e.author && <span className="lj-qdim"> — {e.author}</span>}</div>
                  {e.summary && <div className="lj-qdim opds-sum">{e.summary}</div>}
                </div>
                <div className="opds-acts">
                  {e.nav && !e.acq && <button onClick={() => setStack([...stack, e.nav.href])}>Open ›</button>}
                  {e.acq && <button className="toggle-on" onClick={() => openBook(e)} title="Read it here now">📖 Open</button>}
                  {e.acq && <a className="link-btn" href={e.acq.href} target="_blank" rel="noreferrer noopener" download title="Download the file, then drop it into Tachyread">⬇ Download</a>}
                  {!e.acq && !e.nav && e.title && <span className="lj-qdim">—</span>}
                </div>
              </div>
            ))}
          </div>
          {feed?.next && <button onClick={() => setStack([...stack.slice(0, -1), feed.next])}>More ›</button>}
        </div>
      )}
    </Dialog>
  );
}
