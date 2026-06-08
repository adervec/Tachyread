// Web Speech Recognition (Chrome-only via webkitSpeechRecognition).

export function speechRecognitionSupported() {
  return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createRecognizer({ onResult, onError, lang = 'en-US', continuous = true, interimResults = true } = {}) {
  if (!speechRecognitionSupported()) return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new Ctor();
  r.continuous = continuous;
  r.interimResults = interimResults;
  r.lang = lang;
  r.onresult = (ev) => {
    const last = ev.results[ev.results.length - 1];
    const transcript = last[0].transcript.trim();
    const confidence = last[0].confidence;
    onResult?.({ transcript, confidence, isFinal: last.isFinal });
  };
  r.onerror = (ev) => onError?.(ev.error);
  return r;
}

export function wordMatches(target, spoken, { caseSensitive = false, stripPunct = true } = {}) {
  function norm(s) {
    let v = s.trim();
    if (!caseSensitive) v = v.toLowerCase();
    if (stripPunct) v = v.replace(/[^\p{L}\p{N}\s]/gu, '');
    return v.replace(/\s+/g, ' ');
  }
  const t = norm(target);
  const s = norm(spoken);
  if (!t || !s) return false;
  return s.includes(t) || t.includes(s);
}
