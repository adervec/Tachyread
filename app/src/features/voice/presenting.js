// Presenting quality while reading aloud, from the webcam's face frames — on-device, nothing is
// recorded. Feed one frame per camera tick; summary() turns the run into 0–100 scores:
//   presence       share of frames with a face in view
//   eyeContact     share of frames facing the screen with the eyes open (looking at your audience):
//                  head turned less than ~FACING sideways, and not tilted away from the session's
//                  own resting pitch (reading off a screen already looks a little down)
//   headSteadiness how still the head is: 100 = rock steady, low = constant turning / nodding
//   expressiveness how much the brows, eyes and mouth corners MOVE — an animated face vs a frozen one
//   articulation   how far the jaw opens on average — mumbling shows as a barely moving jaw
//   overall        mean of the available scores
// Pure; see presenting.test.mjs. The constants are heuristic ceilings tuned by eye —
// ponytail: calibrate against SpeechImprover's clarity / expressiveness scores when both exist.
const EXPRESSION_SHAPES = ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'browDownLeft', 'browDownRight', 'mouthSmileLeft', 'mouthSmileRight', 'eyeWideLeft', 'eyeWideRight', 'mouthFrownLeft', 'mouthFrownRight'];
export const PRESENTING_SHAPES = [...EXPRESSION_SHAPES, 'jawOpen'];
const FACING = 0.12;      // |yaw| / pitch-from-rest (0 = dead centre, 0.5 = profile) that still counts as facing
const SWAY_FULL = 0.08;   // yaw/pitch standard deviation that scores 0 steadiness
const EXPR_LO = 0.02, EXPR_HI = 0.10; // mean shape std-dev: frozen → lively
const JAW_LO = 0.04, JAW_HI = 0.28;   // mean jawOpen while present: mumble → clear

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// frame: { present, facing?, yaw?, pitch?, eyesOpen?, shapes? } — yaw/pitch as offsets from centre.
export function presentingScorer() {
  let frames = 0;
  const seen = []; // [yaw, pitch, eyesOpen] per frame with a face
  const jaws = [];
  const shapeRuns = Object.fromEntries(EXPRESSION_SHAPES.map((k) => [k, []]));
  return {
    frame(f) {
      frames++;
      if (!f?.present) return;
      const yaw = typeof f.yaw === 'number' ? f.yaw : (f.facing === false ? 0.3 : 0);
      seen.push([yaw, typeof f.pitch === 'number' ? f.pitch : 0, f.eyesOpen !== false]);
      if (f.shapes) {
        for (const k of EXPRESSION_SHAPES) if (typeof f.shapes[k] === 'number') shapeRuns[k].push(f.shapes[k]);
        if (typeof f.shapes.jawOpen === 'number') jaws.push(f.shapes.jawOpen);
      }
    },
    summary() {
      if (!frames || !seen.length) return null;
      const yaws = seen.map((s) => s[0]), pitches = seen.map((s) => s[1]);
      const rest = median(pitches);
      const contact = seen.filter(([y, p, open]) => Math.abs(y) <= FACING && Math.abs(p - rest) <= FACING && open).length;
      const out = {
        frames,
        presence: clamp((seen.length / frames) * 100),
        eyeContact: clamp((contact / seen.length) * 100),
        headSteadiness: clamp((1 - Math.max(stdev(yaws), stdev(pitches)) / SWAY_FULL) * 100),
      };
      const runs = Object.values(shapeRuns).filter((r) => r.length >= 2);
      if (runs.length) out.expressiveness = clamp(((mean(runs.map(stdev)) - EXPR_LO) / (EXPR_HI - EXPR_LO)) * 100);
      if (jaws.length) out.articulation = clamp(((mean(jaws) - JAW_LO) / (JAW_HI - JAW_LO)) * 100);
      const parts = ['eyeContact', 'headSteadiness', 'expressiveness', 'articulation'].filter((k) => k in out);
      out.overall = clamp(mean(parts.map((k) => out[k])));
      return out;
    },
  };
}
