// In-app help content as plain data, so it drives the Help dialog, the PDF export and the narrated
// slideshow from one source. Each section: { id, title, body[], intro?, groups?, say }. `say` is a
// short spoken script for the slideshow narration — keep it a sentence or two, plain and paced.
// Keep this CURRENT: when a feature ships, add or update its section here.

export const HELP_SECTIONS = [
  {
    id: 'start', title: '🚀 Getting started',
    say: 'Welcome to Tachyread. Open a book from the File menu, or drop a file onto the window. The Fast Reader flashes one word at a time; the Lines pane shows the text in context. Everything you read is tracked and restored next time.',
    body: [
      'Open a book with File → Open Document (.pdf, .epub, .docx, .txt, .md), paste text from the clipboard (Ctrl+B), or capture it from anything on screen with Grab Text (OCR). You can also drop files onto the window.',
      'The Fast Reader pane flashes one word at a time at your WPM (Space plays/pauses); the Lines pane shows the text in context. Toggle panes from the bar at the top (ToC, Avatars/Stats, Index, Fast Reader, Lines) — on desktop, whatever pane/chips/stats layout you leave is restored on the next launch.',
      'Everything you read is tracked per book: position, coverage, pace. Close the app and your session restores.',
      'Bulk-adding a whole shelf? File → Bulk Add from Folder scans a folder, filters by format, and opens every file you haven’t added yet.',
    ],
  },
  {
    id: 'reading', title: '📖 Ways to read',
    say: 'There are many ways to read. Press Space for auto-play. Use the arrow keys to step through by hand. Turn on Scroll-to-read to just scroll the page. Or let read-aloud voice the text. The mode chip shows how the app thinks you are reading.',
    body: [
      'Auto-play (RSVP): press Space. The word pane paces you at the WPM slider; the adaptive pacer (ADAPT) can adjust it from comprehension checks.',
      'Manually: arrow keys step words (←→) and lines (↑↓); Ctrl+↑↓ hops paragraphs; PgUp/PgDn pages by a screenful. After a page jump, the line that was at the edge is highlighted for ten seconds so you don’t lose your place.',
      'Scroll-to-read: turn on SCROLL in the controls bar, then just scroll the Lines pane like any page — whatever passes the top edge counts as read, and your WPM is measured from your real pace. A brittleness setting controls how easily a fast flick breaks out of scroll mode. The read point can be a fixed percentage OR tied to a placed crosshair (🎯) — drag the crosshair to move where text counts as read.',
      'Read-aloud (TTS): the voice reads and drives the position. Speaking mode advances when YOU read aloud (speech recognition). Typing mode advances by typing the text.',
      'The mode chip in the progress row shows how the app currently thinks you are reading (auto, line-by-line, scrolling, peeking…). ANY activity in the tab — clicks, keys, scrolling — holds off "idle", not just advancing a word.',
      'Chips (floating face/stats/goal) are resizable on desktop: drag the ◢ bottom corner (double-click it to reset). The timer chip is merged into the stats chip (finish-at-pace + auto-stop countdown blocks); shrink the stats chip and the least important stats bow out first — the live WPM survives longest.',
    ],
  },
  {
    id: 'display', title: '🎨 Reader display & focus',
    say: 'Tune how the text looks and where your eye lands. The optimal-recognition-point letter can glow or pulse. Bionic text bolds word-starts. Freshly arrived words can flash a highlight. Custom cursors and fading trails work in the reader areas, and full-screen mode fills the screen with just the reading.',
    body: [
      'Tab Settings holds sizes, alignment, line spacing, bionic text, reveal/hide modes and the ORP (optimal recognition point) highlight — 19 combinable looks for the pivot letter in the Lines pane (glow, pulse, flash, ring, invert, outline, shadow, tilt, bob…), with a tunable "Larger" size (+5…80%) and even its own font, all shown in a live preview.',
      'Auto font size (Tab Settings): let the Lines pane WIDTH drive the font — the size adjusts so roughly your target number of characters fits per line, following window resizes and rotation. A− / A+ then nudge the target instead of the pixel size.',
      'Completed words in the current line can take their own look (dim, faint, strikethrough, tint…) — Tab Settings → "Completed words in current line". Especially useful with paragraph-sized lines, where it shows exactly how far into the block you are.',
      'Jumping to a word (J / ⌖, Find, Go-to) centers that EXACT word in the Lines pane — even inside a paragraph-sized wall-of-text block, not just its line.',
      'Wall-of-text mode can replace newlines with a chosen sequence of characters or emoji, so paragraphs flow the way you like.',
      'New words entering the Lines pane can get a distinct style for a few seconds, so your eye catches what just arrived.',
      'Reading cursor & trail (View menu): pick a custom cursor that shows only in the reader areas, from a rich set of premades or your own. It can leave a fading trail — or a seismograph trail that draws as the lines scroll under a still cursor.',
      'Crosshairs (View menu): design a STABLE of overlay markers for the Lines area — combine shape, image and emoji layers with transparency and behind-the-glass distortion (blur, invert, hue, heat-haze warp), then place any of them on a tab and drag them where your eye should anchor. Designs are shared; placement and size are per tab.',
      'AVATARS (formerly faces, View → Avatar Library): they now act out what you\'re doing — bobbing while you scroll, nodding line-by-line, darting eyes word-by-word, sweeping on paragraph/page hops — mouth the words while the TTS speaks, get visibly drowsy as idle approaches, and SNOOZE with floating zzz and counting sheep once you go idle. Optional 🤚 Rayman hands float beside them and mirror your biometric controls (a detected 👍 flashes on a hand; the scroll joystick raises a gliding palm; claps applaud). On the typing screen the avatar\'s EYE COLOUR grades your live net WPM against consensus standards — gray beginner → green → cyan → blue → purple → gold → fire at 110+.',
      'Full-screen reading fills the screen with just the Lines pane (desktop ⛶ or menu) or the Source pane (⛶🗐), hiding all chrome. On phones the reading area fills edge to edge. Esc or the small ⛶ overlay exits.',
      'Source page looks: the 🎛 button on the Source pane toolbar opens display-flavour filters for the original page — old paper (sepia), noir, faded print, night, blueprint, thermal… or a custom slider mix. Pure paint; the text and OCR underneath are untouched. Per tab.',
      'Blue-light blocker (BLB) warms the whole app for bedtime reading — its own control in the bottom bar, the View menu, or the B key (App Settings has the strength). It’s independent of Focus mode, which fullscreens and (on Chrome/Edge) blacks out your other monitors.',
    ],
  },
  {
    id: 'wpm', title: '⏱ WPM & progress tracking',
    say: 'Reading-now is your live pace; session efficiency is new words per active minute, so skims and idle time lower it honestly. Jumps never count as reading; deliberate forward moves credit the text you passed. Coverage is how much of the book you have truly read.',
    body: [
      '"Reading now" is your live pace over the recent window; "session efficiency" is new words actually read per active minute — re-reading, skims and idle time lower it honestly.',
      'Jumps (ToC, Find, Go-to) are never counted as reading. Deliberate forward moves (line/paragraph/page-down/scroll) credit the text you passed.',
      'Coverage (📖 %) is how much of the countable book you have actually read — front/back matter can be excluded via skip ranges.',
      'Stats menu: Statistics, Progress Detail, Regression Report, Attention Check, and Reading History keep the long-term numbers. Status-bar updates carry a timestamp and fade after a while.',
    ],
  },
  {
    id: 'biometrics', title: '🖐 Biometric controls',
    say: 'Read hands-free. An open palm is a scroll joystick, and eighteen hand poses — thumbs, fist, victory, three or four fingers, shaka, horns, pointing in any direction — can map to any action or an exact reading speed. Hold a gesture to pause, or hold one past a threshold to scroll until you let go. Blinks, winks, eye-rolls, parked gazes and a whole catalog of face poses work too. A profile check flags any conflicting setup. Everything runs on your device; frames never leave it.',
    body: [
      'Hand gestures (Biometric Controls): an open palm is a scroll joystick — hold it above/below your calibrated rest height to scroll the Lines pane, farther = faster. Any gesture can be mapped to a command, to ± scroll ticks, or to a specific WPM value; a minimum hold time filters accidental triggers.',
      '18 hand poses: thumbs up/down, fist, victory, point up/down/left/right, rock (ILY), horns, call-me (shaka), three or four fingers, pinch/OK, wave, and one-shot left/right swipes. Each is individually enabled so unused ones can\'t false-fire.',
      'Hold-to-pause: pick a gesture that pauses auto-play only while you hold it up, resuming the moment you drop it.',
      'Hold-to-scroll: map scroll up and scroll down each to "holding gesture X for more than Y seconds" — once the hold crosses the threshold the Lines pane scrolls steadily until you let go. A gesture used here is owned by hold-to-scroll (its one-shot mapping is suppressed, and the profile check says so).',
      'Eye, gaze & face gestures: map blinks, winks (left and right differ), eye-rolls, parked gazes (hold your eyes far left/right/up) and held face poses — tongue out, puffed cheeks, pucker, mouth left/right, jaw left/right/forward, nose scrunch, mouth-O, wide eyes, squint, raised brows, open mouth, frowns and a held smile — to actions, within duration ranges that filter natural movement. An optional audio cue helps you hit the sweet spot; illegal overlapping mappings are refused. Works on mobile once the camera is enabled in settings.',
      '🩺 Profile check: the Biometric Controls page continuously flags conflicts and overlaps across the whole setup — a gesture serving two masters, colliding voice phrases, a sequence that shadows another, confusable poses armed together — as errors, warnings and notes.',
      'Voice commands ("play", "pause", "next", "back") and clap detection can each fire commands too.',
      'One BIOMETRIC button in the controls bar unifies it all: its popup toggles voice/clap commands, camera watching (attention & doze) and hand gestures, and links to the full Biometric Controls page and the live feed. While any source is active, a single status-bar badge (📷 🖐 🎤) shows what’s running and opens the feed.',
      'Profiles: save a whole biometric setup as a named profile and switch between them; after updating a profile an Undo is available for two minutes.',
      'Webcam guards (all optional, all on-device): pause when you look away, stop read-aloud when you doze, away alarms, posture nudges, and focus analytics. Frames never leave your device.',
      '🎥 Camera feed looks (display only): the 👁 eye ROTOSCOPE pins customizable graphics over your detected eyes on the self-view — glow orbs, rings, stars, lasers or a custom emoji, with size/colour/opacity controls and an optional glow that burns brighter the faster you read (like the avatars). Plus display filters for the whole feed (noir, thermal, neon, sepia… or your own mix). Detection always sees the raw frames.',
    ],
  },
  {
    id: 'typing', title: '⌨ Typing practice',
    say: 'Typing practice types your book forward from where you are, with the best ideas from the classic trainers built in: a pace ghost to race, stop-on-error and no-backspace discipline modes, blind mode, a consistency score, personal bests, daily streaks, a one-click drill of the words you missed, and a per-key error heatmap.',
    body: [
      'Typing menu → Typing Practice types your book forward from the reading position; finish a run and Continue to count it as read, or Discard to return.',
      'A run starts on your first keystroke (or ▶ Start for a Ready·Set·Go — typing mid-countdown skips the rest of it). On the results screen, just typing stages the next run too. It ends at the limit, on End run, or after 5s idle.',
      'Per-character feedback stays on completed words: green = correct, red = wrong, underlined = never typed, dim red = extra characters.',
      'Display-only variants of the transforms: with lowercase on, optionally show the capitals AS WRITTEN (typing lowercase still counts); with no-special on, optionally show the stripped characters as dim auto-skipped 👻 ghosts; and the passage can show the book\'s own line breaks (¶⏎) instead of a flowing wall — in every case the required typing is identical.',
      '👻 Pace ghost: a marker moves through the passage at a steady speed — your last run, your personal best, or a custom WPM — so every run is a quiet race (Monkeytype\'s pace caret, TypeRacer\'s ghost).',
      'Discipline modes: 🛑 stop-on-error refuses wrong keys (they still cost an error) and only commits complete words; 🚫⌫ confidence mode disables backspace entirely; 🙈 blind mode hides the per-character verdicts while you type — the numbers tell the tale at the end.',
      'The results screen shows an examinable chart of raw, effective and burst WPM plus accuracy AND a consistency % (keystroke-rhythm steadiness), 🏆 personal-best banners (all-time and per mode), and your 🔥 daily typing streak.',
      '🎯 Drill the misses: one click on the results screen builds a review drill from that run\'s mistyped and unusually slow words — practice your book\'s own hard words, not a generic list.',
      'Typing Progress adds a keyboard-shaped per-key error heatmap and per-finger error rates mined from your runs, alongside streaks, weekly summaries and per-run consistency.',
      'Drills (Mavis-style rows, bigrams, numbers…) live in the mode dropdown; Typing Plans chains sets into workouts; Flow Writer and Dictation are separate output games.',
    ],
  },
  {
    id: 'train', title: '🏋 Training drills',
    say: 'Warm up and train your eyes. Eye Warmup is a short guided routine before reading. Span Drill widens how many words you take in per glance. Vocabulary builds a spaced-repetition deck, and comfort microbreaks protect your eyes on long sessions.',
    body: [
      'Eye Warmup: an 8-drill guided routine (pursuit, saccades, peripheral, focus, rest) — a ~3 minute warmup before reading, with optional eye-tracking.',
      'Span Drill: flashes a run of words for one glance and widens it as you keep up — trains words-per-fixation.',
      'Vocabulary: collects words you look up into a spaced-repetition deck.',
      'Take a Break Now and the comfort monitor (20-20-20 microbreaks) protect your eyes on long sessions.',
    ],
  },
  {
    id: 'grab', title: '📷 Grab Text (OCR) & the SimpleClicker arm',
    say: 'Grab Text captures pages from a shared screen, a document camera, or images, and reads them with OCR. Watch mode grabs each new page as you turn it. With the SimpleClicker arm it even turns the pages for you and stops at the end.',
    body: [
      'File → Grab Text captures pages from a shared screen/window, a document camera, or uploaded images, then OCRs them (language comes from Settings → Application Settings → Document language).',
      'Auto (timed) grabs on an interval; Watch (continuous) grabs each new page the moment it settles — just page through your reader.',
      'Hands-free: run SimpleClicker (the companion app) with "Remote arm (HTTP)" enabled, drop its marker on your reader\'s next-page button, and tick 🦾 SimpleClicker arm in the wizard — each grab turns the page for you and capture stops by itself at the end of the document.',
    ],
  },
  {
    id: 'audio', title: '🔊 Audio',
    say: 'Tachyread can record and play per-line narration, run a standalone text-to-speech reader, and play ambient sound under your reading. Read-aloud keeps playing with the screen off, driven by your lock-screen media controls.',
    body: [
      'Audio menu: the Audiobook Manager records/plays per-line narration; the Text-to-Speech Reader is a standalone TTS popup; Ambient Sound plays a low soundscape under your reading.',
      'Audio Settings holds the TTS voice & rate (the default voice follows your document language), the speak-along follow mode, and the auto-stop timer.',
      'Listen with the screen off: read-aloud keeps playing when you lock the phone or switch apps, and your lock-screen / notification media controls (play·pause·next·previous) drive it — next/previous jump paragraphs.',
    ],
  },
  {
    id: 'fonts', title: '🗛 Fonts & themes',
    say: 'Pick one reading font per tab from bundled, system, installed, or Google fonts. A star marks fonts with a legibility pedigree. Themes restyle everything per tab.',
    body: [
      'Settings → Font Manager picks ONE reading font for the tab — it applies to the Fast Reader word, the Lines pane and typing. Search (name, cat:serif, src:bundled), favorite fonts with ♥, and sort by readability (★ marks fonts with a legibility pedigree: Lexend, Atkinson Hyperlegible, Sitka, Verdana, Garamond…).',
      'Sources: bundled libre fonts (offline), system fonts, your installed fonts (Chromium, permission-gated), and the Google Fonts library when enabled in Application Settings.',
      'Themes (top-right dropdown) restyle everything per tab; Tab Settings holds sizes, alignment, bionic text, reveal modes and highlights. You can apply your Default Tab Settings to every open tab at once.',
    ],
  },
  {
    id: 'trackyread', title: '📚 Trackyread (reading tracker)',
    say: 'Trackyread is your library and reading tracker. See what you are reading, what is on deck, and what you have finished. It flags books you are drifting away from and finished books you may be forgetting. Books can have several cover images with one master, and lists can switch between a table and a cover-tile grid.',
    body: [
      'Stats menu → Trackyread: your whole library with statuses (reading, on deck, to read, finished, abandoned), covers, series, groups, timeline and analytics.',
      'The Dashboard flags two kinds of forgetting: 🌫️ Drifting — unfinished reads you haven’t opened in a while (resume before you lose the thread) — and 🧠 Fading — finished books a forgetting-curve says you may be losing (worth a refresh).',
      'Queue (on deck): shows total words, ≈sentences and ≈lines plus per-book time and projected finish dates. Quickly enqueue recently-read and currently-open files, or Queue-all at once.',
      'Covers: a book can carry several cover images — upload, add by URL, fetch from Open Library, generate a stylised one with Auto, or have Claude design one (✨ AI cover). Pick the master shown on tiles; batch-cover the coverless books in view. AI covers use Claude’s text design plus local SVG — no image service.',
      'List view: toggle the library between a table and a cover-tile grid (▤/▦). Trackyread can also fix miscategorised content and spot what seems to be in the process of being forgotten.',
      'Tab tiles: right-click the tab bar → Tab tiles to show open documents as a scrollable row of cover tiles.',
    ],
  },
  {
    id: 'data', title: '☁ Sync, backup & privacy',
    say: 'Back up and sync your reading progress and tab settings through a local folder or your own Google Drive. Application and biometric settings are specific to each device and stay put. Incognito reading pauses all tracking. Everything runs in your browser — no accounts, no servers of ours, no telemetry.',
    body: [
      'Data Management (Settings menu) backs up and syncs reading progress and tab settings (Default Tab Settings + per-file display) via a local folder or your own Google Drive. Book Groups link editions of the same book so progress carries across formats.',
      'Application settings and biometric settings are DEVICE-SPECIFIC — they’re tuned to each device’s screen, camera and habits, so they don’t sync. Each device shows its own name + ID on the Application Settings and Biometric Controls pages. Your API keys also stay on the device and are never synced.',
      'Every settings page (Tab, Application, Biometric, Audio, Comfort, Typing) has a Profiles bar with BUILT-IN presets optimized for desktop, phone and tablet — load one to apply sensible defaults for that device class (only the settings it covers change; built-ins can’t be edited, but Save as… copies one into your own profile).',
      'Incognito Reading (View menu) pauses ALL tracking and persistence; exiting rewinds positions as if the session never happened.',
      'Everything runs in your browser: no accounts, no servers of ours, no telemetry. OCR models, fonts and TTS voices download from CDNs only when their features are used.',
    ],
  },
  {
    id: 'languages', title: '🌍 Languages',
    say: 'Twenty-one document languages drive OCR, dictation, read-along recognition and text-to-speech voice matching. The reading pipeline itself handles any script.',
    body: [
      'Application Settings → Document language (21 languages incl. Croatian) drives OCR, dictation & read-along speech recognition, and TTS voice matching. The reading pipeline itself handles any script.',
    ],
  },
  {
    id: 'keys', title: '⌨ Keyboard shortcuts',
    say: 'The whole app is keyboard-operable. Space plays and pauses, arrows step through the text, number keys toggle panes, and letter keys toggle modes. Control combos and F1 work anywhere.',
    intro: 'The whole app is keyboard-operable (only chip-dragging needs the mouse). The reading keys (single letters, digits, arrows, +/−) work while you\'re reading — with no dialog tab focused and the focus not on a button or field. Ctrl-combos, Esc and F1 work anywhere.',
    groups: [
      { name: 'Reading & playback', keys: [
        ['Space', 'Play / pause'], ['← →', 'Previous / next word'], ['↑ ↓', 'Previous / next line'],
        ['Ctrl+↑ ↓', 'Previous / next paragraph'], ['PgUp PgDn', 'Page up / down'], ['Home', 'Restart from the top'],
        ['− +', 'Reading speed −/+ 25 WPM'], ['j', 'Jump to the current word'], ['u', 'Jump to the latest unread word'],
      ] },
      { name: 'Toggle panes', keys: [
        ['1', 'Fast Reader'], ['2', 'Lines'], ['3', 'Table of Contents'], ['4', 'Stats'], ['5', 'Index'], ['6', 'Avatars'],
      ] },
      { name: 'Toggle modes', keys: [
        ['a', 'Read-aloud (TTS)'], ['s', 'Scroll-to-read'], ['v', 'Voice commands'], ['f', 'Focus mode'], ['b', 'Blue-light reduction'], ['i', 'Incognito reading'],
      ] },
      { name: 'Tabs & dialogs', keys: [
        ['Ctrl+PgUp PgDn', 'Previous / next tab'], ['Esc', 'Close footnote, else the focused dialog tab'],
        ['Ctrl+F', 'Find'], ['Ctrl+G', 'Go to line'], ['Ctrl+T', 'Statistics'], ['Ctrl+H', 'Reading history'],
        ['Ctrl+I', 'Proper names'], ['Ctrl+,', 'Tab settings'], ['F1', 'This help'],
      ] },
      { name: 'Files', keys: [
        ['Ctrl+O', 'Open TXT'], ['Ctrl+D', 'Open document (PDF/EPUB/DOCX/…)'],
        ['Ctrl+B', 'Open from clipboard'], ['Ctrl+Shift+G', 'Grab text (OCR)'],
      ] },
    ],
  },
];

// Flatten a section into searchable / spoken text so "wpm", "incognito", etc. still match.
export function sectionText(s) {
  const base = `${s.title} ${(s.body || []).join(' ')} ${s.intro || ''}`;
  const keys = (s.groups || []).map((g) => `${g.name} ${g.keys.map((k) => k.join(' ')).join(' ')}`).join(' ');
  return `${base} ${keys}`.toLowerCase();
}

// The narration line for a section's slide — its `say`, or a trimmed fallback from its body.
export function sectionNarration(s) {
  if (s.say) return s.say;
  const first = (s.body || [])[0] || s.intro || s.title;
  return String(first).replace(/\s+/g, ' ').trim();
}
