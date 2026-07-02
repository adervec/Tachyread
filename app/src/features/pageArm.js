// SimpleClicker "arm" bridge. SimpleClicker (the sibling ../SimpleClicker repo) can expose a
// loopback HTTP endpoint (its "Remote arm (HTTP)" checkbox): GET /step runs one pass of the
// selected clicker's sequence — e.g. a click on a reader's next-page button — and responds when
// the pass has finished. The Grab wizard calls it to advance pages between screen captures, so
// capture and page-turning run hand-in-hand with no human in the loop.

export const DEFAULT_ARM_PORT = 8377;

const base = (port) => `http://127.0.0.1:${Number(port) || DEFAULT_ARM_PORT}`;

// Is the arm listening? (also warms up Chrome's private-network-access preflight)
export async function armPing(port) {
  try {
    const r = await fetch(`${base(port)}/ping`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Run one sequence pass (one page-turn). Resolves when the click sequence has finished;
// throws with the arm's message when it can't step (no steps, already running, stopped).
export async function armStep(port) {
  const r = await fetch(`${base(port)}/step`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(await r.text().catch(() => '') || `arm error ${r.status}`);
}
