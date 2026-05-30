// MediaRecorder wrapper for per-line audiobook recording.

let mediaStream = null;

export async function getStream() {
  if (mediaStream) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return mediaStream;
}

export function stopStream() {
  if (!mediaStream) return;
  for (const tr of mediaStream.getTracks()) tr.stop();
  mediaStream = null;
}

export async function recordClip({ onStop } = {}) {
  const stream = await getStream();
  const chunks = [];
  const startedAt = Date.now();
  const mime =
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
    MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
    '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
    onStop?.({ blob, durationMs: Date.now() - startedAt });
  };
  rec.start();
  return rec;
}
