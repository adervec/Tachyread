// Custom trigger SEQUENCES: a short chain of hands-free events (gestures, spoken phrases, clap
// patterns — in any combination) that fires its own command when performed in order. Event keys:
//   'g:<gestureKind>'  (e.g. g:fist — hand-agnostic; the hand-qualified event g:fist:L also
//                       matches a g:fist step, and a g:fist:L step matches only the left hand)
//   'v:<phrase>'       (a phrase row's trigger text, matched or not it feeds the chain)
//   'c:<clapCount>'    (c:1 / c:2 / c:3)
// Matching is strict: the LAST steps.length events must equal the sequence, in order, all inside
// `windowMs` — a stray event in between breaks the chain (predictability beats cleverness here).
// Rows: { steps: ['g:fist','v:play'], commandId, on }. Pure — see triggerSequences.test.mjs.

export function stepMatches(step, eventKey) {
  if (step === eventKey) return true;
  // Hand-agnostic gesture step matches a hand-qualified event (g:fist matches g:fist:L / g:fist:R).
  return step.startsWith('g:') && eventKey.startsWith(step + ':');
}

export function createSequenceMatcher({ windowMs = 5000, maxLen = 6 } = {}) {
  let buf = []; // [{ key, t }] most-recent last
  return {
    feed(eventKey, now, rows) {
      buf.push({ key: eventKey, t: now });
      buf = buf.filter((e) => now - e.t <= windowMs).slice(-maxLen);
      for (const row of rows || []) {
        if (row?.on === false || !row?.commandId) continue;
        const steps = (row.steps || []).filter(Boolean);
        if (steps.length < 2 || steps.length > buf.length) continue;
        const tail = buf.slice(-steps.length);
        if (steps.every((s, i) => stepMatches(s, tail[i].key))) {
          buf = []; // consume — one performance fires once
          return row.commandId;
        }
      }
      return null;
    },
    reset() { buf = []; },
  };
}

// Human label for a step key, given the gesture info map ({kind: {icon,label}}).
export function stepLabel(key, gestureInfo = {}) {
  if (key.startsWith('g:')) {
    const [, kind, hand] = key.split(':');
    const gi = gestureInfo[kind];
    return `${gi?.icon || '🖐'} ${gi?.label || kind}${hand ? ` (${hand === 'L' ? 'left' : 'right'})` : ''}`;
  }
  if (key.startsWith('v:')) return `🗣 “${key.slice(2)}”`;
  if (key.startsWith('c:')) return `👏×${key.slice(2)}`;
  return key;
}
