// Pose table for the avatars' 3D hands: per-finger curl (0 straight → 1 fully folded), thumb
// curl, finger spread and a wrist tilt. Pure data + lookups so the rig (components/Hands3D.jsx)
// only has to damp joints toward whatever these say. Finger order is index → pinky.

const P = (curl, thumb, spread, wrist = [0, 0, 0]) => ({ curl, thumb, spread, wrist });

export const HAND_POSES = {
  // Resting / activity poses
  relaxed: P([0.28, 0.32, 0.34, 0.36], 0.25, 0.12),
  open: P([0, 0, 0, 0], 0.1, 0.3),
  typing: P([0.45, 0.5, 0.5, 0.45], 0.35, 0.06, [0.25, 0, 0]),
  reading: P([0.2, 0.24, 0.26, 0.3], 0.2, 0.18),
  sweep: P([0.1, 0.12, 0.14, 0.16], 0.15, 0.34, [0, 0, 0.18]),
  listen: P([0.35, 0.38, 0.4, 0.42], 0.3, 0.1, [0, 0, -0.2]),
  // Biometric flashes — the pose the camera just saw, mirrored on the avatar
  fist: P([1, 1, 1, 1], 0.85, 0),
  thumbUp: P([1, 1, 1, 1], 0, 0, [0, 0, -0.15]),
  thumbDown: P([1, 1, 1, 1], 0, 0, [Math.PI, 0, 0.15]),
  point: P([0, 1, 1, 1], 0.8, 0),
  victory: P([0, 0, 1, 1], 0.85, 0.45),
  horns: P([0, 1, 1, 0], 0.85, 0.3),
  shaka: P([1, 1, 1, 0], 0, 0.35),
  ily: P([0, 1, 1, 0], 0, 0.32),
  pinch: P([0.75, 0.1, 0.1, 0.1], 0.75, 0.2),
  wave: P([0.05, 0.05, 0.05, 0.05], 0.1, 0.4, [0, 0, 0.3]),
  clap: P([0.15, 0.15, 0.15, 0.15], 0.2, 0.05, [0, 0.5, 0]),
  mic: P([0.6, 0.65, 0.68, 0.7], 0.55, 0.08, [0.2, 0, 0]),
  three: P([0, 0, 0, 1], 0.9, 0.3),
  four: P([0, 0, 0, 0], 0.9, 0.28),
};

// The emoji the biometric bus publishes → the pose to strike. Everything the gesture set can
// report has an entry; anything unrecognised just flashes an open palm.
const EMOJI_POSE = {
  '👍': 'thumbUp', '👎': 'thumbDown', '✊': 'fist', '✌': 'victory', '✌️': 'victory',
  '☝': 'point', '☝️': 'point', '👆': 'point', '👇': 'point', '☜': 'point', '☞': 'point',
  '👈': 'sweep', '👉': 'sweep', '👋': 'wave', '🤟': 'ily', '🤘': 'horns', '🤙': 'shaka',
  '🤏': 'pinch', '👏': 'clap', '🎤': 'mic', '✋': 'open', '🖐': 'open', '🤚': 'open',
  '3️⃣': 'three', '4️⃣': 'four',
};

export function poseIdFor(emoji) {
  if (!emoji) return null;
  return EMOJI_POSE[emoji] || EMOJI_POSE[emoji.replace(/️/g, '')] || 'open';
}

// The resting pose an activity settles into between flashes.
export function activityHandPose(activity, asleep = false) {
  if (asleep) return 'relaxed';
  switch (activity) {
    case 'typing': return 'typing';
    case 'scroll': return 'open';
    case 'para': case 'page': case 'jump': return 'sweep';
    case 'listen': case 'speak': return 'listen';
    case 'word': case 'line': return 'reading';
    default: return 'relaxed';
  }
}
