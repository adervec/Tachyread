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

export function speak(text, { voiceName, rate = 1, pitch = 1, onEnd, onError } = {}) {
  if (!synth) return null;
  const u = new SpeechSynthesisUtterance(text);
  if (voiceName) {
    const v = listVoices().find((vv) => vv.name === voiceName);
    if (v) u.voice = v;
  }
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
