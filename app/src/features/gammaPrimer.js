// 40 Hz auditory focus primer (Web Audio). A carrier tone is amplitude-modulated at the gamma rate
// by routing a 40 Hz oscillator into the carrier's gain: the envelope opens and closes 40×/second, so
// the listener hears a steady tone pulsing at 40 Hz — gamma entrainment through sound, with NO visual
// flicker. Soft attack/release avoid clicks; the whole thing auto-stops after durationSec.
import { clampGammaConfig } from '../engine/gamma.js';

export function createGammaPrimer() {
  let ctx = null;
  let nodes = null;
  let timer = null;
  let endAtMs = 0;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (nodes) {
      try { nodes.carrier.stop(); } catch { /* already stopped */ }
      try { nodes.mod.stop(); } catch { /* already stopped */ }
      nodes = null;
    }
  }

  function start(cfg, { onTick, onDone } = {}) {
    const c = clampGammaConfig(cfg);
    if (!ensureCtx()) return false;
    stop();
    const t0 = ctx.currentTime;
    const end = t0 + c.durationSec;

    const carrier = ctx.createOscillator();
    carrier.frequency.value = c.carrierHz;
    const depth = ctx.createGain(); // AM envelope: base 0.5 + 40 Hz (±0.5) → 0..1
    depth.gain.value = 0.5;
    const mod = ctx.createOscillator();
    mod.frequency.value = c.modHz;
    const modGain = ctx.createGain();
    modGain.gain.value = 0.5; // modulation depth
    const master = ctx.createGain();

    mod.connect(modGain).connect(depth.gain); // drive the AM envelope
    carrier.connect(depth).connect(master).connect(ctx.destination);

    // soft attack and release so it fades in/out rather than clicking
    const vol = Math.max(0.0002, c.volume);
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(vol, t0 + 0.8);
    master.gain.setValueAtTime(vol, Math.max(t0 + 0.8, end - 0.8));
    master.gain.exponentialRampToValueAtTime(0.0001, end);

    carrier.start(t0);
    mod.start(t0);
    carrier.stop(end + 0.05);
    mod.stop(end + 0.05);

    nodes = { carrier, mod };
    endAtMs = Date.now() + c.durationSec * 1000;
    timer = setInterval(() => {
      const remain = Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000));
      onTick?.(remain);
      if (remain <= 0) { stop(); onDone?.(); }
    }, 250);
    return true;
  }

  return {
    start,
    stop,
    isRunning: () => !!timer,
    remainingSec: () => Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000)),
  };
}
