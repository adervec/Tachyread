// Ambient background soundscapes (Web Audio, fully synthesized — no audio files). A continuous
// background bed you can read or doze to: noise colours, rain, ocean, wind, a stream, a fan hum,
// and a 40 Hz focus tone. Ambient tracks like these are commonplace, so there's no warning gating.
//
// Two guarantees keep it from ever competing with read-aloud / TTS:
//   1. A hard master cap (AMBIENT_MAX_VOLUME) well below 1.0 — it can only ever be a quiet bed.
//   2. Ducking: while speech is active the app calls setDucked(true) and the bed drops further.
//
// A module singleton so the sound keeps playing while the dialog is closed.

export const AMBIENT_TYPES = ['White', 'Pink', 'Brown', 'Rain', 'Ocean', 'Wind', 'Stream', 'Fan', '40 Hz tone'];
export const AMBIENT_MAX_VOLUME = 0.35; // hard ceiling on the master gain — stays a background bed
const DUCK_FACTOR = 0.4;                // master is multiplied by this while speech is active

// Per-type loudness trim so switching types doesn't jump in perceived level.
const TRIM = { White: 0.35, Pink: 0.6, Brown: 0.9, Rain: 0.7, Ocean: 0.9, Wind: 0.8, Stream: 0.6, Fan: 0.9, '40 Hz tone': 1 };

let ctx = null;
let master = null;   // user volume (capped)
let duck = null;     // ducking multiplier (1 or DUCK_FACTOR)
let typeGain = null; // current graph's output → master
let nodes = [];      // live nodes to stop on switch/stop
let curType = null;
let curVol = 0.18;
let ducked = false;
let running = false;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    duck = ctx.createGain();
    duck.gain.value = 1;
    master.connect(duck).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ── noise sources ──────────────────────────────────────────────────────────────────────────────
function noiseBuffer(kind) {
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else { // brown
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

function noiseSource(kind) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(kind);
  src.loop = true;
  return src;
}

// A slow sine LFO driving a target AudioParam between lo..hi at `hz`.
function lfo(target, hz, lo, hi) {
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.value = (hi - lo) / 2;
  target.value = (hi + lo) / 2;
  osc.connect(g).connect(target);
  osc.start();
  nodes.push(osc);
}

// Build the node graph for a soundscape type, ending at `out` (→ master).
function buildGraph(type, out) {
  const track = (n) => { nodes.push(n); return n; };
  const startAll = () => nodes.forEach((n) => { if (n.start) { try { n.start(); } catch { /* started */ } } });

  if (type === 'White' || type === 'Pink' || type === 'Brown') {
    const kind = type.toLowerCase();
    track(noiseSource(kind)).connect(out);
  } else if (type === 'Rain') {
    const src = track(noiseSource('white'));
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    src.connect(bp).connect(hp).connect(out);
  } else if (type === 'Ocean') {
    const src = track(noiseSource('brown'));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const swell = ctx.createGain();
    src.connect(lp).connect(swell).connect(out);
    lfo(swell.gain, 0.09, 0.15, 1.0); // slow wave swell
  } else if (type === 'Wind') {
    const src = track(noiseSource('pink'));
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    src.connect(bp).connect(out);
    lfo(bp.frequency, 0.07, 240, 760); // gusting sweep
  } else if (type === 'Stream') {
    const src = track(noiseSource('white'));
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const flutter = ctx.createGain();
    src.connect(hp).connect(flutter).connect(out);
    lfo(flutter.gain, 4.5, 0.6, 1.0); // light babbling flutter
  } else if (type === 'Fan') {
    const src = track(noiseSource('brown'));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    src.connect(lp).connect(out);
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 120;
    const humG = ctx.createGain(); humG.gain.value = 0.12;
    track(hum).connect(humG).connect(out);
  } else if (type === '40 Hz tone') {
    const carrier = ctx.createOscillator(); carrier.frequency.value = 220;
    const depth = ctx.createGain(); depth.gain.value = 0.5; // AM envelope base
    const mod = ctx.createOscillator(); mod.frequency.value = 40;
    const modGain = ctx.createGain(); modGain.gain.value = 0.5;
    track(mod).connect(modGain).connect(depth.gain);
    track(carrier).connect(depth).connect(out);
  } else {
    track(noiseSource('brown')).connect(out);
  }
  startAll();
}

function clampVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(AMBIENT_MAX_VOLUME, Math.max(0, n));
}

function applyMaster() {
  if (!master) return;
  const target = clampVol(curVol) * (ducked ? DUCK_FACTOR : 1);
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(target, t, 0.25); // smooth fade, no clicks
}

function teardownNodes() {
  for (const n of nodes) { try { n.stop?.(); } catch { /* already stopped */ } try { n.disconnect?.(); } catch { /* noop */ } }
  nodes = [];
  if (typeGain) { try { typeGain.disconnect(); } catch { /* noop */ } typeGain = null; }
}

function start(type = curType || 'Brown', volume = curVol) {
  if (!ensureCtx()) return false;
  curType = type;
  curVol = volume;
  teardownNodes();
  typeGain = ctx.createGain();
  typeGain.gain.value = TRIM[type] ?? 0.8;
  typeGain.connect(master);
  buildGraph(type, typeGain);
  running = true;
  applyMaster();
  return true;
}

function stop() {
  running = false;
  teardownNodes();
  if (master && ctx) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(0, t, 0.2);
  }
}

function setType(type) {
  if (!running) { curType = type; return; }
  start(type, curVol); // rebuild graph, keep playing
}

function setVolume(v) {
  curVol = v;
  if (running) applyMaster();
}

// Called by the app: drop the bed further while read-aloud / TTS is speaking.
function setDucked(on) {
  ducked = !!on;
  if (running) applyMaster();
}

export const ambient = {
  start,
  stop,
  setType,
  setVolume,
  setDucked,
  isRunning: () => running,
  getType: () => curType,
};
