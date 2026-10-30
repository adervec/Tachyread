import { useEffect, useRef, useState } from 'react';
import { trimSegments, totalMs } from '../features/videoRing.js';

// Camera replay for reading aloud: the last few minutes of you (picture + sound) in memory only, as
// SEG_MS segments with the oldest dropped. ▶ Watch plays them back to back (recording pauses);
// 💾 Save downloads them as numbered .webm files. Nothing reaches disk otherwise.
const SEG_MS = 15000;
// ponytail: module-level so closing the reading-aloud card keeps what was recorded; reload clears it.
let segs = [];

const pickMime = () => ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
const fmt = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export default function VideoReplay({ mins }) {
  const [kept, setKept] = useState(() => totalMs(segs));
  const [err, setErr] = useState('');
  const [play, setPlay] = useState(null); // { urls, i } while watching
  const keepRef = useRef(mins * 60000);
  const ctl = useRef({}); // { pause, resume } from the recorder effect
  const segStart = useRef(0); // when the segment in progress began (0 = not recording)
  const liveRef = useRef(null);

  useEffect(() => {
    keepRef.current = mins * 60000;
    segs = trimSegments(segs, keepRef.current);
    setKept(totalMs(segs));
  }, [mins]);

  useEffect(() => {
    let stream, rec, timer, dead = false, paused = false;
    const mime = pickMime();
    const start = () => {
      if (dead || paused || !stream) return;
      const chunks = [];
      const t0 = Date.now();
      segStart.current = t0;
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_000_000 });
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearTimeout(timer);
        segStart.current = 0;
        if (chunks.length) segs = trimSegments([...segs, { blob: new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }), ms: Date.now() - t0, at: t0 }], keepRef.current);
        if (!dead) setKept(totalMs(segs));
        rec.onstopped?.(); rec.onstopped = null;
        start();
      };
      rec.start(1000); // 1 s chunks: some Chrome builds hand back an empty file without a timeslice
      timer = setTimeout(() => rec.state === 'recording' && rec.stop(), SEG_MS);
    };
    // Close off the segment in progress (so Watch includes the last seconds) and hold recording.
    ctl.current.pause = () => new Promise((res) => {
      paused = true;
      if (rec?.state === 'recording') { rec.onstopped = res; rec.stop(); } else res();
    });
    ctl.current.resume = () => { paused = false; if (rec?.state !== 'recording') start(); };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        // A recorder started before the camera's first frame can come back empty — wait for one.
        const v = liveRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
          if (v.readyState < 2) await new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 3000); });
        }
        start();
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'Camera blocked — allow it for this site to record video.' : `No camera: ${e?.message || e}`);
      }
    })();
    return () => {
      dead = true;
      clearTimeout(timer);
      if (rec?.state === 'recording') rec.stop(); // its onstop still keeps the final segment
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Tick the counter each second: finished segments + the one being recorded, up to the window.
  useEffect(() => {
    const id = setInterval(() => setKept(Math.min(keepRef.current, totalMs(segs) + (segStart.current ? Date.now() - segStart.current : 0))), 1000);
    return () => clearInterval(id);
  }, []);

  const watch = async () => {
    await ctl.current.pause?.();
    if (!segs.length) { ctl.current.resume?.(); return; }
    setPlay({ urls: segs.map((s) => URL.createObjectURL(s.blob)), i: 0 });
  };
  const stopWatching = () => {
    play?.urls.forEach((u) => URL.revokeObjectURL(u));
    setPlay(null);
    ctl.current.resume?.();
  };
  const save = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const ext = (segs[0]?.blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    segs.forEach((s, i) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(s.blob);
      a.download = `reading-aloud-video-${stamp}-${String(i + 1).padStart(2, '0')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    });
  };

  if (err) return <div className="vf-note">{err}</div>;
  return (
    <div className="vf-video">
      {/* tiny live mirror so you know the camera is framing you; muted (no echo) */}
      <video ref={liveRef} className="vf-live" autoPlay muted playsInline hidden={!!play} aria-label="Live camera" />
      <span title={`Your last ${mins} minute(s) of video, memory only, oldest dropped (in ${SEG_MS / 1000} s pieces)`}>📹 last {fmt(kept)} kept</span>
      {!play && <button type="button" className="vf-btn" disabled={!kept} onClick={watch} title="Watch the last few minutes (recording pauses while you watch)">▶ Watch</button>}
      {!play && kept > 0 && <button type="button" className="vf-btn" onClick={save} title={`Save as ${segs.length} video file(s) — one per ${SEG_MS / 1000} s piece`}>💾 Save</button>}
      {play && (
        <>
          <button type="button" className="vf-btn" onClick={stopWatching}>■ Done</button>
          <span className="vf-dim">part {play.i + 1}/{play.urls.length}</span>
          <video key={play.i} className="vf-playback" src={play.urls[play.i]} autoPlay controls playsInline
            onEnded={() => (play.i + 1 < play.urls.length ? setPlay({ ...play, i: play.i + 1 }) : stopWatching())} />
        </>
      )}
    </div>
  );
}
