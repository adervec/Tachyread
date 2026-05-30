// Voice-command audio control + clap detection.
// Uses Web Speech Recognition for voice commands and AudioContext analyser for claps.

import { createRecognizer, speechRecognitionSupported } from './speechRecognition.js';

const COMMAND_MAP = {
  play: 'play',
  pause: 'pause',
  next: 'next',
  back: 'back',
  forward: 'next',
  stop: 'pause',
};

export function startVoiceCommands(onCmd) {
  if (!speechRecognitionSupported()) return null;
  const r = createRecognizer({
    onResult: ({ transcript, isFinal }) => {
      if (!isFinal) return;
      const t = transcript.toLowerCase().trim();
      for (const k of Object.keys(COMMAND_MAP)) {
        if (t.includes(k)) {
          onCmd(COMMAND_MAP[k]);
          return;
        }
      }
    },
    continuous: true,
  });
  if (!r) return null;
  try { r.start(); } catch { /* already started */ }
  return r;
}

export async function startClapDetector(onClaps) {
  // Detect 1, 2, or 3 claps in a 1s window via audio level spikes.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let lastClap = 0;
  let count = 0;
  let windowTimer = null;
  function tick() {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    const now = performance.now();
    if (peak > 90 && now - lastClap > 150) {
      lastClap = now;
      count++;
      if (windowTimer) clearTimeout(windowTimer);
      windowTimer = setTimeout(() => {
        onClaps(count);
        count = 0;
      }, 700);
    }
    raf = requestAnimationFrame(tick);
  }
  let raf = requestAnimationFrame(tick);
  return {
    stop() {
      cancelAnimationFrame(raf);
      if (windowTimer) clearTimeout(windowTimer);
      for (const tr of stream.getTracks()) tr.stop();
      ctx.close();
    },
  };
}
