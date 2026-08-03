// Tiny event bus for avatar hand poses: App publishes biometric moments (a detected hand gesture,
// the scroll joystick, a clap, a voice command) and every mounted Avatar mirrors them on its
// floating hands — no React plumbing through five component layers for a 1.5s flourish.
const subs = new Set();

export function publishHandPose(pose) {
  for (const fn of subs) { try { fn(pose); } catch { /* a dead subscriber never blocks the rest */ } }
}
export function subscribeHandPose(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
