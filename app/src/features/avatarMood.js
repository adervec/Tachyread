// Avatar mood helpers: the typing-screen eye colour graded by consensus typing-speed standards
// (the same net-WPM bands as the run tiers: <30 beginner … 110+ exceptional), and the idle
// drowsiness staging (awake → drowsy as idle approaches → asleep). Pure — see avatarMood.test.mjs.

// Cold → hot as the net WPM climbs the consensus ladder. Each band: [floor, colour, tier label].
export const TYPING_EYE_TIERS = [
  [110, '#ff5c5c', 'Exceptional'],
  [90, '#ffd54f', 'Advanced'],
  [70, '#b58cff', 'Fast'],
  [50, '#3a86ff', 'Proficient'],
  [40, '#4fd8ff', 'Average'],
  [30, '#7ee2a0', 'Improving'],
  [0, '#9aa0a6', 'Beginner'],
];

export function typingEyeColor(netWpm) {
  const w = Math.max(0, Number(netWpm) || 0);
  const [, color, tier] = TYPING_EYE_TIERS.find(([floor]) => w >= floor) || TYPING_EYE_TIERS.at(-1);
  return { color, tier };
}

// Idle staging from the mode detector's idle fraction (0 = fully active, 1 = idle): the avatar is
// awake, then visibly DROWSY as idle approaches (eyelids droop, head nods), then ASLEEP once idle
// lands (zzz + counting sheep).
export function idleStage(idleFrac, isIdle) {
  if (isIdle) return 'asleep';
  if (idleFrac == null) return 'awake'; // no decay showing = fully active
  const f = Number(idleFrac);
  if (Number.isFinite(f) && f <= 0.35) return 'drowsy'; // the underline is nearly drained
  return 'awake';
}
