// A tiny microphone analyser for the audio-command oscilloscope. Separate from the clap detector so
// the live waveform shows in every mode (voice-only included). Frames are analysed on-device only.
export function micScopeSupported() {
  return typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && !!(window.AudioContext || window.webkitAudioContext);
}

export async function startMicScope() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  source.connect(analyser);
  const size = analyser.fftSize;
  return {
    size,
    // Fill `out` (Uint8Array of length `size`) with the current time-domain waveform (0..255,
    // 128 = silence) and return it.
    wave(out) { analyser.getByteTimeDomainData(out); return out; },
    stop() { try { for (const t of stream.getTracks()) t.stop(); ctx.close(); } catch { /* already closed */ } },
  };
}
