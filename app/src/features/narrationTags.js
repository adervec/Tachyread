// Narration tags in your own text, read by the audiobook generator:
//   [pause] (¾ s) · [pause:2] (seconds, up to 10) · [break] (1.5 s) — silence at that point
//   [voice:Amy] … [/voice] — that passage in another voice (matched by name, label or id)
// A chunk with tags is synthesized piece by piece and stitched into one clip; without tags nothing
// changes. Tags stay visible in the reader (they're part of your file's text).

const TAG = /\[(pause(?::\s*([\d.]+))?|break|voice:\s*([^\]]+)|\/voice)\]/gi;

export const hasNarrationTags = (text) => new RegExp(TAG.source, 'i').test(text || '');

// text → [{ kind: 'speech', text, voice: name|null } | { kind: 'pause', ms }]
export function parseNarrationTags(text) {
  const out = [];
  let voice = null, last = 0;
  const speech = (s) => { const t = s.replace(/\s+/g, ' ').trim(); if (t) out.push({ kind: 'speech', text: t, voice }); };
  for (const m of String(text || '').matchAll(TAG)) {
    speech(text.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    if (tag.startsWith('pause')) out.push({ kind: 'pause', ms: Math.round(Math.min(10, Math.max(0, m[2] != null ? Number(m[2]) || 0 : 0.75)) * 1000) });
    else if (tag === 'break') out.push({ kind: 'pause', ms: 1500 });
    else if (tag === '/voice') voice = null;
    else voice = m[3].trim();
  }
  speech(String(text || '').slice(last));
  return out;
}

// A [voice:…] name → a voice id from the candidates [{ id, label }] (exact id, then a label/id that
// contains the name, case-insensitive). Unknown names fall back to the job's own voice.
export function resolveVoice(name, candidates, fallback) {
  if (!name) return fallback;
  const n = name.toLowerCase();
  const hit = candidates.find((c) => c.id.toLowerCase() === n)
    || candidates.find((c) => (c.label || '').toLowerCase().includes(n) || c.id.toLowerCase().includes(n));
  return hit ? hit.id : fallback;
}

// Synthesize the pieces (synth(text, voiceId) → audio Blob) and stitch them, with the pauses, into
// one mono WAV. Browser-only (decodeAudioData / OfflineAudioContext).
export async function synthTagged(text, { synth, voiceId, candidates, encodeWav, rate = 22050 }) {
  const parts = parseNarrationTags(text);
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  const pieces = [];
  try {
    for (const p of parts) {
      if (p.kind === 'pause') { pieces.push({ silence: p.ms / 1000 }); continue; }
      const blob = await synth(p.text, resolveVoice(p.voice, candidates, voiceId));
      pieces.push({ buf: await actx.decodeAudioData(await blob.arrayBuffer()) });
    }
  } finally { actx.close(); }
  const total = pieces.reduce((s, p) => s + (p.buf ? p.buf.duration : p.silence), 0);
  const octx = new OfflineAudioContext(1, Math.max(1, Math.ceil(total * rate)), rate);
  let t = 0;
  for (const p of pieces) {
    if (p.buf) { const src = octx.createBufferSource(); src.buffer = p.buf; src.connect(octx.destination); src.start(t); t += p.buf.duration; }
    else t += p.silence;
  }
  const rendered = await octx.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0), rate)], { type: 'audio/wav' });
}
