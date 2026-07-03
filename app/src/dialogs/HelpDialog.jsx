import { useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';

// In-app help: every feature, searchable. Sections are plain data so the search can filter on
// full text; keep entries short and task-oriented ("how do I…"), not spec-like.
const SECTIONS = [
  {
    id: 'start', title: '🚀 Getting started',
    body: [
      'Open a book with File → Open Document (.pdf, .epub, .docx, .txt, .md), paste text from the clipboard (Ctrl+B), or capture it from anything on screen with Grab Text (OCR).',
      'The Fast Reader pane flashes one word at a time at your WPM (Space plays/pauses); the Lines pane shows the text in context. Toggle panes from the bar at the top (ToC, Faces/Stats, Index, Fast Reader, Lines).',
      'Everything you read is tracked per book: position, coverage, pace. Close the app and your session restores.',
    ],
  },
  {
    id: 'reading', title: '📖 Ways to read',
    body: [
      'Auto-play (RSVP): press Space. The word pane paces you at the WPM slider; the adaptive pacer (ADAPT) can adjust it from comprehension checks.',
      'Manually: arrow keys step words (←→) and lines (↑↓); Ctrl+↑↓ hops paragraphs; PgUp/PgDn pages by a screenful.',
      'Scroll-to-read: turn on SCROLL in the controls bar, then just scroll the Lines pane like any page — whatever passes the top edge counts as read, and your WPM is measured from your real pace.',
      'Read-aloud (TTS): the voice reads and drives the position. Speaking mode advances when YOU read aloud (speech recognition). Typing mode advances by typing the text.',
      'The mode chip in the progress row shows how the app currently thinks you are reading (auto, line-by-line, scrolling, peeking…).',
    ],
  },
  {
    id: 'wpm', title: '⏱ WPM & progress tracking',
    body: [
      '"Reading now" is your live pace over the recent window; "session efficiency" is new words actually read per active minute — re-reading, skims and idle time lower it honestly.',
      'Jumps (ToC, Find, Go-to) are never counted as reading. Deliberate forward moves (line/paragraph/page-down/scroll) credit the text you passed.',
      'Coverage (📖 %) is how much of the countable book you have actually read — front/back matter can be excluded via skip ranges.',
      'Stats menu: Statistics, Progress Detail, Regression Report, Attention Check, and Reading History keep the long-term numbers.',
    ],
  },
  {
    id: 'typing', title: '⌨ Typing practice',
    body: [
      'Typing menu → Typing Practice types your book forward from the reading position; finish a run and Continue to count it as read, or Discard to return.',
      'A run starts on your first keystroke (or ▶ Start for a Ready·Set·Go). It ends at the limit, on End run, or after 5s idle.',
      'Per-character feedback stays on completed words: green = correct, red = wrong, underlined = never typed, dim red = extra characters.',
      'The results screen shows an examinable chart of raw, effective and burst WPM plus accuracy — hover it to inspect any moment of the run.',
      'Drills (Mavis-style rows, bigrams, numbers…) live in the mode dropdown; Typing Plans chains sets into workouts; Flow Writer and Dictation are separate output games.',
      'Typing Settings (Typing menu) holds case sensitivity, punctuation stripping and timeouts.',
    ],
  },
  {
    id: 'train', title: '🏋 Training drills',
    body: [
      'Eye Warmup: an 8-drill guided routine (pursuit, saccades, peripheral, focus, rest) — a ~3 minute warmup before reading.',
      'Span Drill: flashes a run of words for one glance and widens it as you keep up — trains words-per-fixation.',
      'Vocabulary: collects words you look up into a spaced-repetition deck.',
      'Take a Break Now and the comfort monitor (20-20-20 microbreaks) protect your eyes on long sessions.',
    ],
  },
  {
    id: 'grab', title: '📷 Grab Text (OCR) & the SimpleClicker arm',
    body: [
      'File → Grab Text captures pages from a shared screen/window, a document camera, or uploaded images, then OCRs them (language comes from Settings → Application Settings → Document language).',
      'Auto (timed) grabs on an interval; Watch (continuous) grabs each new page the moment it settles — just page through your reader.',
      'Hands-free: run SimpleClicker (the companion app) with "Remote arm (HTTP)" enabled, drop its marker on your reader\'s next-page button, and tick 🦾 SimpleClicker arm in the wizard — each grab turns the page for you and capture stops by itself at the end of the document.',
    ],
  },
  {
    id: 'gestures', title: '🖐 Hand gestures & webcam',
    body: [
      'Hand gestures (Application Settings): an open palm is a scroll joystick — hold it above/below your calibrated rest height to scroll the Lines pane, farther = faster. A wave toggles play/pause; optional thumb up/down (WPM ±25), fist (pause) and victory (next paragraph) gestures can each be enabled separately.',
      'Calibrate your palm\'s rest/top/bottom heights from Application Settings → Calibrate hand range.',
      'Webcam guards (all optional, all on-device): pause when you look away, stop read-aloud when you doze, away alarms, posture nudges, and focus analytics. Frames never leave your device.',
    ],
  },
  {
    id: 'audio', title: '🔊 Audio',
    body: [
      'Audio menu: the Audiobook Manager records/plays per-line narration; the Text-to-Speech Reader is a standalone TTS popup; Ambient Sound plays a low soundscape under your reading.',
      'Audio Settings holds the TTS voice & rate (the default voice follows your document language), the speak-along follow mode, and the auto-stop timer.',
      'Voice commands ("play", "pause", "next", "back") and clap detection toggle from VOICE COMMAND in the controls bar.',
      'Listen with the screen off: read-aloud keeps playing when you lock the phone or switch apps, and your lock-screen / notification media controls (play·pause·next·previous) drive it — next/previous jump paragraphs. Only read-aloud keeps going in the background; visual fast-reading pauses when the text isn\'t on screen.',
    ],
  },
  {
    id: 'fonts', title: '🗛 Fonts & themes',
    body: [
      'Settings → Font Manager picks ONE reading font for the tab — it applies to the Fast Reader word, the Lines pane and typing. Search (name, cat:serif, src:bundled), favorite fonts with ♥, and sort by readability (★ marks fonts with a legibility pedigree: Lexend, Atkinson Hyperlegible, Sitka, Verdana, Garamond…).',
      'Sources: bundled libre fonts (offline), system fonts, your installed fonts (Chromium, permission-gated), and the Google Fonts library when enabled in Application Settings.',
      'Themes (top-right dropdown) restyle everything per tab; Tab Settings holds sizes, alignment, bionic text, reveal modes and highlights.',
    ],
  },
  {
    id: 'data', title: '☁ Sync, backup & privacy',
    body: [
      'Data Management (Settings menu) backs up and syncs progress + settings via a local folder or your own Google Drive. Book Groups link editions of the same book so progress carries across formats.',
      'Incognito Reading (View menu) pauses ALL tracking and persistence; exiting rewinds positions as if the session never happened.',
      'Everything runs in your browser: no accounts, no servers of ours, no telemetry. OCR models, fonts and TTS voices download from CDNs only when their features are used.',
    ],
  },
  {
    id: 'languages', title: '🌍 Languages',
    body: [
      'Application Settings → Document language (21 languages incl. Croatian) drives OCR, dictation & read-along speech recognition, and TTS voice matching. The reading pipeline itself handles any script.',
    ],
  },
  {
    id: 'keys', title: '⌨ Keyboard shortcuts',
    body: [
      'Space play/pause · ← → word · ↑ ↓ line · Ctrl+↑↓ paragraph · PgUp/PgDn page · Home restart',
      'Ctrl+O open TXT · Ctrl+D open document · Ctrl+B clipboard · Ctrl+Shift+G grab (OCR)',
      'Ctrl+F find · Ctrl+G go to line · Ctrl+T statistics · Ctrl+H history · Ctrl+I proper names',
      'Ctrl+Shift+A audiobook · Ctrl+Shift+T TTS reader · Ctrl+Shift+F footnote · F1 this help · Esc close dialogs',
    ],
  },
];

export default function HelpDialog({ onClose }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.title.toLowerCase().includes(q) || s.body.some((b) => b.toLowerCase().includes(q)));
  }, [query]);

  return (
    <Dialog title="Help" onClose={onClose} width={720} buttons={<button onClick={onClose}>Close</button>}>
      <input
        type="text"
        className="fp-search"
        autoFocus
        placeholder="Search help… (e.g. scroll, wpm, ocr, gestures)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}
      />
      <div className="help-body">
        {shown.map((s) => (
          <section key={s.id} className="help-section">
            <h3>{s.title}</h3>
            {s.body.map((p, i) => <p key={i}>{p}</p>)}
          </section>
        ))}
        {!shown.length && <p className="settings-note">No matches — try a shorter term.</p>}
      </div>
    </Dialog>
  );
}
