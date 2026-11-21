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
import { t } from '../i18n.js';

// Poses that read similarly to the detector — arming several from one group invites cross-fires.
const CONFUSION_GROUPS = [
  ['iLoveYou', 'horns', 'callMe'],
  ['pointUp', 'pointDown', 'pointLeft', 'pointRight'],
  ['victory', 'threeUp', 'fourUp'],
];

const gLabel = (k) => (k === 'openPalm' ? `✋ ${t('Open palm')}` : `${GESTURE_INFO[k]?.icon || ''} ${GESTURE_INFO[k]?.label || k}`.trim());
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
      add('error', 'hold', t("Hold-to-scroll can't use the open palm — it already drives the scroll joystick"));
      continue;
    }
    if (!GESTURE_INFO[r.gesture] || r.gesture === 'scroll' || r.gesture === 'wave' || r.gesture.startsWith('swipe')) {
      add('error', 'hold', r.dir === 'up'
        ? t("Hold-to-scroll up is set to “{gesture}”, which isn't a holdable pose — pick a held gesture", { gesture: r.gesture })
        : t("Hold-to-scroll down is set to “{gesture}”, which isn't a holdable pose — pick a held gesture", { gesture: r.gesture }));
      continue;
    }
    (hsByGesture[r.gesture] ||= []).push(r.dir);
  }
  for (const [k, dirs] of Object.entries(hsByGesture)) {
    if (dirs.length > 1) add('error', 'hold', t("{gesture} is set to hold-scroll BOTH up and down — one hold can't mean two directions", { gesture: gLabel(k) }));
    if (hold && hold === k) add('error', 'hold', t('{gesture} is both the hold-to-pause gesture and a hold-to-scroll gesture — one hold would pause AND scroll', { gesture: gLabel(k) }));
    if (gset[k] && gmap[k]) add('warn', 'hold', t('{gesture} is owned by hold-to-scroll, so its mapped command ({command}) will NOT fire — unmap it or pick another gesture', { gesture: gLabel(k), command: labelFor(gmap[k]) }));
  }

  // ── hold-to-pause vs mappings / joystick ────────────────────────────────────
  if (hold && hold !== 'openPalm' && gset[hold] && gmap[hold]) {
    add('warn', 'hold', t('{gesture} is the hold-to-pause gesture AND is mapped to {command} — the command fires while you hold to pause', { gesture: gLabel(hold), command: labelFor(gmap[hold]) }));
  }
  if (hold === 'openPalm' && gset.scroll) {
    add('info', 'hold', t('Hold-to-pause uses the open palm while the palm joystick is on — raising your palm pauses, and moving it also scrolls'));
  }

  // ── similar poses armed together ────────────────────────────────────────────
  for (const group of CONFUSION_GROUPS) {
    const on = group.filter((k) => gset[k]);
    if (on.length >= 2) add('warn', 'gestures', t('{gestures} are similar poses — the detector can confuse them, expect occasional cross-fires', { gestures: on.map(gLabel).join(' + ') }));
  }

  // ── per-hand overrides while "Distinguish hands" is off ─────────────────────
  if (!g.gestureHands) {
    const handed = [...new Set(Object.keys(g.gestureMap || {}).filter((k) => /:(L|R)$/.test(k) && g.gestureMap[k]).map((k) => k.split(':')[0]))];
    if (handed.length) add('info', 'gestures', t("Left/right overrides exist for {gestures} but “Distinguish hands” is off — they still apply; clear them if that's not wanted", { gestures: handed.map(gLabel).join(', ') }));
  }

  // ── voice phrases ───────────────────────────────────────────────────────────
  const vrows = (g.voiceCommands?.length ? g.voiceCommands : DEFAULT_VOICE_COMMANDS)
    .map((r, i) => ({ ...r, i, w: words(r.phrase) }))
    .filter((r) => r.on !== false && r.w.length && r.commandId);
  for (let a = 0; a < vrows.length; a++) {
    for (let b = a + 1; b < vrows.length; b++) {
      const A = vrows[a], B = vrows[b];
      if (A.w.join(' ') === B.w.join(' ')) {
        if (A.commandId !== B.commandId) add('error', 'voice', t('“{phrase}” is mapped twice ({first} and {second}) — only the first row fires', { phrase: A.phrase, first: labelFor(A.commandId), second: labelFor(B.commandId) }));
        else add('info', 'voice', t('“{phrase}” appears twice with the same action — remove one', { phrase: A.phrase }));
      } else {
        const sub = A.w.every((w) => B.w.includes(w)) ? [A, B] : B.w.every((w) => A.w.includes(w)) ? [B, A] : null;
        if (sub && sub[0].commandId !== sub[1].commandId) {
          add('warn', 'voice', t('Saying “{long}” also contains “{short}” — whichever row is first wins; use distinct words', { long: sub[1].phrase, short: sub[0].phrase }));
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
            ? t('Two sequences share the exact steps ({steps}) — only the first fires', { steps: A.st.join(' → ') })
            : t('Sequence {short} is the tail of {long} — the short one fires first and eats the chain, so the long one can never complete', { short: A.st.join(' → '), long: B.st.join(' → ') }));
      }
    }
  }
  for (const s of seqs) {
    const live = s.st.filter((step) => {
      if (step.startsWith('g:')) { const k = step.split(':')[1]; return gset[k] && gmap[k]; }
      if (step.startsWith('v:')) { const p = step.slice(2); return vrows.some((r) => r.phrase === p); }
      return false;
    });
    if (live.length) add('info', 'sequences', t.n('Sequence {sequence}: step {steps} also run their own mapping on every use — untick those mappings if they should only count inside the sequence', 'Sequence {sequence}: steps {steps} also run their own mapping on every use — untick those mappings if they should only count inside the sequence', live.length, { sequence: s.st.join(' → '), steps: live.join(', ') }));
  }

  // ── eye & face rows (summarized; the rows themselves show the details) ──────
  if (g.eyeGestures?.rows?.length) {
    const probs = validateEyeMappings(g.eyeGestures.rows);
    const errs = probs.filter((p) => p.level === 'error').length;
    const warns = probs.length - errs;
    if (errs) add('error', 'eyes', t.n('{n} eye/face mapping error — see the rows in the Eye & face section below', '{n} eye/face mapping errors — see the rows in the Eye & face section below', errs));
    else if (warns) add('warn', 'eyes', t.n('{n} eye/face mapping warning — see the rows in the Eye & face section below', '{n} eye/face mapping warnings — see the rows in the Eye & face section below', warns));
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return flags.sort((a, b) => rank[a.level] - rank[b.level]);
}
