// End-of-run grade fanfares — a short synthesized sound per letter grade (Web Audio, no samples).
// A/B are bright and rising, C a neutral chime, D a descending eerie "death-whistle" sweep, and F a
// low fail buzz. All original tones, just chosen to fit the vibe.

export function letterGrade(net) {
  if (net >= 90) return 'A';
  if (net >= 70) return 'B';
  if (net >= 50) return 'C';
  if (net >= 35) return 'D';
  return 'F';
}

export const GRADE_STATEMENTS = {
  A: 'Blazing. Untouchable.',
  B: 'Strong run — hold that pace.',
  C: 'Solid. A little more next time.',
  D: 'You’ll get there. Run it back.',
  F: 'Rough one. Again?',
};

export function playGradeSound(grade) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  let ctx;
  try { ctx = new AC(); } catch { return; }
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);

  const tone = (freq, start, dur, type = 'triangle', vol = 0.35) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now + start);
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(vol, now + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    o.connect(g).connect(master);
    o.start(now + start);
    o.stop(now + start + dur + 0.05);
  };
  // Pitch sweep f0→f1 with optional vibrato — the falling whistle / fail buzz.
  const sweep = (f0, f1, start, dur, type = 'triangle', vol = 0.4, vibratoHz = 0) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, now + start);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), now + start + dur);
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(vol, now + start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    o.connect(g).connect(master);
    if (vibratoHz) {
      const lfo = ctx.createOscillator();
      const ld = ctx.createGain();
      lfo.frequency.value = vibratoHz;
      ld.gain.value = f0 * 0.04;
      lfo.connect(ld).connect(o.frequency);
      lfo.start(now + start);
      lfo.stop(now + start + dur + 0.05);
    }
    o.start(now + start);
    o.stop(now + start + dur + 0.05);
  };

  switch (grade) {
    case 'A': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.5, 'triangle', 0.34)); break;
    case 'B': tone(523.25, 0, 0.26, 'triangle', 0.34); tone(783.99, 0.13, 0.42, 'triangle', 0.34); break;
    case 'C': tone(587.33, 0, 0.5, 'sine', 0.3); break;
    case 'D': sweep(780, 130, 0, 1.15, 'triangle', 0.42, 7); break; // descending eerie whistle
    case 'F': sweep(210, 65, 0, 1.0, 'sawtooth', 0.32, 0); tone(110, 0, 1.0, 'sine', 0.18); break;
    default: break;
  }
  setTimeout(() => { try { ctx.close(); } catch { /* already closed */ } }, 2200);
}
