// Whole-profile conflict / overlap checker for the biometric setup. The per-row eye validation
// (validateEyeMappings) catches problems INSIDE one mapping list; this looks ACROSS the features —
// a gesture serving two masters (hold-to-scroll + a mapped command), colliding voice phrases, a
// sequence that shadows another, similar poses armed together — and returns human flags the
// Biometric Controls page shows at the top. Pure — see bioProfileCheck.test.mjs.
//
// Flags: { level: 'error' | 'warn' | 'info', area, message }
//   error = two configs actively fight — one of them will misfire or never fire
//   warn  = will work, but expect cross-fires / surprises
//   info  = worth knowing; deliberate setups can ignore it

import { DEFAULT_GESTURES, GESTURE_INFO } from './handGestures.js';
import { DEFAULT_GESTURE_MAP, DEFAULT_VOICE_COMMANDS, labelFor } from './commandRegistry.js';
import { activeHoldScrollRows } from './holdScroll.js';
import { validateEyeMappings } from './eyeGestures.js';

// Poses that read similarly to the detector — arming several from one group invites cross-fires.
const CONFUSION_GROUPS = [
  ['iLoveYou', 'horns', 'callMe'],
  ['pointUp', 'pointDown', 'pointLeft', 'pointRight'],
  ['victory', 'threeUp', 'fourUp'],
];

const gLabel = (k) => (k === 'openPalm' ? '✋ Open palm' : `${GESTURE_INFO[k]?.icon || ''} ${GESTURE_INFO[k]?.label || k}`.trim());
const words = (p) => String(p || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

export function checkBioProfile(g = {}) {
  const flags = [];
  const add = (level, area, message) => flags.push({ level, area, message });
  const gset = { ...DEFAULT_GESTURES, ...(g.handGestureSet || {}) };
  const gmap = { ...DEFAULT_GESTURE_MAP, ...(g.gestureMap || {}) };
  const hs = activeHoldScrollRows(g.holdScroll);
  const hold = g.holdPauseGesture || '';

  // ── hold-to-scroll ──────────────────────────────────────────────────────────
  const hsByGesture = {};
  for (const r of hs) {
    if (r.gesture === 'openPalm') {
      add('error', 'hold', 'Hold-to-scroll can\'t use the open palm — it already drives the scroll joystick');
      continue;
    }
    if (!GESTURE_INFO[r.gesture] || r.gesture === 'scroll' || r.gesture === 'wave' || r.gesture.startsWith('swipe')) {
      add('error', 'hold', `Hold-to-scroll ${r.dir} is set to “${r.gesture}”, which isn't a holdable pose — pick a held gesture`);
      continue;
    }
    (hsByGesture[r.gesture] ||= []).push(r.dir);
  }
  for (const [k, dirs] of Object.entries(hsByGesture)) {
    if (dirs.length > 1) add('error', 'hold', `${gLabel(k)} is set to hold-scroll BOTH up and down — one hold can't mean two directions`);
    if (hold && hold === k) add('error', 'hold', `${gLabel(k)} is both the hold-to-pause gesture and a hold-to-scroll gesture — one hold would pause AND scroll`);
    if (gset[k] && gmap[k]) add('warn', 'hold', `${gLabel(k)} is owned by hold-to-scroll, so its mapped command (${labelFor(gmap[k])}) will NOT fire — unmap it or pick another gesture`);
  }

  // ── hold-to-pause vs mappings / joystick ────────────────────────────────────
  if (hold && hold !== 'openPalm' && gset[hold] && gmap[hold]) {
    add('warn', 'hold', `${gLabel(hold)} is the hold-to-pause gesture AND is mapped to ${labelFor(gmap[hold])} — the command fires while you hold to pause`);
  }
  if (hold === 'openPalm' && gset.scroll) {
    add('info', 'hold', 'Hold-to-pause uses the open palm while the palm joystick is on — raising your palm pauses, and moving it also scrolls');
  }

  // ── similar poses armed together ────────────────────────────────────────────
  for (const group of CONFUSION_GROUPS) {
    const on = group.filter((k) => gset[k]);
    if (on.length >= 2) add('warn', 'gestures', `${on.map(gLabel).join(' + ')} are similar poses — the detector can confuse them, expect occasional cross-fires`);
  }

  // ── per-hand overrides while "Distinguish hands" is off ─────────────────────
  if (!g.gestureHands) {
    const handed = [...new Set(Object.keys(g.gestureMap || {}).filter((k) => /:(L|R)$/.test(k) && g.gestureMap[k]).map((k) => k.split(':')[0]))];
    if (handed.length) add('info', 'gestures', `Left/right overrides exist for ${handed.map(gLabel).join(', ')} but “Distinguish hands” is off — they still apply; clear them if that's not wanted`);
  }

  // ── voice phrases ───────────────────────────────────────────────────────────
  const vrows = (g.voiceCommands?.length ? g.voiceCommands : DEFAULT_VOICE_COMMANDS)
    .map((r, i) => ({ ...r, i, w: words(r.phrase) }))
    .filter((r) => r.on !== false && r.w.length && r.commandId);
  for (let a = 0; a < vrows.length; a++) {
    for (let b = a + 1; b < vrows.length; b++) {
      const A = vrows[a], B = vrows[b];
      if (A.w.join(' ') === B.w.join(' ')) {
        if (A.commandId !== B.commandId) add('error', 'voice', `“${A.phrase}” is mapped twice (${labelFor(A.commandId)} and ${labelFor(B.commandId)}) — only the first row fires`);
        else add('info', 'voice', `“${A.phrase}” appears twice with the same action — remove one`);
      } else {
        const sub = A.w.every((w) => B.w.includes(w)) ? [A, B] : B.w.every((w) => A.w.includes(w)) ? [B, A] : null;
        if (sub && sub[0].commandId !== sub[1].commandId) {
          add('warn', 'voice', `Saying “${sub[1].phrase}” also contains “${sub[0].phrase}” — whichever row is first wins; use distinct words`);
        }
      }
    }
  }

  // ── sequences ───────────────────────────────────────────────────────────────
  const seqs = (g.triggerSeqs || [])
    .map((s, i) => ({ ...s, i, st: (s?.steps || []).filter(Boolean) }))
    .filter((s) => s.on !== false && s.commandId && s.st.length >= 2);
  for (let a = 0; a < seqs.length; a++) {
    for (let b = 0; b < seqs.length; b++) {
      if (a === b) continue;
      const A = seqs[a], B = seqs[b];
      if (A.st.length > B.st.length) continue;
      if (A.st.length === B.st.length && a > b) continue; // flag an identical pair once
      const tail = B.st.slice(-A.st.length);
      if (A.st.every((s, k) => s === tail[k])) {
        // Either way the later/longer one is dead: the matcher consumes the buffer on first match.
        add('error', 'sequences',
          A.st.length === B.st.length
            ? `Two sequences share the exact steps (${A.st.join(' → ')}) — only the first fires`
            : `Sequence ${A.st.join(' → ')} is the tail of ${B.st.join(' → ')} — the short one fires first and eats the chain, so the long one can never complete`);
      }
    }
  }
  for (const s of seqs) {
    const live = s.st.filter((step) => {
      if (step.startsWith('g:')) { const k = step.split(':')[1]; return gset[k] && gmap[k]; }
      if (step.startsWith('v:')) { const p = step.slice(2); return vrows.some((r) => r.phrase === p); }
      return false;
    });
    if (live.length) add('info', 'sequences', `Sequence ${s.st.join(' → ')}: step${live.length > 1 ? 's' : ''} ${live.join(', ')} also run their own mapping on every use — untick those mappings if they should only count inside the sequence`);
  }

  // ── eye & face rows (summarized; the rows themselves show the details) ──────
  if (g.eyeGestures?.rows?.length) {
    const probs = validateEyeMappings(g.eyeGestures.rows);
    const errs = probs.filter((p) => p.level === 'error').length;
    const warns = probs.length - errs;
    if (errs) add('error', 'eyes', `${errs} eye/face mapping error${errs > 1 ? 's' : ''} — see the rows in the Eye & face section below`);
    else if (warns) add('warn', 'eyes', `${warns} eye/face mapping warning${warns > 1 ? 's' : ''} — see the rows in the Eye & face section below`);
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return flags.sort((a, b) => rank[a.level] - rank[b.level]);
}
