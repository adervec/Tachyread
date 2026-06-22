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

// ── Newline / line-advance sound stable ──────────────────────────────────────────────────────────
// A whole shelf of short (~0.03–0.12s) synthesized line-advance sounds so the per-line cue can be
// personalised. All are generated with the Web Audio API (no samples to ship).

// Short tonal blip: an oscillator with a fast attack + exponential decay and an optional pitch sweep.
function tone(ac, t, { freq, to, type = 'sine', dur = 0.06, vol = 0.16, attack = 0.003 }) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to && to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Short filtered noise burst (the basis of the percussive cues).
function noiseBurst(ac, t, { freq = 1500, type = 'bandpass', q = 0.7, dur = 0.05, vol = 0.16 }) {
  const buf = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * dur)), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur);
}

const SOUNDS = {
  soft:    { label: 'Soft tick',   play: (ac, t, v) => noiseBurst(ac, t, { freq: 1500, vol: v }) },
  shutter: { label: 'Shutter',     play: (ac, t, v) => noiseBurst(ac, t, { freq: 2200, dur: 0.04, vol: v }) },
  tick:    { label: 'Hi tick',     play: (ac, t, v) => noiseBurst(ac, t, { freq: 3200, dur: 0.03, q: 1.2, vol: v }) },
  tap:     { label: 'Tap',         play: (ac, t, v) => noiseBurst(ac, t, { freq: 1000, q: 0.5, dur: 0.03, vol: v }) },
  knock:   { label: 'Knock',       play: (ac, t, v) => noiseBurst(ac, t, { freq: 240, type: 'lowpass', dur: 0.06, vol: v * 1.2 }) },
  clave:   { label: 'Clave',       play: (ac, t, v) => { noiseBurst(ac, t, { freq: 2500, dur: 0.025, vol: v }); tone(ac, t, { freq: 2500, dur: 0.04, vol: v * 0.6 }); } },
  wood:    { label: 'Woodblock',   play: (ac, t, v) => { tone(ac, t, { freq: 880, to: 760, type: 'triangle', dur: 0.05, vol: v }); noiseBurst(ac, t, { freq: 1800, dur: 0.02, vol: v * 0.4 }); } },
  pluck:   { label: 'Pluck',       play: (ac, t, v) => tone(ac, t, { freq: 440, type: 'triangle', dur: 0.09, vol: v }) },
  ping:    { label: 'Ping',        play: (ac, t, v) => tone(ac, t, { freq: 1200, type: 'sine', dur: 0.08, vol: v }) },
  pop:     { label: 'Pop',         play: (ac, t, v) => tone(ac, t, { freq: 420, to: 120, type: 'sine', dur: 0.045, vol: v * 1.1 }) },
  bubble:  { label: 'Bubble',      play: (ac, t, v) => tone(ac, t, { freq: 300, to: 720, type: 'sine', dur: 0.05, vol: v }) },
  drip:    { label: 'Drip',        play: (ac, t, v) => tone(ac, t, { freq: 900, to: 1500, type: 'sine', dur: 0.05, vol: v }) },
  blip:    { label: 'Blip',        play: (ac, t, v) => tone(ac, t, { freq: 1000, type: 'square', dur: 0.035, vol: v * 0.7 }) },
  zap:     { label: 'Zap',         play: (ac, t, v) => tone(ac, t, { freq: 1600, to: 380, type: 'sawtooth', dur: 0.05, vol: v * 0.7 }) },
  glass:   { label: 'Glass',       play: (ac, t, v) => { tone(ac, t, { freq: 2600, dur: 0.09, vol: v * 0.8 }); tone(ac, t, { freq: 3900, dur: 0.06, vol: v * 0.3 }); } },
  marimba: { label: 'Marimba',     play: (ac, t, v) => { tone(ac, t, { freq: 660, dur: 0.1, vol: v }); tone(ac, t, { freq: 1320, dur: 0.05, vol: v * 0.3 }); } },
  chime:   { label: 'Chime',       play: (ac, t, v) => { tone(ac, t, { freq: 1318, dur: 0.12, vol: v * 0.7 }); tone(ac, t, { freq: 1760, dur: 0.09, vol: v * 0.4 }); } },
  sonar:   { label: 'Sonar',       play: (ac, t, v) => tone(ac, t, { freq: 720, dur: 0.12, vol: v }) },
  thud:    { label: 'Thud',        play: (ac, t, v) => tone(ac, t, { freq: 140, to: 80, type: 'sine', dur: 0.07, vol: v * 1.3 }) },
};

// Sound options for the picker (plus a "random each line" mode for variety).
export const LINE_SOUNDS = [
  ...Object.entries(SOUNDS).map(([id, s]) => ({ id, label: s.label })),
  { id: 'random', label: 'Random each line' },
];

// Play a named line-advance sound. 'random' picks a different one each call.
export function playLineSound(kind = 'soft', volume = 0.16) {
  try {
    const ac = getCtx();
    if (!ac) return;
    let k = kind;
    if (k === 'random') { const ids = Object.keys(SOUNDS); k = ids[Math.floor(Math.random() * ids.length)]; }
    (SOUNDS[k] || SOUNDS.soft).play(ac, ac.currentTime, volume);
  } catch {
    /* audio not available — ignore */
  }
}

// Soft tick on line advance — delegates to the stable (default 'soft' is the original tone).
export function playLineClick(volume = 0.16, kind = 'soft') {
  playLineSound(kind, volume);
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
