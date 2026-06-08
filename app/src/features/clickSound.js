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

// Generic short click. `freq` shifts the tone (a slightly higher tick reads as a "shutter").
export function playClick(volume = 0.16, freq = 1500, dur = 0.05) {
  try {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const buf = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * dur)), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
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

// Soft tick on line advance (the default tone).
export function playLineClick(volume = 0.16) {
  playClick(volume, 1500);
}

// Slightly brighter, shorter "shutter" tick for a grab/capture action.
export function playGrabClick(volume = 0.2) {
  playClick(volume, 2200, 0.04);
}

// Light, crisp click for a perfectly typed word.
export function playPerfectClick(volume = 0.4) {
  playClick(volume * 0.5, 2000, 0.03);
}

// Very short, soft low-passed hiss for a word typed with an error.
export function playErrorHiss(volume = 0.4) {
  try {
    const ac = getCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const dur = 0.08;
    const buf = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * dur)), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + dur);
  } catch {
    /* audio not available — ignore */
  }
}
