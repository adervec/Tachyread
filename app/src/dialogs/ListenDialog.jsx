// Listen to the queue — the phone's player. Plays the listen queue from the clips the sync machine
// rendered (pulled here, or fetched from the cloud when online), so the phone needs no book files.
// Each finished passage moves the synced reading position; the last passage of a book marks it
// finished in Trackyread; both reach the other devices with the next sync (features/listenPlayer.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { t, fmtNum } from '../i18n.js';
import { playlist, bookShare } from '../features/listenPlayer.js';
import { pullWindow, LISTEN_TAG } from '../features/listenCloud.js';
import { finishBoundBook } from '../features/listenQueue.js';
import { getSyncProvider } from '../features/sync/syncProviders.js';
import { syncWithProvider, syncLibraryWithProvider } from '../features/sync/syncManager.js';
import { getSyncCache, loadFile, applySyncedPosition, getAudiobookManifest, entryClips, getAudioClipById, deleteAudioClipById } from '../state/storage.js';

const RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
const RATE_KEY = 'tachyread-listen-rate';
const readRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; } };

async function blobFor(e) {
  const m = await getAudiobookManifest(e.cs).catch(() => null);
  for (const c of entryClips(m?.lines?.[e.line])) {
    const rec = await getAudioClipById(e.cs, e.line, c.id).catch(() => null);
    if (rec?.blob) return rec.blob;
  }
  const p = getSyncProvider(); // not downloaded yet: straight from the cloud
  if (!p || !e.id) return null;
  const conn = await p.connect(null, { silent: true });
  return p.getFile(conn, e.id);
}

export default function ListenDialog({ global, onClose }) {
  const [manifest, setManifest] = useState(null);
  const [pos, setPos] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(readRate);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const audio = useRef(null);
  const lastSync = useRef(0);
  const list = useMemo(() => playlist(manifest, pos), [manifest, pos]);
  const cur = list[Math.min(idx, Math.max(0, list.length - 1))];

  async function load() {
    const m = await getSyncCache('listen');
    const p = {};
    for (const cs of Object.keys(m?.books || {})) p[cs] = (await loadFile(cs).catch(() => null))?.wordIndex || 0;
    setManifest(m); setPos(p); setIdx(0);
    if (!m) setMsg(t('Nothing downloaded yet — press “Get the latest”. The sync machine renders the queue ahead (Audio Settings → Pocket listening).'));
  }
  // Positions may have moved on another device: sync first, then build the list.
  useEffect(() => {
    (async () => {
      try { if (getSyncProvider()) await syncWithProvider(null, null, { silent: true }); } catch { /* offline: use what is here */ }
      await load();
    })();
  }, []);

  async function refresh() {
    setBusy(true); setMsg(t('Getting the latest…'));
    try {
      await syncWithProvider(null, null, { silent: false });
      const r = await pullWindow(global.sync || {}, { wifiOnly: false, onProgress: (p) => setMsg(t('downloading {done}/{total}', { done: p.got, total: p.total })) });
      setMsg(t.n('Up to date — {n} new passage downloaded.', 'Up to date — {n} new passages downloaded.', r.got));
      await load();
    } catch (e) { setMsg(t('Couldn’t get the latest: {error}', { error: e?.message || e })); }
    setBusy(false);
  }

  async function play(e = cur) {
    if (!e || !audio.current) return;
    const blob = await blobFor(e).catch(() => null);
    if (!blob) { setMsg(t('This passage isn’t on this device and the cloud can’t be reached — get the latest on Wi-Fi first.')); setPlaying(false); return; }
    const a = audio.current;
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(blob);
    a.playbackRate = rate;
    try { await a.play(); setPlaying(true); setMsg(''); } catch (err) { setPlaying(false); setMsg(String(err?.message || err)); }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: e.title, artist: e.author || 'Tachyread', album: t('Listen queue') }); } catch { /* older browsers */ }
    }
  }
  async function syncSoon(force = false) {
    if (!force && Date.now() - lastSync.current < 120_000) return;
    lastSync.current = Date.now();
    try { await syncWithProvider(null, null, { silent: true }); } catch { /* next time */ }
  }
  // A passage played to its end: move the position past it, finish the book after its last one,
  // drop downloaded passages two behind (kept a little for going back), then the next passage.
  async function ended() {
    const e = cur;
    if (!e) return;
    await applySyncedPosition(e.cs, e.endWordIndex + 1, global.deviceName || '').catch(() => {});
    const prev = list[idx - 2];
    if (prev && prev.cs === e.cs) {
      const m = await getAudiobookManifest(prev.cs).catch(() => null);
      for (const c of entryClips(m?.lines?.[prev.line])) if (c.tag === LISTEN_TAG) await deleteAudioClipById(prev.cs, prev.line, c.id).catch(() => {});
    }
    if (e.last) {
      const book = await finishBoundBook(e.cs).catch(() => null);
      setMsg(book ? t('Finished “{title}” — marked as read.', { title: e.title }) : t('Finished “{title}”.', { title: e.title }));
      try { if (getSyncProvider()) await syncLibraryWithProvider(null, null, { silent: true }); } catch { /* next sync */ }
    }
    syncSoon(e.last);
    const next = list[idx + 1];
    if (!next) { setPlaying(false); if (!e.last) setMsg(t('That was the last downloaded passage. Get the latest for more.')); syncSoon(true); return; }
    setIdx(idx + 1);
    play(next);
  }
  function step(d) {
    const i = Math.max(0, Math.min(list.length - 1, idx + d));
    setIdx(i);
    if (playing) play(list[i]);
  }
  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); syncSoon(true); } else if (a.src) { a.play(); setPlaying(true); } else play();
  }
  // Lock-screen and headphone buttons.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    const ms = navigator.mediaSession;
    const set = (k, f) => { try { ms.setActionHandler(k, f); } catch { /* unsupported action */ } };
    set('play', () => toggle()); set('pause', () => toggle());
    set('nexttrack', () => step(1)); set('previoustrack', () => step(-1));
    set('seekbackward', () => { if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 15); });
    return () => ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward'].forEach((k) => set(k, null));
  });
  useEffect(() => () => { if (audio.current?.src) URL.revokeObjectURL(audio.current.src); syncSoon(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const books = Object.entries(manifest?.books || {}).sort(([, a], [, b]) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const left = list.reduce((s, e) => s + (e.ms || 0), 0);
  return (
    <Dialog title={`🎧 ${t('Listen to the queue')}`} onClose={onClose} width={520} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      <audio ref={audio} onEnded={ended} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} preload="auto" />
      {cur ? (
        <div className="listen-now">
          <div className="listen-title"><strong>{cur.title}</strong>{cur.author ? ` · ${cur.author}` : ''}</div>
          <p className="listen-text" data-clamp="6" dir="auto">{cur.text}</p>
          <div className="data-row">
            <button onClick={() => step(-1)} disabled={idx <= 0} aria-label={t('Previous passage')}>⏮</button>
            <button className="toggle-on" onClick={toggle} aria-label={playing ? t('Pause') : t('Play')}>{playing ? '⏸' : '▶'}</button>
            <button onClick={() => step(1)} disabled={idx >= list.length - 1} aria-label={t('Next passage')}>⏭</button>
            <label>{t('Speed')}{' '}
              <select value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); if (audio.current) audio.current.playbackRate = r; try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* ignore */ } }}>
                {RATES.map((r) => <option key={r} value={r}>{fmtNum(r, 2)}×</option>)}
              </select>
            </label>
          </div>
          <p className="settings-note">{t('{n} passages · about {h} h downloaded ahead', { n: fmtNum(list.length, 0), h: fmtNum(left / 3600e3, 1, 1) })}</p>
        </div>
      ) : manifest && <p className="settings-note">{t('Nothing left to play here — get the latest.')}</p>}
      <div className="data-row">
        <button onClick={refresh} disabled={busy}>⟳ {t('Get the latest')}</button>
        {msg && <span className="settings-note" role="status" style={{ margin: 0 }}>{msg}</span>}
      </div>
      {books.length > 0 && (
        <ol className="listen-books">
          {books.map(([cs, b]) => (
            <li key={cs}>{b.title || b.fileName} <span className="settings-note">{fmtNum(bookShare(b, pos[cs]) * 100, 0)}%</span></li>
          ))}
        </ol>
      )}
      <p className="settings-note">{t('Your place moves with each passage you finish and reaches your other devices on the next sync. No book files are needed on this device.')}</p>
    </Dialog>
  );
}
