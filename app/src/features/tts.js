// Web Speech Synthesis wrapper.
import { useEffect, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// getVoices() is populated asynchronously; always read it fresh (it's cheap).
export function listVoices() {
  if (!synth) return [];
  return synth.getVoices() || [];
}

// React hook that returns the live voice list, updating as the browser loads voices.
// (The classic Web Speech pitfall: getVoices() is empty on first paint and fills in later.)
export function useVoices() {
  const [voices, setVoices] = useState(() => listVoices());
  useEffect(() => {
    if (!synth) return undefined;
    const update = () => {
      const v = listVoices();
      if (v.length) setVoices(v);
    };
    update();
    synth.addEventListener?.('voiceschanged', update);
    // Some engines populate lazily without firing the event — poll briefly to be safe.
    const poll = setInterval(update, 400);
    const stop = setTimeout(() => clearInterval(poll), 5000);
    return () => {
      synth.removeEventListener?.('voiceschanged', update);
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, []);
  return voices;
}

// The app's document language (BCP-47), set once by App from global settings so every speak()
// call site gets language-matched voices without threading a param through all of them.
let _prefLang = 'en-US';
export function setPreferredLanguage(bcp) {
  _prefLang = bcp || 'en-US';
}
export function preferredLanguage() {
  return _prefLang;
}

// Pick a sensible default voice when the user hasn't chosen one: a voice matching the document
// language first (Google's neural voices read markedly better than the Microsoft/eSpeak system
// voices, so steer to them), then the classic English chain as the fallback.
export function pickDefaultVoice(voices = listVoices()) {
  if (!voices || !voices.length) return null;
  const find = (pred) => voices.find(pred);
  const isGoogle = (v) => /\bgoogle\b/i.test(v.name);
  const base = _prefLang.split(/[-_]/)[0].toLowerCase();
  const isPref = (v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base);
  const isEn = (v) => /^en\b|^en[-_]/i.test(v.lang || '');
  const isEnGb = (v) => /^en[-_]?gb/i.test(v.lang || '') || /uk english/i.test(v.name);
  return (
    (base !== 'en' && (find((v) => isGoogle(v) && isPref(v)) || find(isPref))) ||
    find((v) => /google uk english female/i.test(v.name)) ||
    find((v) => /google uk english/i.test(v.name)) ||
    find((v) => isGoogle(v) && isEnGb(v)) ||
    find((v) => isGoogle(v) && isEn(v)) ||
    find(isGoogle) ||
    find(isEnGb) ||
    find(isEn) ||
    null
  );
}

// Resolve the voice to actually use: the named one if it still exists, otherwise the smart default.
export function resolveVoice(voiceName, voices = listVoices()) {
  if (voiceName) {
    const v = voices.find((vv) => vv.name === voiceName);
    if (v) return v;
  }
  return pickDefaultVoice(voices);
}

export function speak(text, { voiceName, rate = 1, pitch = 1, onEnd, onError } = {}) {
  if (!synth) return null;
  const u = new SpeechSynthesisUtterance(text);
  const v = resolveVoice(voiceName);
  if (v) u.voice = v;
  u.lang = v?.lang || _prefLang; // hint engines even when no explicit voice matched
  u.rate = rate;
  u.pitch = pitch;
  if (onEnd) u.onend = onEnd;
  if (onError) u.onerror = onError;
  synth.speak(u);
  return u;
}

export function cancelSpeech() {
  if (synth) synth.cancel();
}

// Rate maps the WPF -5..+8 to a 0.5..2.0 range.
export function rateFromIndex(i) {
  if (i <= 0) return 1 + i * 0.1;
  return 1 + i * 0.15;
}
