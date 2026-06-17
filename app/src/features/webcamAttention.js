// On-device webcam attention monitor (experimental). Watches the user via the front camera and
// reports whether they appear to be FACING THE SCREEN; the app uses that to pause non-TTS reading
// when you look away. Everything runs locally — the video frames are analysed in the browser and
// nothing is uploaded, recorded, or sent anywhere.
//
// Detection uses the browser's built-in FaceDetector (Shape Detection API) when available, so there
// is no model download. Where FaceDetector isn't supported the monitor reports 'unsupported' and
// never pauses anything. (Eye-open/closed isn't exposed by FaceDetector; this first version treats a
// detected forward-facing face as "attentive" — a follow-up could add a finer eye-aspect model.)

export function faceDetectionSupported() {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

// Heuristic "facing the screen": a profile/averted face usually isn't detected at all by FaceDetector,
// so a detection is already a decent proxy. When eye landmarks are present, also require them to be
// side-by-side and roughly level (not a steeply tilted/averted head).
function looksForward(face) {
  const eyes = (face.landmarks || []).filter((l) => l.type === 'eye');
  if (eyes.length >= 2 && eyes[0].locations?.[0] && eyes[1].locations?.[0]) {
    const a = eyes[0].locations[0];
    const b = eyes[1].locations[0];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return dx > 8 && dy <= dx; // eyes apart horizontally, not tilted past ~45°
  }
  return true; // no landmarks from this engine → treat a detected face as facing-ish
}

// onState receives one of: starting | watching | away | unsupported | denied | error | off
export function createAttentionMonitor({ onState, intervalMs = 280, graceMs = 1200 } = {}) {
  let stream = null;
  let video = null;
  let detector = null;
  let timer = null;
  let running = false;
  let lastSeen = 0;
  let state = 'off';

  function set(s) { if (s !== state) { state = s; onState?.(s); } }

  async function start() {
    if (running) return;
    running = true;
    set('starting');
    if (!faceDetectionSupported()) { set('unsupported'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' }, audio: false,
      });
    } catch (e) {
      running = false;
      set(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'error');
      return;
    }
    if (!running) { stream.getTracks().forEach((t) => t.stop()); return; } // stopped during await
    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try { await video.play(); } catch { /* autoplay quirks — detection still reads frames */ }
    try { detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); }
    catch { running = false; set('unsupported'); return; }
    lastSeen = Date.now();
    timer = setInterval(tick, intervalMs);
    set('watching');
  }

  async function tick() {
    if (!running || !video) return;
    let faces = [];
    try { faces = await detector.detect(video); } catch { /* transient decode error — ignore */ }
    const facing = faces.length > 0 && looksForward(faces[0]);
    const now = Date.now();
    if (facing) { lastSeen = now; set('watching'); }
    else if (now - lastSeen > graceMs) set('away');
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { video.srcObject = null; video = null; }
    detector = null;
    set('off');
  }

  return { start, stop, getState: () => state };
}
