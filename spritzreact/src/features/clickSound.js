// Soft "tick" played when the current line advances (opt-in via settings.lineAdvanceSound).
// Synthesized with the Web Audio API — a short band-passed noise burst — so there's no asset
// to ship. The AudioContext is created lazily and resumed on demand; playback only happens
// after the user has interacted (pressing play / navigating), satisfying autoplay policies.
let ctx = null;

function getCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function playLineClick(volume = 0.16) {
  try {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const dur = 0.05;
    const buf = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * dur)), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.7;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + dur);
  } catch {
    /* audio not available — ignore */
  }
}
