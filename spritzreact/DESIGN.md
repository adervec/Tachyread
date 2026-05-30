# SPRITZ Reader (React) — As-Built Design Document

## Overview

SPRITZ Reader is a browser-based speed-reading app — a React/Vite port of the original
WPF desktop application. Text is displayed one word at a time, centered on an Optimal
Recognition Point (ORP), so the reader absorbs words at high WPM without saccadic eye
movement.

Around that core it carries the desktop app's feature surface, adapted to the browser:
multiple document formats (TXT/DOCX/PDF/EPUB), ~30 visual themes, animated procedural
reader faces, inline text-to-speech and a standalone TTS reader, voice/clap playback
control, typing and speaking minigames, audiobook recording, reading history, progress
goals, table-of-contents and proper-name indexing, footnotes, and per-document persistence
keyed by content checksum.

Where a desktop capability has no direct web equivalent it is adapted to a Web Platform API
(Web Speech, Web Audio, MediaRecorder, IndexedDB) — see **Platform adaptations** below.

## Architecture

A single-page React 19 app built with Vite. Global state lives in one reducer-backed
context (`AppProvider`); each open document is a **tab** object held in that state. The UI
is split into a menu bar, tab strip, a three-column main area (optional TOC pane · SPRITZ
pane · line pane), a control bar, and a status bar. Dialogs and overlays render on top.

Theming is done with **CSS custom properties**: a selected palette is written onto
`:root` at runtime (`applyTheme`), and all components read the resulting variables.

### Source layout

| File | Responsibility |
|---|---|
| `src/App.jsx` | Root component: playback driver (the timing effect), navigation, keyboard shortcuts, drag-drop, minigame/recording/audio-control effects, dialog routing, theme application |
| `src/state/AppContext.jsx` | `AppProvider` + `useApp()`; reducer, tab model, file/clipboard open, settings persistence |
| `src/state/settings.js` | `defaultFileSettings` / `defaultGlobalSettings` (mirror of the WPF `FileSettings`/`GlobalSettings`) |
| `src/state/storage.js` | IndexedDB layer (`idb`): per-file settings by checksum, global settings, audiobook clips + manifest |
| `src/state/themes.js` | **Auto-generated** theme library (~30 palettes) + `applyTheme` (writes CSS vars). Regenerate with `scripts/parse-themes.mjs` |
| `src/document/readerDocument.js` | Document model: tokenization, lines/sentences, ORP, SHA-256 checksum, header/footer detection, proper-name + footnote-marker extraction |
| `src/document/parsers.js` | Format parsers: TXT, DOCX (`mammoth`), PDF (`pdfjs-dist`), EPUB (`epubjs`), clipboard |
| `src/engine/spritzEngine.js` | Per-word timing (`wordDurationMs`) + the playback scheduler/controller |
| `src/engine/readingTracker.js` | Reading-efficiency tracker: active-time accounting, skip/read/re-read classification, read mask, measured WPM, coverage, daily history |
| `src/engine/faceExpression.js` | Procedural face expression model (WPM → lid/brow/mouth/iris keyframes, tiers, eye geometry) |
| `src/components/Face.jsx` | SVG animated reader face: 16 face styles, 6 art styles, the shared animated eye/brow/lid/mouth rig |
| `src/components/Pointer.jsx` | Reading-pointer glyphs (Arrow/Diamond/Star/Circle/Hand) |
| `src/components/PaneLayout.jsx` | Horizontal resizable pane container with draggable splitters |
| `src/components/Trendline.jsx` | Mountain-graph progress bar (per-word reading-pace area chart + scrubber) |
| `src/components/ChapterHeading.jsx` | Current-chapter heading + section progress bar |
| `src/components/SpritzPane.jsx` | SPRITZ word display: ORP word, context words, guide lines |
| `src/components/DashboardPane.jsx` | Dedicated pane for the animated faces + live reading stats |
| `src/components/SourcePane.jsx` | Side-by-side original page: PDF page (pdf.js canvas) / EPUB section, synced to position |
| `src/document/toc.js` | TOC auto-detection, stored-entry resolution, current-chapter computation |
| `src/document/grab.js` | Build a reader doc from grabbed text + images (word→segment map, image source) |
| `src/features/ocr.js` | tesseract.js OCR (lazy worker) + dark-mode-aware preprocessing |
| `src/features/screenCapture.js` | Screen Capture API frame grabbing, crop, duplicate-frame detection |
| `src/dialogs/GrabWizard.jsx` | "Grab Text" wizard (screen capture / image upload → OCR → reader) |
| `src/components/LinePane.jsx` | Virtualized right-pane reading view (`react-window`), status coloring, blur, pointer, right-click word menu |
| `src/components/ControlsBar.jsx` | Progress bar, WPM slider + unit, transport, mode toggles (SHOW/READ/TYPE/SPEAK/REC/AUDIO), goal row |
| `src/components/MenuBar.jsx` / `TabBar.jsx` / `TocPane.jsx` / `TypingOverlay.jsx` | Chrome + panels |
| `src/dialogs/*` | Settings (tab), App Settings (global), Statistics, History, Proper Names, Audiobook, Find, Go-to-line, TTS popup, Face Library, Book Finished, Footnote overlay |
| `src/features/tts.js` | Web Speech `speechSynthesis` wrapper + live `useVoices()` hook |
| `src/features/readAloud.js` | Integrated read-aloud controller (speaks from position, syncs index via boundary events) |
| `src/features/speechRecognition.js` | `webkitSpeechRecognition` wrapper (speaking minigame, voice commands) |
| `src/features/audioRecorder.js` | `MediaRecorder` clip capture (audiobook) |
| `src/features/audioControl.js` | Voice commands + Web Audio clap detection |
| `scripts/parse-themes.mjs` | One-shot generator that parses the WPF `Themes.cs` into `src/state/themes.js` |

### Tab model

Each tab bundles: the parsed `doc`, per-file `settings` (the persisted record), and transient
session state — `sessionWordsRead`, `sessionActiveMs`, and `Set`s of read/session/nav lines
used for right-pane status coloring. `PATCH_SETTINGS` updates the persisted slice (debounced
to IndexedDB); `PATCH_TAB` updates transient fields.

### Layout

The main area is a row of **resizable panes** (`PaneLayout`): each pane can be toggled on/off
from the menu bar and resized by dragging the splitter between panes. Every pane but the last
(Lines) takes a draggable pixel width; the Lines pane flexes to fill. The default order is
TOC · Dashboard (faces + stats) · SPRITZ · Lines.

```
+-----------------------------------------------------------------------------+
| Menu bar (File, View, [TOC][Faces/Stats][Source][Hide SPRITZ], Theme ▾)     |
+-----------------------------------------------------------------------------+
| Tab strip (each tab header shows a thin progress bar)                       |
+-----------------------------------------------------------------------------+
| ▸ Current chapter title              §3/12  [====section progress====] 47%  |
+--------+-+-------------+-+-----------+-+-----------+-+----------------------+
| TOC    |▟| Dashboard   |▟| SPRITZ    |▟| Source    |▟| Line pane            |
| (edit) | |  faces 1-3  | |  context  | |  PDF page | |  status coloring     |
|  +Here | |  live WPM   | |  ORP word | |  / EPUB   | |  blur, pointer, %    |
|  ✎ 🗑   | |  efficiency | |  + guides | |  section  | |  right-click menu     |
|        |↔|  coverage   |↔| (toggle)  |↔| (synced)  |↔|                      |
+--------+-+-------------+-+-----------+-+-----------+-+----------------------+
| Mountain-graph trendline (click to scrub) | pos | 📖 read% | ⏱ ETA | ✓Finish |
| WPM slider + unit | transport | SHOW/READ/TYPE/SPEAK/REC/AUDIO                  |
| GOAL: type + value + Set/Clear + status                                     |
+-----------------------------------------------------------------------------+
| App session status bar                                                      |
+-----------------------------------------------------------------------------+
```

## Document model

`readerDocFromText` tokenizes normalized text (split on space/tab/NBSP) into a flat
`words[]` array, building:

- `lines[]` (`lineNumber`, `text`, `startWordIndex`, `endWordIndex`, `isEmpty`,
  `isParaStart`) and `wordToLine[]`
- `sentences[]` (`startWordIndex`/`endWordIndex`, split on `. ! ?`) and `wordToSentence[]`
- `contentChecksum` — SHA-256 of the full text via `crypto.subtle` (with a non-crypto
  fallback), used as the persistence key
- `headerFooterLines` — a `Set` of suspected header/footer line indices
- `footnotes` (marker number → entry) filled by a marker-scanning pass
- `properNames` (lowercased name → occurrences) filled lazily, opt-in per tab

Format entry points live in `parsers.js`: `parseFile` dispatches by extension to TXT/DOCX/
PDF/EPUB and attaches the checksum; `parseClipboardText` reads the clipboard.

## Features

### Core reading
- **SPRITZ display**: one word at a time centered on the ORP character (`orpIndex` chooses
  the pivot by word length); long words shrink to keep the right side on screen.
- **Speed control**: 60–1500 WPM slider, per tab.
- **Speed units** (`speedUnit`): the slider value is interpreted as **Words**, **Letters**,
  or **Syllables** per minute — per-word dwell scales by the word's unit count.
- **Playback controls**: Play/Pause (Space), Prev/Next word (←/→), Prev/Next line (↑/↓),
  Prev/Next paragraph (Ctrl+↑/↓), Restart (Home).
- **Context words**: independent **before** and **after** counts shown around the current
  word (Tab Settings → SPRITZ word display); optional ORP highlight on context words.
- **Double-display-time** multipliers (1.0 = off) for proper names, long words
  (configurable threshold), digit words, and special-character words; punctuation adds a
  small pause.
- **Paragraph & line pauses**: configurable pause at paragraph breaks and an optional extra
  pause at line starts.

### Document support
- **Text**: `.txt`, `.md`, `.csv`, `.log` (File → Open TXT, Ctrl+O).
- **Rich documents** (File → Open Document, Ctrl+D): **DOCX** via `mammoth`, **PDF** via
  `pdfjs-dist` (line reconstruction from text-item Y positions), **EPUB** via `epubjs`
  (spine HTML stripped to text in reading order).
- **Clipboard** (Ctrl+B) and **drag-and-drop** onto the window — non-persistent tabs.
- **Grab Text (OCR)** (Ctrl+Shift+G) — the browser adaptation of the *TextGrabber* tool (see
  *Text grab* below).

### Progress tracking & reading-efficiency measurement
WPM is **measured**, not assumed. The setpoint slider only sets pacing; the reported numbers
come from a reading-efficiency tracker (`src/engine/readingTracker.js`) that classifies every
change of reading position and accounts active time honestly. For each move from word A to B:

- **Active time** is credited only for the gap spent dwelling on A, **capped** per gap
  (12 s), and **not at all while the tab is hidden** — so leaving the reader open in the
  background (or playing in another tab) inflates nothing. Playback auto-pauses when the tab
  is hidden.
- **Reading** — contiguous forward motion (auto-play or manual next-word/next-line) at a
  human pace: the spanned words are marked **read** in a per-word mask and counted toward
  speed.
- **Skips** — a large forward jump (TOC / Find / Go-to, > 50 words) or blowing past text
  faster than a person could read (faster than ~2400 wpm, e.g. holding an arrow key): the
  spanned words are **not** marked read and earn no speed credit. Skipping the preamble does
  not count as "read."
- **Re-reading** — a small backward step then forward over the same words: adds active time
  but no new coverage, so the session's net rate falls the way real re-reading lowers
  efficiency, while the live pace still reflects your eyes moving.
- **Revisiting** a far section then returning: the read mask preserves what was already read,
  so resuming forward is not mistaken for a skip of unread material.

Two headline numbers result, both shown in the Dashboard and Statistics:
- **Reading now** — live pace over a sliding ~30 s window of *active* reading (eyes pace).
- **Session / lifetime efficiency** — unique new words read per active minute.

Plus **coverage** — the share of the book actually read (popcount of the read mask), shown on
the progress bar and stats, distinct from the furthest position reached.

- **Mountain-graph trendline** (`Trendline.jsx`): the control-bar progress bar is an area
  chart of recorded reading pace at each word position (a per-word WPM trace also persisted).
  Columns are colored by state — read this session, read in a prior session, or unread
  (faint) — with a current-position marker; click/drag to scrub. Skipped sections show as
  flat gaps; faster reading shows as taller peaks.
- **Finishing a book**: at the last word a pulsing **✓ Confirm finished** button appears; it
  opens a **Book Finished** dialog with overall stats, a 1–5 **star rating**, and a **notes /
  review** field, and records a completion entry (date, coverage, active time, WPM, rating).
- **Checksum keyed**: per-file settings and the read mask/trace are stored in IndexedDB under
  the document's SHA-256, so a renamed/moved file keeps its place, coverage, and history.
- **Daily history** (new words + active time per day) drives **Statistics** (Ctrl+T) and
  **Reading History** (Ctrl+H). Per-tab line `Set`s still drive right-pane status coloring.

### Progress goals
A per-tab goal set from the control bar (`goal.type`): none, absolute words/lines/percent,
relative words/lines/percent, or active-time minutes, with a live status readout.

### Panes & layout
The main area is a row of resizable panes. Drag any splitter to resize; toggle the TOC,
Dashboard (faces + stats), Source, and SPRITZ word panes from the menu bar. The faces and
reading stats live in their **own Dashboard pane**, independent of the SPRITZ word display.
A **current-chapter heading bar** sits above the panes showing the active section title and a
progress bar for position within that section.

### Text grab (OCR) — `GrabWizard`
A wizard (File → Grab Text, Ctrl+Shift+G) that pulls text out of images and into the reader —
the browser adaptation of the *TextGrabber* desktop tool. Two sources:
- **Screen / window capture** via the Screen Capture API: share a surface, optionally drag a
  **selection region** over the live preview, and **Grab** a page. An **auto-grab** mode
  captures N frames at a chosen interval and **de-duplicates** consecutive identical pages
  (stopping early after a configurable run of duplicates) — you flip pages in the shared
  window between captures. (The desktop tool's OS-level click/key automation between grabs has
  no browser equivalent, so paging is manual; the capture/dedup/stop-on-duplicates logic is
  preserved.)
- **Image upload**: one or more screenshots/photos.

Captured images are OCR'd with **tesseract.js** (lazy-loaded WASM) using the dark-mode-aware
contrast preprocessing ported from TextGrabber. Recognized text is editable/reorderable per
segment, then opened as a reading tab whose **images are retained as the document source** —
so the original captured page shows in the Source pane beside the reading position, exactly
like a PDF.

### Original page side-by-side (`SourcePane`)
A **Source** pane (toggle) shows the original alongside the reader, synced to the reading
position via a word→segment map. **PDF** pages are rasterized with pdf.js onto a canvas (fit
to pane width); **EPUB** shows the current spine section's sanitized HTML; **grabbed** docs
show the captured image for the current page. Plain text / DOCX have no original layout and
the toggle is hidden.

### Table of contents (editable)
The **TOC** pane (toggle) lists chapter entries — stored custom entries (persisted per file)
take precedence over auto-detected headings. Add the current position (**+ Here**), rename,
delete, regenerate from headings, or clear back to auto. Clicking an entry jumps to it; the
entry containing the current position is highlighted and named in the chapter heading bar.

### Right pane (Lines)
A **virtualized** list (`react-window`) of every line with an always-centered current line.
- **Line status coloring**: Unread, Read, SessionRead, NavSessionRead, Current.
- **Current-word highlight styles** — *combinable*: any of Underline, Bold, Background,
  Color, Box.
- **Paragraph tint**, **% separators** (every ~1%), **bionic font** (bold word stems),
  **ORP character highlight**.
- **Header/footer italics** + **auto-skip** during playback.
- **Focus blur**: configurable number of lines blurred before/after the current line.
- **Hide modes** ("SHOW" button): All → up to word → up to line → up to sentence → up to
  paragraph.
- **Current-line font boost**, configurable right-pane font size, text alignment.
- **Reading pointer**: optional glyph beside the current line — `pointerStyle`
  (Arrow/Diamond/Star/Circle/Hand), `pointerPlacement` (Above/Below/Left/Right), size, and
  blink interval.
- **Right-click word menu**: Copy, **Translate** (Google), **Dictionary** / **Thesaurus**
  (Merriam-Webster), and Go-to-this-line.

### Animated reader faces
Optional procedural cartoon faces (`showEyes`) drawn as SVG (`Face.jsx`) that react to the
set reading speed. A shared animated **rig** — two eyes, brows, eyelids, and a bezier mouth —
is common to every style; `faceExpression.js` interpolates lid droop, brow raise/arch, mouth
curve, and iris color/glow across **8 WPM tiers** (eyes droop and look bored when slow;
brows raise, the mouth smiles, and irises shift through brown→gold→green→blue→pulsing
purple as speed climbs). Pupils track reading progress across the current line.

1–3 faces can be shown side by side (`faceCount`), each assigned a **FaceStyle** (Man, Owl,
Robot, Alien, Wizard, Cat, Baby, Skull, Panda, Frankenstein, Vampire, Viking, Clown, Bunny,
Dragon, Ninja) layered with distinctive SVG decorations, and an **ArtStyle** (Cartoon, Flat,
Sketch, Neon, Watercolor, Pastel) applied as a CSS re-skin. The **Face Library** dialog
previews every style across the WPM range and assigns faces to the reader's slots. Faces
render in the Dashboard pane, so the SPRITZ word display can be hidden (Hide SPRITZ)
independently of them.

### Read aloud (integrated TTS) — `features/readAloud.js`
A **READ** toggle that integrates text-to-speech with the main reading position. With it on,
pressing **Play** speaks the document forward from the current word, one sentence-sized chunk
at a time, and **advances the reading position in sync** using `speechSynthesis` `boundary`
events — so the SPRITZ word and line pane follow what's being spoken. It's designed to "read
at you" hands-free: you can still **manually jump** lines/words (or scrub the trendline) at
any time and the speech **re-syncs** to wherever you move — letting you push ahead when you
have a moment of attention. Because every advance flows through the normal position update,
read-aloud **counts toward reading stats at the real spoken pace** (the reading tracker
measures the time between spoken-word boundaries). Per-tab voice and rate; the voice list is
live (updates as the browser loads voices via the `voiceschanged` event).

### TTS Reader popup
A standalone reader (View → Text-to-Speech Reader, Ctrl+Shift+T) that speaks a chosen range
without moving the main reading position. Uses the browser's `speechSynthesis` voice list,
rate, and transport.

### Audio control
Hands-free playback (AUDIO toggle), mode Voice / Claps / Both:
- **Voice commands** via `webkitSpeechRecognition`: play/resume, pause/stop, next, back.
- **Clap detection** via Web Audio RMS peak detection: 1 clap = play/pause, 2 = next line,
  3 = previous line.

### Minigames
- **Type-along** (TYPE toggle, `TypingOverlay`): a Monkeytype-style focus view where you type
  the actual document text from the current position — characters color correct/incorrect with
  a live caret, Space commits a word. Each committed word **advances the real reading index**
  (so type-along counts as reading via the tracker), while a separate HUD tracks **typing
  WPM, accuracy, words, and best**. Toggle off (or **Esc** / “Lock in & read”) to resume
  serious reading from wherever you typed to. Strictness options: case sensitivity, punctuation
  stripping, per-word timeout; best WPM is persisted per file. The auto-advance timer is
  suspended while typing.
- **Speaking** (SPEAK toggle): advance by speaking, using `webkitSpeechRecognition` with a
  confidence threshold (Low/Med/High), per-word timeout, and allow-partial.
- TYPE, READ (read-aloud), and SPEAK are mutually exclusive.

### Audiobook
Records narration with `MediaRecorder` while reading (REC toggle); clips are stored per line
in IndexedDB with a manifest. The **Audiobook Manager** (Ctrl+Shift+A) lists, plays, and
deletes clips.

### Footnotes & proper names
- **Footnotes**: extracted by marker scanning (`[n]`, `(n)`, superscript digits) matched to
  `n.`/`n)` body lines; a preview overlay shows the note (Esc closes).
- **Proper names**: detected via capitalization + sentence-boundary heuristic with a stop
  list (opt-in per tab, because it is heavy on large documents). The **Proper Names Index**
  (Ctrl+I) lists names with jump-to-occurrence.

### Header/footer detection
`detectHeaderFooterLines` (only when ≥10 lines) flags standalone page numbers / `Page N` /
`- N -` / roman numerals, and short (≤6-word) lines repeated above a frequency threshold.

### Appearance & theming
- **Themes** (`themes.js`): ~30 named palettes generated from the WPF `Themes.cs` —
  Light, Dark, Blue, Warm Paper, Solarized Light/Dark, Nord, Monokai, Zenburn, Terminal
  Green/Amber, Midnight, Forest, Oceanic, Coffee, Sakura, Japan, Norse, Steampunk, 60s–2000s,
  Art Deco, Victorian, Medieval, Rome, Greece, Egypt. Each palette defines every UI surface
  (and optional default serif/sans fonts) and is applied as CSS custom properties on `:root`.
  Selectable per tab from the menu bar or Settings.
- **Fonts**: default serif/sans font families are an **app-level** setting; the per-tab serif
  toggle for the SPRITZ word is a tab setting.
- **Guide lines**: vertical crosshair flanking the ORP, configurable color.

#### Settings scope (no overlap)
Settings are split so nothing is both an app and a tab setting:
- **Application Settings** (File → Application Settings) — global only: default serif/sans font
  families and the hands-free audio-control mode (Voice/Claps/Both).
- **Tab Settings** (View → Tab Settings) — everything per-document: theme, SPRITZ word display
  (context before/after, guides, serif, ORP highlight), line-view options, faces, pointer,
  playback, double-time multipliers, annunciate, minigames.
- **Default Tab Settings** (File → Default Tab Settings) — the same tab-setting fields, editing
  the defaults applied to newly opened tabs; **Reset Tab to Default** re-applies them.

### Other
- **Find All** (Ctrl+F), **Go to Line** (Ctrl+G).
- **Multi-tab** with independent settings; per-tab header progress bar.
- **Time-remaining ETA** from your *measured* pace (recent → session → setpoint fallback).

## Data storage (IndexedDB, database `SPRITZReader`)

| Store | Key | Content |
|---|---|---|
| `files` | content checksum | per-file `FileSettings` record |
| `global` | `"settings"` | `GlobalSettings` (fonts, audio mode, per-tab defaults, recent files) |
| `readstate` | content checksum | reading state `{ maskB64, wpmB64, lifetimeActiveMs, daily }` (bit-packed read mask + per-word WPM trace) |
| `audiobook` | `checksum/lineIndex` | recorded clip `{ blob, durationMs, createdAt }` |
| `audiobookManifest` | checksum | per-line clip manifest |

## Dependencies

| Package | Purpose |
|---|---|
| `react` / `react-dom` 19 | UI |
| `vite` | dev server + build |
| `react-window` | virtualized line pane |
| `mammoth` | DOCX text extraction |
| `pdfjs-dist` | PDF text extraction |
| `epubjs` | EPUB text extraction |
| `tesseract.js` | OCR for the Grab Text wizard (lazy-loaded) |
| `idb` | IndexedDB wrapper |

Browser Web Platform APIs used directly: `crypto.subtle` (checksums), `speechSynthesis`
(TTS), `webkitSpeechRecognition` (voice/speaking), `MediaRecorder` + `getUserMedia` (audio
recording), `getDisplayMedia` (screen capture for Grab Text), Web Audio `AnalyserNode` (clap
detection), Clipboard API.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| ← / → | Previous / Next word |
| ↑ / ↓ | Previous / Next line |
| Ctrl+↑ / Ctrl+↓ | Previous / Next paragraph |
| Home | Restart |
| Ctrl+O | Open TXT file |
| Ctrl+D | Open Document (DOCX/PDF/EPUB) |
| Ctrl+B | Open from clipboard |
| Ctrl+Shift+G | Grab Text (OCR) |
| Ctrl+F | Find All |
| Ctrl+G | Go to line |
| Ctrl+T | Statistics |
| Ctrl+H | Reading History |
| Ctrl+I | Proper Names Index |
| Ctrl+Shift+F | Toggle footnote preview |
| Ctrl+Shift+A | Audiobook Manager |
| Ctrl+Shift+T | Text-to-Speech Reader |
| Esc | Close preview overlay |

## Platform adaptations & differences from the WPF app

The browser sandbox changes a few desktop behaviors; these are intentional adaptations, not
missing work:

- **Persistence** is IndexedDB rather than `%APPDATA%` JSON files. Storage is keyed by
  content checksum; because browsers cannot reopen files by path, **open-tab session
  restore** is not available — recent documents must be reopened manually.
- **Speech recognition** (voice control + speaking minigame) requires a Chromium browser
  (Chrome/Edge) where `webkitSpeechRecognition` is available; it degrades gracefully
  elsewhere with a status message.
- **TTS** uses the OS voices exposed through `speechSynthesis`; the SAPI5/WinRT split and the
  NAudio reverb-on-headings effect of the desktop TTS reader are not reproduced.
- **Audiobook** clips are WebM/Opus (`MediaRecorder`) stored in IndexedDB rather than WAV
  files on disk; export is a download.
- The **Face Library** per-color hex editor of the desktop app is simplified to a
  style+art-style gallery/assigner rather than a full recolor editor. (The WPM trendline,
  editable TOC, and original-page view are all present — see above.)
- **Background detection** uses the Page Visibility API: time is only counted while the tab
  is visible. Reading while the tab is visible but unattended (e.g. watching auto-play without
  reading) cannot be detected and is still counted.

## Regenerating the theme library

`src/state/themes.js` is generated from the WPF source so the palettes stay byte-faithful:

```
node scripts/parse-themes.mjs ["path/to/Themes.cs"]
```

It parses each `ThemePalette` definition, the `AllNames` order, and the `GetPalette` switch,
then emits the palette map, `THEME_NAMES`, `getPalette`, and `applyTheme`.
