// Web-Audio metronome with a lookahead scheduler (the classic "A Tale of Two Clocks" pattern): a
// coarse JS timer wakes every LOOKAHEAD_MS and schedules click onsets a little ahead on the precise
// AudioContext clock, so the beat stays rock-steady even when the main thread jitters. Tempo is
// re-read from getWpm() on every wake, so the pulse tracks live WPM changes (and the adaptive pacer)
// without a restart. Clicks are short enveloped oscillator blips — no audio assets.
import { tickIntervalMs, isMainBeat, isAccent } from '../engine/metronome.js';

const LOOKAHEAD_MS = 25; // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.12; // seconds of audio scheduled into the future

export function createMetronome() {
  let ctx = null;
  let timer = null;
  let nextTime = 0; // AudioContext time of the next tick
  let tickIdx = 0;
  let cfg = null; // { getWpm, subdivision, accentEvery, volume }
  let scheduled = 0; // total clicks scheduled (for tests/inspection)

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function click(time, accent, main) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = cfg?.volume ?? 0.25;
    const vol = Math.max(0.0002, base * (accent ? 1 : main ? 0.7 : 0.4));
    osc.frequency.value = accent ? 1760 : main ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
    scheduled++;
  }

  function pump() {
    if (!ctx || !cfg) return;
    const sub = cfg.subdivision || 1;
    const acc = cfg.accentEvery || 0;
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      click(nextTime, isAccent(tickIdx, sub, acc), isMainBeat(tickIdx, sub));
      const wpm = Math.max(1, cfg.getWpm?.() || 1);
      nextTime += tickIntervalMs(wpm, sub) / 1000;
      tickIdx++;
    }
  }

  function start(config) {
    cfg = config;
    if (!ensureCtx()) return false;
    if (timer) clearInterval(timer);
    tickIdx = 0;
    nextTime = ctx.currentTime + 0.06;
    timer = setInterval(pump, LOOKAHEAD_MS);
    pump();
    return true;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    cfg = null;
  }

  function setConfig(partial) {
    if (cfg) cfg = { ...cfg, ...partial };
  }

  // Play a short fixed-length burst regardless of playback — used by the settings "Try" button.
  function preview(config, beats = 8) {
    if (!ensureCtx()) return false;
    cfg = config;
    const sub = config.subdivision || 1;
    const acc = config.accentEvery || 0;
    const wpm = Math.max(1, config.getWpm?.() || config.wpm || 300);
    let t = ctx.currentTime + 0.06;
    for (let i = 0; i < beats * sub; i++) {
      click(t, isAccent(i, sub, acc), isMainBeat(i, sub));
      t += tickIntervalMs(wpm, sub) / 1000;
    }
    return true;
  }

  return {
    start,
    stop,
    setConfig,
    preview,
    isRunning: () => !!timer,
    scheduledCount: () => scheduled,
  };
}
