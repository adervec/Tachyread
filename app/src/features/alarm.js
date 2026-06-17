// A short, repeating two-tone alert (Web Audio) — used by the "looking away too long" alarm. start()
// begins a beep loop until stop(). Synthesized, no audio files.
export function createAlarm() {
  let ctx = null;
  let timer = null;
  let running = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function beep() {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const s = t0 + i * 0.18;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.22, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(s);
      osc.stop(s + 0.18);
    });
  }

  function start() {
    if (running) return;
    running = true;
    beep();
    timer = setInterval(beep, 900);
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { start, stop, isRunning: () => running };
}
