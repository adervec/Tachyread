// Eye gestures as a hands-free control: deliberate blinks, winks (left and right are different
// gestures) and eye rolls, each mapped to a command by how LONG you held it.
//
// The whole design problem here is that eyes are not a button. They blink ~15 times a minute on
// their own, they saccade constantly while reading, and none of that is meant as a command. So:
//
//   • Duration floor. A spontaneous blink is 100–400 ms. Nothing under DELIBERATE_MS counts, and the
//     editor won't let a mapping start below it — a "quick blink" trigger would fire while you read.
//   • Asymmetry for winks. A natural blink closes both lids together. A wink only counts if the
//     other eye stayed clearly open for most of the hold (WINK_MARGIN).
//   • Rolls need a near-full revolution. Reading is horizontal sweeps and vertical line jumps; a
//     ~300° circuit at a decent radius is not something eyes do by accident.
//   • A refractory pause after every fire, so one long hold can't machine-gun a command, and the
//     recovery blink at the end of a hold isn't read as the next gesture.
//
// Ranges are matched on RELEASE (you can't know a hold's length until it ends), which is why the
// audio cue matters: it tells you live which window you're in, so you can let go at the right time.
//
// Pure and framework-free — feed it samples, it emits events. See eyeGestures.test.mjs.

export const EYE_KINDS = [
  { id: 'blink', label: 'Both eyes (blink)', icon: '😑' },
  { id: 'winkL', label: 'Left eye only (wink)', icon: '😉' },
  { id: 'winkR', label: 'Right eye only (wink)', icon: '🙂' },
  { id: 'rollCW', label: 'Eye roll — clockwise', icon: '🔃' },
  { id: 'rollCCW', label: 'Eye roll — anticlockwise', icon: '🔄' },
];
export const EYE_KIND_IDS = EYE_KINDS.map((k) => k.id);

export const DELIBERATE_MS = 450;  // below this it's a natural blink, not a command
export const MAX_HOLD_MS = 5000;   // a hold longer than this is you resting your eyes, not signalling
export const REFRACTORY_MS = 700;  // quiet period after a fire
export const WINK_MARGIN = 0.35;   // how much more closed one eye must be than the other
export const MIN_RANGE_MS = 120;   // a window narrower than this is unhittable in practice
export const ROLL_TURN = 5.2;      // radians of travel for a roll (~300°)
export const ROLL_RADIUS = 0.17;   // how far from centre the iris must swing (normalized eye units)

// ── mapping validation ──────────────────────────────────────────────────────────────────────────
// rows: [{ kind, minMs, maxMs, commandId, on }]. Returns one entry per problem found:
//   { index, level: 'error'|'warn', code, message }
// Overlapping ranges on the same gesture are the important one — two commands competing for the
// same hold means whichever you meant, you get a coin flip. Those are errors and the UI refuses to
// arm them; the matcher independently takes the first enabled match so runtime is at least
// deterministic if a bad set ever slips through (e.g. hand-edited storage).
export function validateEyeMappings(rows) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((r, i) => {
    const min = Number(r?.minMs), max = Number(r?.maxMs);
    if (!EYE_KIND_IDS.includes(r?.kind)) out.push({ index: i, level: 'error', code: 'kind', message: 'Pick an eye gesture' });
    if (!r?.commandId) out.push({ index: i, level: 'error', code: 'command', message: 'Pick an action' });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      out.push({ index: i, level: 'error', code: 'range', message: 'Hold range must be two numbers' });
      return;
    }
    if (max <= min) out.push({ index: i, level: 'error', code: 'range', message: 'The longest hold must be more than the shortest' });
    else if (max - min < MIN_RANGE_MS) out.push({ index: i, level: 'warn', code: 'narrow', message: `A window under ${MIN_RANGE_MS}ms is very hard to hit` });
    if (min < DELIBERATE_MS) out.push({ index: i, level: 'error', code: 'floor', message: `Under ${DELIBERATE_MS}ms is natural blinking — it would fire while you read` });
    if (max > MAX_HOLD_MS) out.push({ index: i, level: 'error', code: 'ceiling', message: `Over ${MAX_HOLD_MS / 1000}s is resting your eyes, not signalling` });
  });
  // Overlap, per gesture kind, among enabled + otherwise-sane rows.
  const usable = list.map((r, i) => ({ r, i })).filter(({ r }) => r?.on !== false && EYE_KIND_IDS.includes(r?.kind)
    && Number.isFinite(Number(r.minMs)) && Number.isFinite(Number(r.maxMs)) && Number(r.maxMs) > Number(r.minMs));
  for (const kind of EYE_KIND_IDS) {
    const same = usable.filter(({ r }) => r.kind === kind).sort((a, b) => a.r.minMs - b.r.minMs);
    for (let k = 1; k < same.length; k++) {
      const prev = same[k - 1].r, cur = same[k].r;
      if (Number(cur.minMs) < Number(prev.maxMs)) {
        out.push({
          index: same[k].i,
          level: 'error',
          code: 'overlap',
          message: `Overlaps another ${kind} mapping (${prev.minMs}–${prev.maxMs}ms) — one hold can't mean two things`,
        });
      }
    }
  }
  return out;
}

export function eyeMappingsUsable(rows) {
  return validateEyeMappings(rows).every((p) => p.level !== 'error');
}

// The enabled row whose window contains this hold — first match wins, so behaviour is defined even
// if an overlapping set somehow got saved.
export function matchEyeHold(rows, kind, ms) {
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r && r.on !== false && r.kind === kind
    && ms >= Number(r.minMs) && ms <= Number(r.maxMs) && r.commandId) || null;
}

// The window you are heading for, for the live cue: the enabled row for this gesture with the
// smallest min above the current hold. Null once you're past them all.
export function nextEyeWindow(rows, kind, ms) {
  if (!Array.isArray(rows)) return null;
  return rows
    .filter((r) => r && r.on !== false && r.kind === kind && Number(r.minMs) > ms)
    .sort((a, b) => Number(a.minMs) - Number(b.minMs))[0] || null;
}

// ── detector ────────────────────────────────────────────────────────────────────────────────────
// Feed it push({ t, blinkL, blinkR, irisX, irisY }) — blink scores 0..1 (1 = shut), iris position
// 0..1 within the eye opening (from eyeTracking's gazeFeatures). Emits:
//   onGesture({ kind, ms, row })  — a completed gesture that matched a mapping
//   onIgnored({ kind, ms, why })  — a completed gesture that matched nothing (feeds the UI's "you
//                                   held 620ms, no window there" hint — the fastest way to learn it)
//   onHold({ kind, ms, inWindow, next }) — every sample during a hold, for the meter and the cue
//   onCue('enter'|'leave'|'over') — cue transitions the UI turns into beeps
export function createEyeGestureDetector({
  getRows, onGesture, onIgnored, onHold, onCue,
  closeThreshold = 0.5, deliberateMs = DELIBERATE_MS, refractoryMs = REFRACTORY_MS,
} = {}) {
  let hold = null;      // { kind, start, both, asymSum, n }
  let quietUntil = 0;
  let lastInWindow = null;
  let roll = null;      // { start, angle, last, turned }

  const rows = () => (typeof getRows === 'function' ? getRows() || [] : []);

  function finishHold(t) {
    if (!hold) return;
    const ms = t - hold.start;
    const h = hold;
    hold = null;
    lastInWindow = null;
    if (ms < deliberateMs) return;                    // natural blink — say nothing
    if (ms > MAX_HOLD_MS) { onIgnored?.({ kind: h.kind, ms, why: 'too long' }); return; }
    // A "wink" whose other eye was closing too is just a blink you did lopsidedly.
    let kind = h.kind;
    if (kind !== 'blink' && h.n && h.asymSum / h.n < WINK_MARGIN) kind = 'blink';
    const row = matchEyeHold(rows(), kind, ms);
    quietUntil = t + refractoryMs;
    if (row) onGesture?.({ kind, ms, row });
    else onIgnored?.({ kind, ms, why: 'no window' });
  }

  function push(s) {
    const t = Number(s?.t) || 0;
    const bl = Number(s?.blinkL) || 0;
    const br = Number(s?.blinkR) || 0;
    const L = bl > closeThreshold, R = br > closeThreshold;

    // Eyes shut → blink/wink tracking; the roll accumulator can't survive a blink.
    if (L || R) {
      roll = null;
      if (t < quietUntil) return;
      const kindNow = L && R ? 'blink' : L ? 'winkL' : 'winkR';
      if (!hold) hold = { kind: kindNow, start: t, both: L && R, asymSum: 0, n: 0 };
      // Both eyes shut at any point in the hold makes it a blink, whatever it started as.
      else if (kindNow === 'blink') hold.kind = 'blink';
      hold.asymSum += Math.abs(bl - br);
      hold.n += 1;
      const ms = t - hold.start;
      const kind = hold.kind !== 'blink' && hold.n && hold.asymSum / hold.n < WINK_MARGIN ? 'blink' : hold.kind;
      const inWindow = ms >= deliberateMs ? matchEyeHold(rows(), kind, ms) : null;
      const next = nextEyeWindow(rows(), kind, ms);
      onHold?.({ kind, ms, inWindow, next });
      // Cue transitions: a tick as you enter a window, a lower one as you fall out of the last.
      if (inWindow && inWindow !== lastInWindow) onCue?.('enter');
      else if (!inWindow && lastInWindow) onCue?.(next ? 'leave' : 'over');
      lastInWindow = inWindow;
      return;
    }

    if (hold) { finishHold(t); return; }
    if (t < quietUntil) { roll = null; return; }

    // Both eyes open: watch for a rolling sweep of the iris around the eye. Angles are accumulated
    // as signed deltas, so a back-and-forth reading sweep cancels out instead of adding up.
    const x = Number(s?.irisX), y = Number(s?.irisY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { roll = null; return; }
    const dx = x - 0.5, dy = y - 0.5;
    const r = Math.hypot(dx, dy);
    if (r < ROLL_RADIUS) { roll = null; return; }     // too near centre for the angle to mean much
    const a = Math.atan2(dy, dx);
    if (!roll || t - roll.last > 700) { roll = { start: t, angle: a, last: t, turned: 0 }; return; }
    let d = a - roll.angle;
    while (d > Math.PI) d -= 2 * Math.PI;             // shortest way round
    while (d < -Math.PI) d += 2 * Math.PI;
    roll.turned += d;
    roll.angle = a;
    roll.last = t;
    const ms = t - roll.start;
    if (Math.abs(roll.turned) >= ROLL_TURN && ms <= MAX_HOLD_MS) {
      const kind = roll.turned > 0 ? 'rollCW' : 'rollCCW';
      roll = null;
      quietUntil = t + refractoryMs;
      if (ms < deliberateMs) return;                  // a flick that fast wasn't a roll
      const row = matchEyeHold(rows(), kind, ms);
      if (row) onGesture?.({ kind, ms, row });
      else onIgnored?.({ kind, ms, why: 'no window' });
    }
  }

  return {
    push,
    reset() { hold = null; roll = null; quietUntil = 0; lastInWindow = null; },
    holding: () => (hold ? { kind: hold.kind, start: hold.start } : null),
  };
}
