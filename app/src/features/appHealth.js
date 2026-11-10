// "New version ready" notice when the deployed build differs from the running one. The shared
// font.js (index.html) handles the other house standards (crash notice, storage persistence...)
// but its update notice waits for a service-worker change, and Tachyread's sw.js never changes
// between deploys, so this compares version.json instead. isNewBuild: see appHealth.test.mjs.
/* global __BUILD_SHA__ */

// True when the deployed build is a different, real build from the one running.
export const isNewBuild = (running, served) => !!running && !!served && running !== 'dev' && served !== running;

// One fixed bar, themed with the app's own colours; replaced in place when it fires again.
function bar(id, text, actions) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:99999;max-width:calc(100vw - 32px);display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-radius:8px;font:13px/1.4 inherit;box-shadow:0 4px 16px rgba(0,0,0,.3);background:var(--menu-bg,#222);color:var(--menu-fg,#eee);border:1px solid var(--divider,#555)';
    document.body.appendChild(el);
  }
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
  for (const [label, fn] of [...actions, ['Dismiss', () => el.remove()]]) {
    const b = Object.assign(document.createElement('button'), { textContent: label, type: 'button' });
    b.onclick = fn;
    el.appendChild(b);
  }
}

export function initAppHealth() {
  // version.json is written by the build (vite.config.js) and fetched network-first by sw.js.
  if (!import.meta.env.PROD) return;
  let shown = false;
  const check = async () => {
    if (shown || document.visibilityState === 'hidden') return;
    try {
      const v = await (await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })).json();
      if (!isNewBuild(__BUILD_SHA__, v?.sha)) return;
      shown = true;
      bar('app-update-bar', `New version of Tachyread ready (build ${v.build}).`, [['Reload now', () => location.reload()]]);
    } catch { /* offline or no version.json — try again later */ }
  };
  setTimeout(check, 15000);
  setInterval(check, 30 * 60000);
  document.addEventListener('visibilitychange', check);
}
