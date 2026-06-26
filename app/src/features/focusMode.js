// Focus mode: fullscreen the app and — on Chromium, via the Window Management API — black out every
// OTHER monitor with a dim cover window. The browser sandbox can't blur or touch other applications;
// it can only cover whole screens with OUR OWN windows. So this BLOCKS distractions, it doesn't blur
// the desktop behind. Degrades to app-fullscreen-only where the API/permission/pop-ups are missing.
// ponytail: cover windows need the window-management permission + pop-ups allowed; everything is
// wrapped so a refusal at any step just falls back instead of throwing.

function coverCss(dim) {
  // dim 1 → pure black; lower → dark grey. A window isn't see-through to the desktop, so this is a
  // solid dim panel (real translucency over other apps is impossible from the web).
  const light = Math.max(0, Math.round((1 - dim) * 45));
  return `margin:0;width:100vw;height:100vh;overflow:hidden;background:hsl(0 0% ${light}%);cursor:none;`;
}

export function paintCover(win, dim) {
  try {
    win.document.title = 'Tachyread — focus';
    win.document.body.style.cssText = coverCss(dim);
  } catch { /* window already closed */ }
}

export function repaintCovers(covers, dim) {
  (covers || []).forEach((w) => { if (w && !w.closed) paintCover(w, dim); });
}

// Returns { covers: Window[], reason } where reason explains any fallback (for a status message).
export async function enterFocus(rootEl, dim) {
  try { await rootEl?.requestFullscreen?.(); } catch { /* user may decline fullscreen */ }
  if (typeof window === 'undefined' || !window.getScreenDetails) return { covers: [], reason: 'unsupported' };
  let sd;
  try { sd = await window.getScreenDetails(); } catch { return { covers: [], reason: 'denied' }; }
  const others = sd.screens.filter((s) => s !== sd.currentScreen);
  if (!others.length) return { covers: [], reason: 'single' };
  const covers = [];
  for (const s of others) {
    const feats = `popup,left=${s.left},top=${s.top},width=${s.availWidth || s.width},height=${s.availHeight || s.height}`;
    const w = window.open('about:blank', '', feats);
    if (!w) continue; // pop-up blocked
    paintCover(w, dim);
    // Try to fullscreen the cover so it hides the taskbar too; if the browser refuses (no activation
    // in the new window), the screen-positioned pop-up already covers the work area.
    try { const p = w.document.documentElement.requestFullscreen?.(); p?.catch?.(() => {}); } catch { /* noop */ }
    covers.push(w);
  }
  return { covers, reason: covers.length ? 'ok' : 'blocked' };
}

export function exitFocus(covers) {
  (covers || []).forEach((w) => { try { if (w && !w.closed) w.close(); } catch { /* noop */ } });
  try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* noop */ }
}
