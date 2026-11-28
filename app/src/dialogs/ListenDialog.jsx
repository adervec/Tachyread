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
import { getSyncCache, loadFile, applySyncedPosition, getAudiobookManifest, entryClips, getAudioClipById, deleteAudioClipById, getJourneyAi, saveJourneyAi, getDeviceId, getLibraryRef } from '../state/storage.js';
import { syncRole } from '../features/coworkActions.js';
import { liveQueues } from '../features/readingQueues.js';
import { listenQueueIds } from '../features/listenWindow.js';
import { KOKORO_VOICES, kokoroLabel } from '../features/localTts.js';
import { listenStatus, onListenStatus, runListenNow, stopListenRun, refreshListenReport } from '../features/listenAgent.js';
import { fmtDateTime } from '../features/dateFmt.js';
import { deviceKind, useIsCompact } from '../state/device.js';

// Everything the computer needs to prepare the phone's audio, in one place (it used to be spread over
// Audio Settings, the TTS controls and Trackyread's AI page): signed in, the sync machine, a voice,
// a queue, rendering on. The agent (features/listenAgent.js) does the rest every 10 minutes.
// What the last run did, kept across reloads: when, what it said, and per queued book how many of
// the passages ahead have audio here and in the cloud, plus the books it left out and why.
// i18n-keys: finished — skipped | its text isn’t on this computer — open the book here once
const WHY = { finished: 'finished — skipped', 'no-text': 'its text isn’t on this computer — open the book here once' };
// Durations and sizes as the reader sees them.
const dur = (ms) => (ms > 0 && ms < 60e3 ? t('under 1 min') : ms < 3600e3 ? t('{m} min', { m: fmtNum(Math.round(ms / 60e3), 0) }) : t('{h} h', { h: fmtNum(ms / 3600e3, 1, 1) }));
const mb = (bytes) => t('{mb} MB', { mb: fmtNum(bytes / 1e6, bytes < 10e6 ? 1 : 0) });
const pct = (x) => `${fmtNum(x * 100, 0)}%`;
const cell = (n, ms) => (n ? `${fmtNum(n, 0)} · ${dur(ms)}` : '—');

function RunReport({ ls, ready }) {
  const r = ls.report;
  const books = r?.books || [];
  const tot = (k) => books.reduce((x, b) => x + (b[k] || 0), 0);
  const ahead = books.filter((b) => b.inWindow), later = books.filter((b) => !b.inWindow);
  const queues = [...new Set(ahead.map((b) => b.queue))];
  const todo = tot('inWindow') - tot('rendered');
  return (
    <div className="listen-report" role="status">
      <h4>{t('What is prepared for your phone')}</h4>
      {ahead.length > 0 && (
        <>
          <p className="settings-note">{t('The phone’s Listen player plays this: from your place in each book, the next {n} hours of every chosen queue, read by {voice}. Passages you have heard are removed, and new ones are prepared every 10 minutes while Tachyread is open on this device.', { n: fmtNum(r.hours, 0), voice: r.voice || '?' })}</p>
          <progress className="listen-progress" value={tot('cloudMs')} max={tot('windowMs') || 1} aria-label={t('In the cloud')} />
          <ul className="listen-totals">
            <li><strong>{t('In the cloud, ready for the phone: {have} of {want}', { have: dur(tot('cloudMs')), want: dur(tot('windowMs')) })}</strong>
              {' · '}{t('{used} of the {cap} GB allowed', { used: mb(tot('cloudBytes')), cap: fmtNum(r.capBytes / 1e9, 2) })}</li>
            <li>{t('Prepared on this device: {have} of {want}', { have: dur(tot('renderedMs')), want: dur(tot('windowMs')) })}</li>
            <li>{todo > 0 ? t('Still to prepare: {n} passages, about {d} of listening', { n: fmtNum(todo, 0), d: dur(tot('windowMs') - tot('renderedMs')) }) : t('Everything in the window is prepared.')}</li>
          </ul>
          <div className="listen-scroll">
            <table className="listen-table">
              <thead><tr><th>{t('Book')}</th><th>{t('Covers')}</th><th>{t('Coming up')}</th><th>{t('Prepared here')}</th><th>{t('In the cloud')}</th></tr></thead>
              {queues.map((q) => (
                <tbody key={q}>
                  <tr className="listen-q"><th colSpan={5} scope="rowgroup">{t('Queue: {name}', { name: q || '?' })}</th></tr>
                  {ahead.filter((b) => b.queue === q).map((b) => (
                    <tr key={b.title}>
                      <td>{b.title}</td>
                      <td>{t('{from} to {to}', { from: pct(b.from), to: pct(b.to ?? b.from) })}</td>
                      <td>{cell(b.inWindow, b.windowMs)}</td>
                      <td>{cell(b.rendered, b.renderedMs)}</td>
                      <td>{cell(b.inCloud, b.cloudMs)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot><tr><th scope="row">{t('Total')}</th><td /><td>{cell(tot('inWindow'), tot('windowMs'))}</td><td>{cell(tot('rendered'), tot('renderedMs'))}</td><td>{cell(tot('inCloud'), tot('cloudMs'))}</td></tr></tfoot>
            </table>
          </div>
          <p className="settings-note">{t('Covers: the part of the book this audio spans. The other columns: passages · listening time; times for passages not prepared yet are estimates.')}</p>
        </>
      )}
      {later.length > 0 && <p className="settings-note">{t('Later in the queues, beyond the next {n} hours: {titles}', { n: fmtNum(r.hours, 0), titles: later.map((b) => b.title).join(' · ') })}</p>}
      {r?.skipped?.length > 0 && (
        <>
          <p className="settings-note">{t('Left out:')}</p>
          <ul className="listen-skipped">{r.skipped.map((b) => <li key={b.title}>{b.title}{b.queue ? ` (${b.queue})` : ''} — {t(WHY[b.why] || b.why)}</li>)}</ul>
        </>
      )}
      <p className="settings-note">
        {ls.busy ? '⏳ ' : r && !r.ok ? '⚠ ' : ''}{ls.busy ? ls.text : t('Last run: {text}', { text: ls.text })}{!ls.busy && ls.at ? ` · ${fmtDateTime(ls.at)}` : ''}{' '}
        {ls.busy ? <button onClick={stopListenRun}>■ {t('Stop')}</button>
          : <button disabled={!ready} onClick={() => runListenNow()} title={ready ? undefined : t('Finish the checklist first')}>▶ {t('Run now')}</button>}
      </p>
    </div>
  );
}

function PrepareCard({ global, onPatchGlobal, fold }) {
  const [signed, setSigned] = useState(false);
  const [role, setRole] = useState(null);
  const [queues, setQueues] = useState([]);
  const [ls, setLs] = useState(listenStatus());
  const cloud = typeof window !== 'undefined' ? window.appFont?.cloud : null;
  const loadRole = () => getJourneyAi().then((ai) => setRole(syncRole(ai, getDeviceId()))).catch(() => {});
  useEffect(() => {
    loadRole();
    getLibraryRef('queues').then((q) => setQueues(liveQueues(q || []))).catch(() => {});
    cloud?.signIn({ silent: true }).then(() => setSigned(true), () => setSigned(!!cloud?.signedIn()));
    return onListenStatus(setLs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function designate() {
    const ai = await getJourneyAi().catch(() => null);
    await saveJourneyAi({ ...(ai || {}), syncMachine: { deviceId: getDeviceId(), name: (global.deviceName || '').trim() || deviceKind(), at: Date.now() } });
    loadRole();
  }
  const machine = role?.role === 'machine';
  const qids = listenQueueIds(global);
  const ready = signed && machine && global.kokoroLive && qids.length > 0 && global.listenRender;
  // Show what is prepared without waiting for a run, and again when a choice changes.
  const qkey = qids.join();
  useEffect(() => {
    const id = setTimeout(() => refreshListenReport().catch(() => {}), 400);
    return () => clearTimeout(id);
  }, [qkey, global.listenHours, global.listenCapGb, global.kokoroLive]);
  const mark = (ok) => <span aria-hidden="true">{ok ? '✅' : '⬜'}</span>;
  return (
    <>
    <details className="listen-prep" open={(!ready && !fold) || undefined}>
      <summary>{ready ? `✅ ${t('This device prepares the audio for your phone')}` : `📦 ${t('Prepare audio for your phone on this device')}`}</summary>
      <ol className="listen-steps">
        <li>{mark(signed)} {t('Signed in to your cloud')}
          {!signed && <button onClick={() => cloud?.signIn({}).then(() => setSigned(true), () => {})}>☁ {t('Sign in')}</button>}</li>
        <li>{mark(machine)} {machine ? t('This is the sync machine') : role?.role === 'viewer'
          ? t('The sync machine is “{name}”', { name: role.machine?.name || '?' }) : t('No sync machine chosen yet')}
          {!machine && <button onClick={designate}>{t('Make this the sync machine')}</button>}</li>
        <li>{mark(!!global.kokoroLive)} <label>{t('Voice')}{' '}
          <select value={global.kokoroLive || ''} onChange={(e) => onPatchGlobal({ kokoroLive: e.target.value })}>
            <option value="">{t('— pick a voice —')}</option>
            {KOKORO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select></label></li>
        <li role="group" aria-label={t('Queues')}>{mark(qids.length > 0)} {t('Queues')}
          {queues.map((q) => (
            <label key={q.id} className="inline-check"><input type="checkbox" checked={qids.includes(q.id)}
              onChange={(e) => onPatchGlobal({ listenQueues: e.target.checked ? [...qids, q.id] : qids.filter((x) => x !== q.id) })} /> {q.name}</label>
          ))}
          {!queues.length && <span className="settings-note">{t('No queues yet — make one in the Library.')}</span>}</li>
        <li>{mark(!!global.listenRender)} <label className="inline-check"><input type="checkbox" checked={!!global.listenRender}
          onChange={(e) => { onPatchGlobal({ listenRender: e.target.checked }); if (e.target.checked) setTimeout(() => runListenNow(), 300); }} /> {t('Render the next {n} hours of each queue and upload them', { n: global.listenHours ?? 20 })}</label></li>
        <li><label>{t('Hours ahead')}{' '}
          <input type="number" min={1} max={48} value={global.listenHours ?? 20} onChange={(e) => onPatchGlobal({ listenHours: Math.max(1, Math.min(48, Number(e.target.value) || 20)) })} style={{ width: 70 }} /></label>
          <label>{t('Cloud cap')}{' '}
          <input type="number" min={0.25} max={10} step={0.25} value={global.listenCapGb ?? 1} onChange={(e) => onPatchGlobal({ listenCapGb: Math.max(0.25, Math.min(10, Number(e.target.value) || 1)) })} style={{ width: 70 }} /> GB</label></li>
      </ol>
      <p className="settings-note">{t('On the phone: open this same window and press “Get the latest”, or tick “Pull audio here” there to download over Wi-Fi in the background.')}</p>
    </details>
    {(global.listenRender || ls.report?.books?.length > 0) && <RunReport ls={ls} ready={ready} />}
    </>
  );
}

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

export default function ListenDialog({ global, onPatchGlobal, onClose }) {
  const compact = useIsCompact();
  // The clips are Ogg Opus; a browser that can't play that (older iPhone Safari) is told so up front.
  const [canPlay] = useState(() => { try { return !!document.createElement('audio').canPlayType('audio/ogg; codecs=opus'); } catch { return true; } });
  const [manifest, setManifest] = useState(null);
  const [pos, setPos] = useState({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(readRate);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const audio = useRef(null);
  const lastSync = useRef(0);
  const [queue, setQueue] = useState(''); // ponytail: not remembered between openings; store it if that annoys
  const [have, setHave] = useState({}); // { [cs]: Set of passage lines downloaded on this device }
  const full = useMemo(() => playlist(manifest, pos), [manifest, pos]);
  const list = useMemo(() => full.filter((e) => !queue || e.queue === queue), [full, queue]);
  const cur = list[Math.min(idx, Math.max(0, list.length - 1))];

  async function load() {
    const m = await getSyncCache('listen');
    const p = {};
    for (const cs of Object.keys(m?.books || {})) p[cs] = (await loadFile(cs).catch(() => null))?.wordIndex || 0;
    const h = {};
    for (const cs of Object.keys(m?.books || {})) {
      const am = await getAudiobookManifest(cs).catch(() => null);
      h[cs] = new Set(Object.keys(am?.lines || {}).filter((l) => entryClips(am.lines[l]).length).map(Number));
    }
    setManifest(m); setPos(p); setHave(h); setIdx(0);
    if (m) setMsg('');
    else setMsg(global.listenRender ? t('Nothing to play on this device yet.') : t('Nothing downloaded yet — press “Get the latest”. Your computer prepares the audio: on it, open this window and follow “Prepare audio for your phone”.'));
  }
  // Positions may have moved on another device: sync first, then build the list.
  useEffect(() => {
    (async () => {
      try { if (getSyncProvider()) await syncWithProvider(null, null, { silent: true }); } catch { /* offline: use what is here */ }
      await load();
    })();
    // A run that just finished (here) may have changed what is in the cloud: show it.
    let wasBusy = listenStatus().busy;
    return onListenStatus((st) => { if (wasBusy && !st.busy) load(); wasBusy = st.busy; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setBusy(true); setMsg(t('Getting the latest…'));
    try {
      await syncWithProvider(null, null, { silent: false });
      const r = await pullWindow(global.sync || {}, { wifiOnly: false, onProgress: (p) => setMsg(t('downloading {done}/{total}', { done: p.got, total: p.total })) });
      await load();
      setMsg(t.n('Up to date — {n} new passage downloaded.', 'Up to date — {n} new passages downloaded.', r.got));
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
    try { await a.play(); setPlaying(true); setMsg(''); } catch (err) {
      setPlaying(false);
      setMsg(err?.name === 'NotSupportedError' ? t('This browser can’t play the audio format (Ogg Opus).') : err?.name === 'NotAllowedError' ? t('Tap ▶ to start playing.') : String(err?.message || err));
    }
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
  const qnames = [...new Set(books.map(([, b]) => b.queue || ''))].filter(Boolean);
  // Per book: what is ahead in the cloud, and how much of it is already on this device.
  const rows = books.filter(([, b]) => !queue || b.queue === queue).map(([cs, b]) => {
    const mine = full.filter((e) => e.cs === cs), here = mine.filter((e) => have[cs]?.has(e.line));
    const sum = (a, k) => a.reduce((x, e) => x + (e[k] || 0), 0);
    return { cs, title: b.title || b.fileName, queue: b.queue || '', at: bookShare(b, pos[cs]), n: mine.length, ms: sum(mine, 'ms'), bytes: sum(mine, 'bytes'), hereN: here.length, hereMs: sum(here, 'ms'), hereBytes: sum(here, 'bytes') };
  });
  const tot = (k) => rows.reduce((x, r) => x + r[k], 0);
  const onMachine = global.listenRender && !compact;
  const prep = onPatchGlobal && <PrepareCard global={global} onPatchGlobal={onPatchGlobal} fold={compact} />;
  return (
    <Dialog title={`🎧 ${t('Listen to the queue')}`} onClose={onClose} width={720} buttons={<button onClick={onClose}>{t('Close')}</button>}>
      {!compact && prep}
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
        </div>
      ) : manifest && <p className="settings-note">{t('Nothing left to play here — get the latest.')}</p>}
      <div className="data-row">
        <button onClick={refresh} disabled={busy}>⟳ {t('Get the latest')}</button>
        {msg && <span className="settings-note" role="status" style={{ margin: 0 }}>{msg}</span>}
      </div>
      {!canPlay && <p className="settings-note" role="alert">⚠ {t('This browser can’t play the audio format (Ogg Opus).')}</p>}
      {qnames.length > 1 && (
        <label>{t('Queue')}{' '}
          <select value={queue} onChange={(e) => { setQueue(e.target.value); setIdx(0); audio.current?.pause(); audio.current?.removeAttribute('src'); }}>
            <option value="">{t('All queues')}</option>
            {qnames.map((q) => <option key={q} value={q}>{q}</option>)}
          </select></label>
      )}
      {manifest?.at > 0 && (
        <p className="settings-note">{t('Audio prepared by {device}, read by {voice}, cloud last updated {when}.', {
          device: manifest.device || t('your computer'), voice: manifest.voice ? kokoroLabel(manifest.voice) : '?', when: fmtDateTime(manifest.at) })}</p>
      )}
      {rows.length > 0 && !onMachine && (
        <>
          <h4>{t('What there is to listen to')}</h4>
          <ul className="listen-totals">
            <li><strong>{t('Ahead of you in the cloud: {d} in {n} passages', { d: dur(tot('ms')), n: fmtNum(tot('n'), 0) })}</strong></li>
            <li>{t('Downloaded to this device: {d} in {n} passages ({size}) — these play offline; the rest plays from the cloud while you are online.', { d: dur(tot('hereMs')), n: fmtNum(tot('hereN'), 0), size: mb(tot('hereBytes')) })}</li>
          </ul>
          <div className="listen-scroll">
            <table className="listen-table">
              <thead><tr><th>{t('Book')}</th><th>{t('Your place')}</th><th>{t('In the cloud')}</th><th>{t('On this device')}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.cs}><td>{r.title}{qnames.length > 1 && r.queue ? <span className="settings-note"> · {r.queue}</span> : null}</td><td>{pct(r.at)}</td><td>{cell(r.n, r.ms)}</td><td>{cell(r.hereN, r.hereMs)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {!onMachine && <label className="inline-check"><input type="checkbox" checked={!!global.listenPull} onChange={(e) => onPatchGlobal({ listenPull: e.target.checked })} /> {t('Pull audio here — download new passages in the background (Wi-Fi only)')}</label>}
      <p className="settings-note">{t('Your place moves with each passage you finish and reaches your other devices on the next sync. No book files are needed on this device.')}</p>
      {/* the phone can be the sync machine too, so the card is there as well, folded away at the end */}
      {compact && prep}
    </Dialog>
  );
}
