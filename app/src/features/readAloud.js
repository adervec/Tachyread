// Integrated read-aloud: speaks the document forward from the current reading position and
// advances that position in sync with the spoken words (via SpeechSynthesis `boundary`
// events). The idea is to have it "read at you" hands-free while you're not looking, yet let
// you manually jump lines/words at any time — speech re-syncs to wherever you move — and
// because every advance flows through the normal position update, it counts toward reading
// stats at the real spoken pace.
//
// Text is spoken one sentence-sized chunk at a time so prosody is natural and utterances stay
// short (avoiding the long-utterance cutoff bug in some engines).

import { resolveVoice, preferredLanguage } from './tts.js';

const MAX_CHUNK_WORDS = 40;

function chunkEnd(words, start) {
  const limit = Math.min(words.length, start + MAX_CHUNK_WORDS);
  for (let i = start; i < limit; i++) {
    const last = words[i][words[i].length - 1];
    if (last === '.' || last === '!' || last === '?') return i + 1;
  }
  return limit;
}

export function createReadAloud({ getWords, getIndex, setIndex, getVoiceName, getRate, onEnd }) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let active = false;
  let gen = 0; // bumped on stop/resync so stale utterance callbacks are ignored

  function speakChunk() {
    if (!active || !synth) return;
    const words = getWords();
    const start = getIndex();
    if (!words.length || start >= words.length - 1) {
      stop();
      onEnd?.();
      return;
    }
    const end = chunkEnd(words, start);

    // Build the utterance text and remember each word's character offset for boundary mapping.
    let text = '';
    const offsets = [];
    for (let i = start; i < end; i++) {
      offsets.push(text.length);
      text += words[i] + (i < end - 1 ? ' ' : '');
    }

    const u = new SpeechSynthesisUtterance(text);
    // Use the chosen voice, or fall back to a good default (Google UK English where available).
    const v = resolveVoice(getVoiceName?.());
    if (v) u.voice = v;
    u.lang = v?.lang || preferredLanguage(); // hint engines even when no voice matched
    u.rate = getRate?.() || 1;

    const myGen = ++gen;
    u.onboundary = (e) => {
      if (myGen !== gen || !active) return;
      if (e.name && e.name !== 'word') return;
      let wi = start;
      for (let k = 0; k < offsets.length; k++) {
        if (e.charIndex >= offsets[k]) wi = start + k;
        else break;
      }
      setIndex(wi);
    };
    u.onend = () => {
      if (myGen !== gen || !active) return;
      setIndex(Math.min(words.length - 1, end)); // step to the next chunk's first word
      speakChunk();
    };
    u.onerror = (ev) => {
      if (myGen !== gen || !active) return;
      if (ev?.error === 'interrupted' || ev?.error === 'canceled') return;
      setIndex(Math.min(words.length - 1, end));
      speakChunk();
    };

    try {
      synth.cancel();
    } catch {
      /* noop */
    }
    synth.speak(u);
  }

  function start() {
    if (!synth || active) return;
    active = true;
    speakChunk();
  }
  function stop() {
    active = false;
    gen++;
    try {
      synth?.cancel();
    } catch {
      /* noop */
    }
  }
  // Called when the reader jumps manually while reading aloud — restart from the new spot.
  function resync() {
    if (!active) return;
    gen++;
    try {
      synth?.cancel();
    } catch {
      /* noop */
    }
    speakChunk();
  }

  return { start, stop, resync, isActive: () => active };
}
