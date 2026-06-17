// The "looking away too long" alarm. Synthesized (no audio files) and deliberately evocative of the
// octahedron Angel's pattern-blue warning klaxon from Neon Genesis Evangelion: a low, ominous drone
// that alternates between two pitches, with a detuned beating voice, a sub-octave, a resonant low-pass
// and a slow tremolo warble. Optionally ESCALATES — starts quiet and swells the longer it runs.
export function createAlarm() {
  let ctx = null;
  let master = null;   // overall volume / escalation
  let trem = null;     // tremolo-modulated gain
  let mix = null;      // voice sum → low-pass
  let lp = null;
  let lfo = null;
  let lfoDepth = null;
  let oscs = [];
  let altTimer = null;
  let running = false;
  let high = false;

  // Alternating two-tone (a minor third) — the recognisable back-and-forth wail.
  const F1 = 311.13; // D#4
  const F2 = 233.08; // A#3

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function step() {
    if (!ctx) return;
    high = !high;
    const base = high ? F1 : F2;
    const t = ctx.currentTime;
    oscs.forEach((o) => {
      const target = base * o._mul;
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(o.frequency.value, t);
      o.frequency.linearRampToValueAtTime(target, t + 0.05); // quick glide, still stark
    });
  }

  function mk(type, mul) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = F1 * mul;
    o._mul = mul;
    o.connect(mix);
    o.start();
    return o;
  }

  function start({ escalate = false } = {}) {
    if (running) return;
    running = true;
    if (!ensure()) return;
    const t = ctx.currentTime;
    master = ctx.createGain();
    trem = ctx.createGain();
    trem.gain.value = 1;
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    lp.Q.value = 6; // resonant → that hollow, menacing colour
    mix = ctx.createGain();
    mix.gain.value = 0.32;
    mix.connect(lp).connect(trem).connect(master).connect(ctx.destination);

    high = false;
    oscs = [mk('sawtooth', 1), mk('sawtooth', 1.006), mk('sine', 0.5)]; // tone, beating detune, sub-octave

    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6.4;
    lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.18;
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start(t);

    master.gain.cancelScheduledValues(t);
    if (escalate) {
      master.gain.setValueAtTime(0.05, t);
      master.gain.linearRampToValueAtTime(0.55, t + 28); // swell over ~28s
    } else {
      master.gain.setValueAtTime(0.34, t);
    }
    altTimer = setInterval(step, 430);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (altTimer) { clearInterval(altTimer); altTimer = null; }
    const t = ctx ? ctx.currentTime : 0;
    try { master?.gain.cancelScheduledValues(t); master?.gain.setTargetAtTime(0.0001, t, 0.06); } catch { /* noop */ }
    const dying = oscs;
    const dyingLfo = lfo;
    oscs = [];
    lfo = null;
    setTimeout(() => {
      dying.forEach((o) => { try { o.stop(); } catch { /* already */ } });
      try { dyingLfo?.stop(); } catch { /* already */ }
    }, 160);
  }

  return { start, stop, isRunning: () => running };
}
