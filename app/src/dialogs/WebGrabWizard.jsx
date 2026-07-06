import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { useApp } from '../state/AppContext.jsx';
import { docFromWebContent } from '../document/parsers.js';
import { normalizeUrl, proxyUrl, isHtmlContentType } from '../features/webGrab.js';

// Grab a web page's readable text into a reading tab. A browser can't read most cross-origin pages
// directly (same-origin policy), so this offers three paths, cleanest-first: a direct fetch (works
// for CORS-friendly sites), an opt-in reader service that relays the page (discloses the URL to a
// third party), and a fully-local manual paste (open the page yourself, copy it, paste it here).
export default function WebGrabWizard({ onClose }) {
  const { openDoc, setStatus } = useApp();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [blocked, setBlocked] = useState(false); // direct fetch failed → reveal fallbacks
  const [paste, setPaste] = useState('');

  async function open(content, opts) {
    const doc = await docFromWebContent(content, opts);
    if (!doc.words?.length) { setMsg('That page had no readable text to extract.'); setBusy(false); return; }
    await openDoc(doc);
    setStatus(`Opened “${doc.fileName}” from the web.`);
    onClose();
  }

  async function fetchDirect() {
    const u = normalizeUrl(url);
    if (!u) { setMsg('Enter a full web address, e.g. https://example.com/article'); return; }
    setBusy(true); setMsg('Fetching…'); setBlocked(false);
    try {
      const res = await fetch(u, { redirect: 'follow' });
      if (!res.ok) throw new Error(`The site returned ${res.status}.`);
      const body = await res.text();
      await open(body, { url: u, asHtml: isHtmlContentType(res.headers.get('content-type')) || null });
    } catch (e) {
      setBusy(false);
      setBlocked(true);
      setMsg(`Couldn’t read that page directly — your browser blocks reading most other sites (cross-site protection). ${/Failed to fetch/.test(e?.message || '') ? '' : e.message}`);
    }
  }

  async function fetchViaReader() {
    const u = normalizeUrl(url);
    if (!u) { setMsg('Enter a valid URL first.'); return; }
    setBusy(true); setMsg('Fetching via reader service…');
    try {
      const res = await fetch(proxyUrl(u));
      if (!res.ok) throw new Error(`Reader service returned ${res.status}.`);
      const body = await res.text();
      if (!body.trim()) throw new Error('The reader service returned an empty page.');
      await open(body, { url: u, asHtml: true });
    } catch (e) {
      setBusy(false);
      setMsg(`Reader service failed (${e.message}). Try the manual paste below — it always works.`);
    }
  }

  async function openPasted() {
    if (!paste.trim()) { setMsg('Paste the page’s text (or HTML) into the box first.'); return; }
    setBusy(true); setMsg('Building document…');
    try {
      await open(paste, { url: normalizeUrl(url) });
    } catch (e) {
      setBusy(false);
      setMsg('Could not build a document: ' + (e?.message || e));
    }
  }

  return (
    <Dialog
      title="Grab text from a web page"
      onClose={onClose}
      width={600}
      buttons={<button onClick={onClose}>Close</button>}
    >
      <div className="field-row">
        <label>Page URL</label>
        <input
          type="url"
          autoFocus
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setBlocked(false); }}
          onKeyDown={(e) => e.key === 'Enter' && !busy && fetchDirect()}
          style={{ flex: 1 }}
        />
      </div>
      <div className="data-row">
        <button className="toggle-on" onClick={fetchDirect} disabled={busy || !url.trim()}>Fetch page ▸</button>
        {busy && <span className="settings-note" style={{ margin: 0 }}>Working…</span>}
      </div>
      {msg && <p className="settings-note" style={{ marginTop: 4 }}>{msg}</p>}

      {blocked && (
        <div className="wg-fallback">
          <div className="field-section">Site blocked the direct read — two ways around it</div>
          <div className="data-row">
            <button onClick={fetchViaReader} disabled={busy}>Use reader service ▸</button>
            <span className="settings-note" style={{ margin: 0 }}>
              Relays the page via a third party (api.allorigins.win) — your URL is sent there.
            </span>
          </div>
        </div>
      )}

      <div className="field-section">Or paste the page yourself (stays on this device)</div>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Open the page in your browser, select all (Ctrl/⌘+A) and copy (Ctrl/⌘+C), then paste below.
        Pasting the page’s HTML source works too and keeps the original layout in the Source view.
      </p>
      <textarea
        className="data-json"
        rows={6}
        placeholder="Paste the copied page text or HTML here…"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
      />
      <div className="data-row">
        <button className="toggle-on" onClick={openPasted} disabled={busy || !paste.trim()}>Open pasted content ▸</button>
      </div>
    </Dialog>
  );
}
