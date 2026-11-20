// ElevenLabs cloud TTS — an optional, higher-quality alternative to offline Piper for AUDIOBOOK
// generation. Unlike Piper (on-device), this sends the chunk text to ElevenLabs' servers and spends
// the user's own API key + quota; the returned audio is stored like any other clip and plays offline
// (survives a screen lock). It's a generation backend only — not used for live read-aloud (per-chunk
// network calls would be slow/costly). The key lives on-device and is never synced.
import { recordApiUsage } from '../state/storage.js';
import { elevenCost } from './apiPricing.js';
import { t } from '../i18n.js';

const BASE = 'https://api.elevenlabs.io/v1';

export function elevenConfigured(key) { return !!(key && key.trim()); }

export const ELEVEN_MODELS = [
  { id: 'eleven_multilingual_v2', label: t('Multilingual v2 — best quality') },
  { id: 'eleven_turbo_v2_5', label: t('Turbo v2.5 — faster / cheaper') },
  { id: 'eleven_flash_v2_5', label: t('Flash v2.5 — fastest / cheapest') },
];

async function errorFrom(r) {
  if (r.status === 401) return t('Invalid ElevenLabs API key.');
  if (r.status === 429) return t('ElevenLabs rate limit / quota reached.');
  try { const e = await r.json(); return (e?.detail?.message || e?.detail || t('ElevenLabs error {status}', { status: r.status })); }
  catch { return t('ElevenLabs error {status}', { status: r.status }); }
}

// The account's voices → [{ id, name, category }]. Throws on a bad key / network error.
export async function elevenVoices(apiKey) {
  const r = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': (apiKey || '').trim() } });
  if (!r.ok) throw new Error(await errorFrom(r));
  const j = await r.json();
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}

// Synthesize text → an audio/mpeg Blob (stored + played like a Piper WAV clip).
export async function elevenSynth(text, voiceId, apiKey, { modelId = 'eleven_multilingual_v2' } = {}) {
  const r = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': (apiKey || '').trim(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: (text || '').trim(), model_id: modelId }),
  });
  if (!r.ok) throw new Error(await errorFrom(r));
  const chars = (text || '').trim().length;
  recordApiUsage({ provider: 'elevenlabs', model: modelId, source: 'audiobook', chars, costUsd: elevenCost(chars) });
  return await r.blob();
}
