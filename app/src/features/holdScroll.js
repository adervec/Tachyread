// Hold-to-scroll: map scroll UP and scroll DOWN each to "holding gesture X for more than Y
// seconds" — once the hold crosses its threshold the Lines pane scrolls steadily in that
// direction until the gesture is dropped. Momentary, like hold-to-pause: nothing toggles, the
// scroll lives exactly as long as the hold. A short grace absorbs one-frame detection misses.
//
// Config rows live in global.holdScroll: [{ dir: 'up'|'down', gesture, secs, on }]. A gesture
// used here is OWNED by hold-to-scroll — its one-shot command mapping (gestureMap) is suppressed,
// otherwise the mapped command would fire during every hold (the profile checker explains this).
// Pure, frame-driven — see holdScroll.test.mjs.

export const HOLD_SCROLL_SPEED = 0.55;      // scroll velocity while active (joystick full = 1)
export const HOLD_SCROLL_GRACE_MS = 300;    // gesture may vanish this long without ending the hold
export const HOLD_SCROLL_MIN_SECS = 0.3;
export const HOLD_SCROLL_MAX_SECS = 5;
export const HOLD_SCROLL_DEFAULT_SECS = 1;

// Canonical two-row shape for the settings UI: exactly one 'up' and one 'down' row, folding in
// whatever (possibly partial/legacy) list was stored. gesture '' = that direction is off.
export function holdScrollRows(stored) {
  const list = Array.isArray(stored) ? stored : [];
  return ['up', 'down'].map((dir) => {
    const r = list.find((x) => x && x.dir === dir) || {};
    return { dir, gesture: r.gesture || '', secs: clampHoldSecs(r.secs), on: r.on !== false };
  });
}

export function clampHoldSecs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return HOLD_SCROLL_DEFAULT_SECS;
  return Math.max(HOLD_SCROLL_MIN_SECS, Math.min(HOLD_SCROLL_MAX_SECS, n));
}

// The enabled rows that actually name a gesture — what the runtime and the profile checker match.
export function activeHoldScrollRows(stored) {
  return holdScrollRows(stored).filter((r) => r.on !== false && r.gesture);
}

// Is this gesture kind owned by hold-to-scroll (so its one-shot mapping must not fire)?
export function holdScrollOwns(stored, kind) {
  return !!kind && activeHoldScrollRows(stored).some((r) => r.gesture === kind);
}

// Frame-driven controller. feed({ rows, kind, now }) once per camera frame with the RESOLVED pose
// kind (null when no hand / no pose); returns the scroll velocity to apply this frame:
// negative = up, positive = down, 0 = inactive. Threshold crossing needs a continuous hold of the
// row's `secs`; a lapse longer than the grace resets the clock.
export function createHoldScroll({ graceMs = HOLD_SCROLL_GRACE_MS, speed = HOLD_SCROLL_SPEED } = {}) {
  let held = null;   // { kind, start }
  let lostAt = null; // when the pose first went missing (grace window)
  return {
    feed({ rows, kind, now }) {
      const active = activeHoldScrollRows(rows);
      if (!active.length) { held = null; lostAt = null; return 0; }
      const row = kind ? active.find((r) => r.gesture === kind) : null;
      if (row) {
        if (!held || held.kind !== kind) held = { kind, start: now };
        lostAt = null;
      } else if (held) {
        if (lostAt == null) lostAt = now;               // start the grace
        else if (now - lostAt >= graceMs) { held = null; lostAt = null; }
      }
      if (!held) return 0;
      const r = active.find((x) => x.gesture === held.kind);
      if (!r || now - held.start < r.secs * 1000) return 0;
      return r.dir === 'up' ? -speed : speed;
    },
    activeKind: () => (held ? held.kind : null),
    reset() { held = null; lostAt = null; },
  };
}
