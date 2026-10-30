// Rolling video for reading aloud. A MediaRecorder file can't have its start cut off (the header
// lives in the first bytes), so we record short self-contained segments and drop whole old ones:
// keep the fewest newest segments that still cover `keepMs`.
export function trimSegments(segs, keepMs) {
  if (keepMs <= 0) return [];
  let total = segs.reduce((a, s) => a + s.ms, 0);
  let i = 0;
  while (i < segs.length - 1 && total - segs[i].ms >= keepMs) total -= segs[i++].ms;
  return i ? segs.slice(i) : segs;
}

export const totalMs = (segs) => segs.reduce((a, s) => a + s.ms, 0);
