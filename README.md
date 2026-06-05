# SPRITZ Reader (React)

A browser-based **speed-reading** app. Text is shown one word at a time, centered
on an Optimal Recognition Point (ORP) — the **RSVP** technique — so you can read
at high words-per-minute with minimal eye movement. Around that core it carries a
large feature set: TXT/DOCX/PDF/EPUB import, OCR "grab text," ~30 themes,
animated reader faces, integrated text-to-speech, voice/clap control, typing &
speaking minigames, audiobook recording, measured reading stats, an editable
table of contents, and more.

It's a React/Vite port of an earlier WPF desktop app, and it's a **free,
non-commercial hobby project**.

> ## ⚠️ Please read before using
> - **Photosensitivity/seizure warning:** this app flashes words rapidly (up to
>   ~1500 WPM) and has animated, neon, and pulsing visuals. If you have a history
>   of seizures, talk to a doctor first and stop if you feel unwell.
> - **Not professional advice.** The author is a software hobbyist — **not a
>   doctor, coach, teacher, or lawyer.** Reading stats are for fun, not a clinical
>   or educational assessment.
> - **Not affiliated with Spritz Technology, Inc.** "Spritz" is their trademark;
>   it's used here only to describe the reading style.
>
> Full details: **[DISCLAIMER.md](./DISCLAIMER.md)** · **[PRIVACY.md](./PRIVACY.md)**

## Run it locally

The app lives in [`spritzreact/`](./spritzreact).

```bash
cd spritzreact
npm install
npm run dev      # start the dev server
npm run build    # production build to dist/
npm run lint     # eslint
```

Requires Node.js 20.19+ or 22.12+.

## Privacy at a glance

Fully client-side: **no backend, no account, no telemetry.** Your documents,
settings, and history stay in your browser (IndexedDB). Some optional features
touch your mic, screen, or third parties (notably, Chrome's speech recognition
sends audio to Google, and OCR downloads its data from a CDN on first use). See
**[PRIVACY.md](./PRIVACY.md)**.

## Tech stack

React 19 · Vite · three.js / react-three-fiber · pdf.js · mammoth · epub.js ·
tesseract.js · react-window · idb. Web Platform APIs: Web Speech, Web Audio,
MediaRecorder, Screen Capture, IndexedDB, `crypto.subtle`.

See [`spritzreact/DESIGN.md`](./spritzreact/DESIGN.md) for the full as-built
architecture.

## License & notices

[MIT](./LICENSE) © 2026 Adam Erik Eryavec. Third-party dependencies and their
licenses are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Open-sourcing checklist and open decisions: [GOING_PUBLIC.md](./GOING_PUBLIC.md).
