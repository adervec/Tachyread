// Momentary "hold-to-pause": while a chosen hand gesture is held up, autoplay pauses; drop the
// gesture and it resumes. A short grace before resuming absorbs one-frame detection misses so
// playback doesn't judder. Pure state machine, frame-driven — App feeds it each camera frame and
// acts on the 'pause' / 'resume' it returns. See holdPause.test.mjs.

// MediaPipe's raw gesture category → our gesture-kind vocabulary.
export const RAW_TO_KIND = {
  Open_Palm: 'openPalm', Closed_Fist: 'fist', Victory: 'victory',
  Pointing_Up: 'pointUp', ILoveYou: 'iLoveYou', Thumb_Up: 'thumbUp', Thumb_Down: 'thumbDown',
};
export function rawToKind(raw) { return RAW_TO_KIND[raw] || null; }

export const HOLD_RESUME_GRACE_MS = 350;

export function createHoldPause({ graceMs = HOLD_RESUME_GRACE_MS } = {}) {
  let paused = false;   // did WE pause (so we know whether to resume)?
  let lostAt = null;    // when the gesture first went missing (start of the resume grace)

  return {
    // Call once per camera frame. `want` = the configured hold gesture kind ('' / null = off);
    // `raw` = this frame's raw gesture category (or null when no hand); `playing` = is autoplay on;
    // `now` = a timestamp. Returns 'pause', 'resume', or null.
    feed({ want, raw, playing, now }) {
      if (!want) { paused = false; lostAt = null; return null; }
      const active = rawToKind(raw) === want;
      if (active) {
        lostAt = null;
        if (!paused && playing) { paused = true; return 'pause'; }
        return null;
      }
      // gesture not present this frame
      if (paused) {
        if (lostAt == null) { lostAt = now; return null; }     // start the grace
        if (now - lostAt >= graceMs) { paused = false; lostAt = null; return 'resume'; }
      }
      return null;
    },
    isPaused: () => paused,
    reset() { paused = false; lostAt = null; },
  };
}
