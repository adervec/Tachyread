// Build exportable help documents from the help sections: a print-ready HTML (→ PDF via the browser's
// print dialog) and a self-contained narrated slideshow HTML (screenshots + spoken narration via the
// browser's speech synthesis, auto-advancing). Both are pure string builders — see helpExport.test.mjs.

import { sectionNarration } from './helpContent.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// First emoji-ish glyph in a title, for the slide poster. Falls back to a book.
function titleEmoji(title) {
  const m = String(title || '').match(/^\s*(\p{Extended_Pictographic})/u);
  return m ? m[1] : '📖';
}
function titleText(title) {
  return String(title || '').replace(/^\s*\p{Extended_Pictographic}\s*/u, '').trim() || String(title || '');
}
// Section body points (+ flattened keyboard groups) as an array of strings.
function sectionPoints(s) {
  const pts = [...(s.intro ? [s.intro] : []), ...(s.body || [])];
  for (const g of s.groups || []) pts.push(`${g.name}: ${g.keys.map(([k, d]) => `${k} — ${d}`).join('; ')}`);
  return pts;
}

// ── print / PDF ────────────────────────────────────────────────────────────────
// A clean, paginated HTML document. The caller opens it in a window and calls print() → the user
// picks "Save as PDF". Self-contained (inline CSS), so it prints identically anywhere.
export function printHtml(sections, { title = 'Tachyread — Help' } = {}) {
  const body = (sections || []).map((s) => `
    <section>
      <h2>${esc(s.title)}</h2>
      ${sectionPoints(s).map((p) => `<p>${esc(p)}</p>`).join('')}
    </section>`).join('');
  const toc = (sections || []).map((s) => `<li>${esc(s.title)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.55 Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 760px; margin: 0 auto; padding: 28px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: #666; margin: 0 0 18px; font-family: system-ui, sans-serif; font-size: 12px; }
  h2 { font-size: 17px; margin: 22px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; page-break-after: avoid; }
  section { page-break-inside: avoid; }
  p { margin: 5px 0; }
  ul.toc { columns: 2; font-family: system-ui, sans-serif; font-size: 12px; color: #444; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style></head><body>
  <h1>${esc(title)}</h1>
  <p class="sub">Generated from the in-app help. Print → Save as PDF.</p>
  <ul class="toc">${toc}</ul>
  ${body}
</body></html>`;
}

// ── narrated slideshow ──────────────────────────────────────────────────────────
// One slide per section: a poster (the section's screenshot if provided, else a themed title card),
// the key points, and spoken narration via speechSynthesis. Auto-advances when narration ends (with a
// timed fallback if speech is unavailable/blocked). Fully self-contained — no external requests.
export function slideshowHtml(sections, { title = 'Tachyread — Guided Tour' } = {}) {
  const slides = (sections || []).map((s) => ({
    title: titleText(s.title),
    emoji: titleEmoji(s.title),
    say: sectionNarration(s),
    points: sectionPoints(s),
    shot: typeof s.shot === 'string' && /^data:image\//.test(s.shot) ? s.shot : null,
  }));
  const data = JSON.stringify(slides).replace(/</g, '\\u003c'); // safe inside <script>

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0e1420; color: #eef2f8; font-family: system-ui, "Segoe UI", sans-serif; }
  #app { height: 100%; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #131b2b; border-bottom: 1px solid #26324a; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1; }
  header .prog { font-variant-numeric: tabular-nums; color: #9fb0cc; font-size: 13px; }
  main { flex: 1; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; padding: 20px; min-height: 0; }
  @media (max-width: 720px) { main { grid-template-columns: 1fr; } .poster { max-height: 34vh; } }
  .poster { border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 30px rgba(0,0,0,.4); background: linear-gradient(135deg,#25324f,#141d2e); position: relative; }
  .poster img { width: 100%; height: 100%; object-fit: contain; }
  .poster .card { text-align: center; padding: 24px; }
  .poster .card .em { font-size: 84px; line-height: 1; filter: drop-shadow(0 4px 12px rgba(0,0,0,.5)); }
  .poster .card .ct { margin-top: 14px; font-size: 22px; font-weight: 700; letter-spacing: .3px; }
  .panel { display: flex; flex-direction: column; min-height: 0; }
  .panel h2 { font-size: 22px; margin: 0 0 10px; }
  .panel ul { margin: 0; padding-left: 18px; overflow: auto; }
  .panel li { margin: 7px 0; line-height: 1.45; color: #d7e0ef; font-size: 14px; }
  footer { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #131b2b; border-top: 1px solid #26324a; }
  button { background: #2b3a5c; color: #eef2f8; border: 1px solid #3a4d76; border-radius: 8px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
  button:hover { background: #35476e; }
  button:disabled { opacity: .4; cursor: default; }
  .grow { flex: 1; }
  .say { color: #9fb0cc; font-size: 12px; max-width: 46ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dots { display: flex; gap: 5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #33436a; }
  .dot.on { background: #6ea0ff; }
</style></head><body>
<div id="app">
  <header><h1>${esc(title)}</h1><span class="prog" id="prog"></span></header>
  <main>
    <div class="poster" id="poster"></div>
    <div class="panel"><h2 id="stitle"></h2><ul id="points"></ul></div>
  </main>
  <footer>
    <button id="prev">‹ Prev</button>
    <button id="play">⏸ Pause</button>
    <button id="next">Next ›</button>
    <div class="dots" id="dots"></div>
    <span class="grow"></span>
    <span class="say" id="saytext"></span>
  </footer>
</div>
<script>
const SLIDES = ${data};
let i = 0, playing = true, timer = null;
const $ = (id) => document.getElementById(id);
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function render() {
  const s = SLIDES[i];
  $('poster').innerHTML = s.shot ? '<img alt="" src="'+s.shot+'">' : '<div class="card"><div class="em">'+esc(s.emoji)+'</div><div class="ct">'+esc(s.title)+'</div></div>';
  $('stitle').textContent = s.title;
  $('points').innerHTML = s.points.map(p => '<li>'+esc(p)+'</li>').join('');
  $('prog').textContent = (i+1)+' / '+SLIDES.length;
  $('saytext').textContent = s.say;
  $('dots').innerHTML = SLIDES.map((_,k)=>'<span class="dot'+(k===i?' on':'')+'"></span>').join('');
  $('prev').disabled = i===0;
}
function speak(onDone) {
  if (timer) { clearTimeout(timer); timer = null; }
  const s = SLIDES[i];
  const fallback = Math.max(3500, s.say.length * 55);
  try {
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s.say);
      u.rate = 1; u.onend = () => onDone && onDone();
      // Safety net if onend never fires (some engines).
      timer = setTimeout(() => onDone && onDone(), fallback + 4000);
      speechSynthesis.speak(u);
      return;
    }
  } catch (e) {}
  timer = setTimeout(() => onDone && onDone(), fallback);
}
function advance() { if (i < SLIDES.length - 1) go(i+1); else setPlaying(false); }
function go(n) {
  i = Math.max(0, Math.min(SLIDES.length-1, n));
  render();
  if (playing) speak(() => { if (playing) advance(); });
  else if (window.speechSynthesis) speechSynthesis.cancel();
}
function setPlaying(p) {
  playing = p; $('play').textContent = p ? '⏸ Pause' : '▶ Play';
  if (p) go(i); else { if (timer) clearTimeout(timer); if (window.speechSynthesis) speechSynthesis.cancel(); }
}
$('next').onclick = () => go(i+1);
$('prev').onclick = () => go(i-1);
$('play').onclick = () => setPlaying(!playing);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') go(i+1);
  else if (e.key === 'ArrowLeft') go(i-1);
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
});
render();
// Start narrating (a user gesture may be needed for audio; controls still work regardless).
setPlaying(true);
</script>
</body></html>`;
}
