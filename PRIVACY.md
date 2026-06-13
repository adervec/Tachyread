# Privacy

**Summary:** This is a fully client-side app. There is **no backend, no account,
no analytics, and no telemetry**. The app itself uploads nothing. Your
documents, settings, reading history, and audiobook clips live **only in your
browser**. A few optional features reach your device hardware or third-party
services — those are listed below so you can make an informed choice.

## What is stored, and where

Everything is stored locally in your browser using **IndexedDB** (database
`Tachyread`) and similar web storage:

- the documents/tabs you open and their per-file settings;
- global settings (fonts, defaults, recent-file list);
- reading state — read mask, per-word pace trace, daily history;
- audiobook clips you record.

There are **no cookies** set by the app and nothing is transmitted to the
author. Clearing your browser's site data for this app erases all of the above.

## Optional features that use hardware or the network

These run **only when you choose to use them**:

| Feature | API | What leaves your device |
|---|---|---|
| Clap control, audiobook recording | `getUserMedia` (microphone) | Audio is processed locally; recordings are stored locally in IndexedDB. |
| Voice commands, speaking minigame, dictation, voice "grab" | `webkitSpeechRecognition` | **In Chrome, captured audio is sent to Google's speech-recognition servers** for transcription. Microsoft Edge may use a cloud service too. This is the **browser's** behavior, outside this app's control. If you don't want audio leaving your device, don't use voice features. |
| Text-to-speech (read aloud, TTS reader) | `speechSynthesis` | Uses your OS/browser voices; **some browsers use cloud voices**. |
| Grab Text | `getDisplayMedia` (screen capture) | You pick a window/screen to share; frames are processed locally for OCR. |
| OCR | tesseract.js | On first use, downloads the OCR engine (WASM) and English data (`eng.traineddata`) from a **public CDN** (e.g. jsDelivr/unpkg). That request exposes your IP/timing to the CDN like any web download. The OCR itself runs locally in your browser. |
| Right-click word menu → "Translate (Google)", "Dictionary/Thesaurus (Merriam-Webster)" | Opens a new browser tab | The selected **word** is sent to that third-party site (Google / Merriam-Webster) when you click. Their privacy policies apply. |

## Self-hosting

Because the app is static and keyless, you can host it yourself. Even then, the
one-time OCR data download and any third-party features above still reach the
network when used; everything else stays in the browser.

## No medical/behavioral profiling

The reading statistics are computed and stored locally for your own interest.
They are not shared, sold, or used to profile you. (See [`DISCLAIMER.md`](./DISCLAIMER.md)
for why they are not a clinical or educational assessment.)
