// Audio cue for eye-gesture timing. You can't see how long you've been holding your eyes shut —
// that's the whole difficulty of duration-mapped gestures — so the ear does it: a bright tick the
// moment the hold enters a mapped window ("let go now"), a duller one when it falls out into a gap,
// and a low buzz once you're past every window.
//
// One lazily-created AudioContext, three oscillator blips. No files, no preloading.

const TONES = {
  enter: { f: 880, ms: 70, gain: 0.16, type: 'sine' },   // you're in a window — release
  leave: { f: 440, ms: 60, gain: 0.11, type: 'sine' },   // dropped into the gap between windows
  over: { f: 200, ms: 130, gain: 0.13, type: 'triangle' }, // past everything — nothing will fire
  fired: { f: 1320, ms: 90, gain: 0.18, type: 'sine' },  // the command actually ran
};

export function createEyeCue() {
  let ctx = null;
  return {
    play(kind, volume = 1) {
      const t = TONES[kind];
      if (!t || !volume) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) ctx = new AC();
        // Mobile suspends the context until a user gesture; resume() is a no-op when it's running.
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = t.type;
        osc.frequency.value = t.f;
        const now = ctx.currentTime;
        const peak = t.gain * Math.max(0, Math.min(1, volume));
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t.ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + t.ms / 1000 + 0.02);
      } catch { /* audio is a nicety; never let it break the reader */ }
    },
    close() { try { ctx?.close(); } catch { /* ignore */ } ctx = null; },
  };
}
