// "Turn every biometric control off" — the patch behind the Biometric Control Feed's ✕.
//
// The feed is shown while ANY camera source is live, and eye gestures are a source in their own
// right: they bring the camera up even with every guard off. Clearing only the guards therefore
// closed the popup and let it re-open on the same frame, which read as a dead button. Extracted
// here so the set of sources is one list with a test, rather than an easily-incomplete literal.

// Flat boolean settings that each keep the camera alive.
export const CAMERA_SOURCE_KEYS = [
  'webcamAttention', 'webcamDoze', 'webcamAwayAlarm', 'webcamDistanceNudge', 'webcamFocusStats',
  'handGestures',
];

// Every source, off. Eye gestures live in a nested object, so its `on` flag is patched in place —
// replacing the whole object would drop the user's carefully-built gesture mappings.
export function cameraOffPatch(global) {
  const patch = {};
  for (const k of CAMERA_SOURCE_KEYS) patch[k] = false;
  const eg = global?.eyeGestures;
  if (eg?.on) patch.eyeGestures = { ...eg, on: false };
  return patch;
}

// Would the camera still be running after this patch? The check the ✕ has to satisfy.
export function anyCameraSourceOn(global) {
  if (!global) return false;
  if (global.eyeGestures?.on) return true;
  return CAMERA_SOURCE_KEYS.some((k) => !!global[k]);
}
