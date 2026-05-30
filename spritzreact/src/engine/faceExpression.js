// Procedural face expression model — ported from SPRITZApp/MainWindow.xaml.cs
// (GetFaceExpressionParams / GetFaceTier / ApplyFaceExpression). Faces react to the
// reader's effective WPM: lids open, brows raise/arch, the mouth curves into a smile,
// and the irises shift hue / gain glow as speed climbs through 8 tiers.

// Shared eye geometry (FaceRefs constants in the WPF source).
export const RIG = Object.freeze({
  W: 130,
  H: 165,
  LCx: 37,
  RCx: 93,
  ECy: 82,
  ScR: 15, // sclera radius
  IrisR: 10,
  PupilR: 4.5,
  GlowR: 16,
  MaxOffset: 10 - 4.5, // 5.5px pupil travel
});

// Keyframes: [wpm, lidDroop, browOff, browArch, mouthCtrl, [r,g,b], glowRadius]
// lidDroop 0=open..1=closed; browOff/Arch negative=raised; mouthCtrl negative=smile.
const KF = [
  [0, 0.78, +6, +2, +12, [110, 95, 60], 0],
  [100, 0.6, +4, +1, +7, [120, 105, 65], 0],
  [250, 0.4, +2, 0, +3, [110, 115, 75], 0],
  [400, 0.2, 0, 0, 0, [90, 115, 85], 0],
  [550, 0.07, -5, -3, -5, [190, 140, 30], 0],
  [700, 0.02, -9, -5, -10, [70, 190, 90], 2],
  [800, 0.0, -12, -6, -13, [66, 165, 245], 6],
  [1000, 0.0, -14, -7, -15, [66, 165, 245], 6],
];

export function faceTier(wpm) {
  if (wpm >= 1000) return 7;
  if (wpm >= 800) return 6;
  if (wpm >= 700) return 5;
  if (wpm >= 550) return 4;
  if (wpm >= 400) return 3;
  if (wpm >= 250) return 2;
  if (wpm >= 100) return 1;
  return 0;
}

const lerp = (a, b, t) => a + (b - a) * t;
const rgbStr = ([r, g, b]) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

// Interpolate the expression params for a given WPM.
export function faceExpression(wpm) {
  wpm = Math.max(0, wpm || 0);
  const tier = faceTier(wpm);
  const last = KF[KF.length - 1];
  if (wpm >= last[0]) {
    return { lidDroop: last[1], browOff: last[2], browArch: last[3], mouthCtrl: last[4], iris: last[5], glow: last[6], tier };
  }
  for (let i = 1; i < KF.length; i++) {
    if (wpm <= KF[i][0]) {
      const a = KF[i - 1];
      const b = KF[i];
      const t = (wpm - a[0]) / (b[0] - a[0]);
      return {
        lidDroop: lerp(a[1], b[1], t),
        browOff: lerp(a[2], b[2], t),
        browArch: lerp(a[3], b[3], t),
        mouthCtrl: lerp(a[4], b[4], t),
        iris: [lerp(a[5][0], b[5][0], t), lerp(a[5][1], b[5][1], t), lerp(a[5][2], b[5][2], t)],
        glow: lerp(a[6], b[6], t),
        tier,
      };
    }
  }
  const f = KF[0];
  return { lidDroop: f[1], browOff: f[2], browArch: f[3], mouthCtrl: f[4], iris: f[5], glow: f[6], tier: 0 };
}

// SVG eyelid polygon points (mirrors SetEyelidDroop): a domed lid that lowers with droop.
export function lidPoints(cx, cy, r, droop) {
  const sclTop = cy - r;
  const droopY = Math.min(cy + r, sclTop + droop * (2 * r));
  const r7 = r * 0.7;
  return [
    [cx - r, cy],
    [cx - r7, cy - r7],
    [cx, sclTop],
    [cx + r7, cy - r7],
    [cx + r, cy],
    [cx + r, droopY],
    [cx - r, droopY],
  ]
    .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
}

// Brow polyline points. side: 'L' uses 18/37/55, 'R' uses 75/93/112.
export function browPoints(side, browOff, browArch) {
  const base = side === 'L' ? [18, 37, 55] : [75, 93, 112];
  return [
    [base[0], 62 + browOff],
    [base[1], 58 + browOff + browArch],
    [base[2], 62 + browOff],
  ]
    .map((p) => `${p[0]},${p[1].toFixed(1)}`)
    .join(' ');
}

// Mouth cubic bezier path (mirrors the WPF BezierSegment driven by MouthCtrl).
export function mouthPath(mouthCtrl) {
  const y = 126 + mouthCtrl;
  return `M 42 126 C 55 ${y.toFixed(1)} 75 ${y.toFixed(1)} 88 126`;
}

export const irisColor = rgbStr;
