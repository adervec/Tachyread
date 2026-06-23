# Third-Party Notices

This project depends on the open-source packages below. All are under permissive
licenses (MIT, BSD-2-Clause, ISC, Apache-2.0) — none are copyleft. Each package
remains under its own license and copyright; this file provides attribution.

Full license texts ship with each package inside `node_modules/<pkg>/` and are
available from the upstream projects linked below. If you distribute a **built
bundle** of this app, include these notices (and any Apache-2.0 `NOTICE` files)
with it.

## Runtime dependencies (bundled into the build)

| Package | License | Project |
|---|---|---|
| react, react-dom | MIT | Meta — https://react.dev |
| three | MIT | three.js authors — https://threejs.org |
| @react-three/fiber | MIT | Poimandres — https://github.com/pmndrs/react-three-fiber |
| @react-three/drei | MIT | Poimandres — https://github.com/pmndrs/drei |
| react-window | MIT | Brian Vaughn — https://github.com/bvaughn/react-window |
| idb | ISC | Jake Archibald — https://github.com/jakearchibald/idb |
| mammoth | BSD-2-Clause | Michael Williamson — https://github.com/mwilliamson/mammoth.js |
| epubjs | BSD-2-Clause | Futurepress — https://github.com/futurepress/epub.js |
| pdfjs-dist | Apache-2.0 | Mozilla — https://github.com/mozilla/pdf.js |
| tesseract.js | Apache-2.0 | https://github.com/naptha/tesseract.js |

### Tesseract OCR data

`tesseract.js` downloads, at runtime, the Tesseract WASM core and the English
trained-data model (`eng.traineddata`). Tesseract OCR and its trained data are
licensed under **Apache-2.0** (https://github.com/tesseract-ocr/tesseract and
https://github.com/tesseract-ocr/tessdata).

## Development dependencies (not shipped in the build)

| Package | License |
|---|---|
| vite, @vitejs/plugin-react | MIT |
| eslint, @eslint/js | MIT |
| eslint-plugin-react-hooks, eslint-plugin-react-refresh | MIT |
| @types/react, @types/react-dom | MIT |
| globals | MIT |

## Fonts

The app uses the reader's system fonts plus a set of **bundled open fonts**, and
can optionally load the full **Google Fonts** library on request. It bundles or
hot-links **no proprietary fonts**.

### Bundled open fonts (shipped in the build, via `@fontsource`)

All are libre — **SIL Open Font License 1.1** unless noted **(Apache-2.0)** — and
each `@fontsource` package carries its upstream `LICENSE`/`OFL.txt`. If you
distribute a built bundle, keep those notices with it.

| Family | License | Family | License |
|---|---|---|---|
| Inter | OFL | Lora | OFL |
| Source Sans 3 | OFL | Source Serif 4 | OFL |
| Work Sans | OFL | EB Garamond | OFL |
| Nunito | OFL | Merriweather | OFL |
| Open Sans | OFL | Literata | OFL |
| Lato | OFL | Bitter | OFL |
| Atkinson Hyperlegible | OFL | Playfair Display | OFL |
| OpenDyslexic | OFL | Crimson Pro | OFL |
| JetBrains Mono | OFL | Fira Code | OFL |
| Source Code Pro | OFL | | |

### Google Fonts (optional, off by default)

When the user enables **Application Settings → Fonts → Google Fonts library**,
the app loads the chosen families from Google's CDN (`fonts.googleapis.com` /
`fonts.gstatic.com`). Every Google Fonts family is released under the SIL Open
Font License, Apache-2.0, or the Ubuntu Font License. This is opt-in because it
contacts Google's servers (see `PRIVACY.md`).

The companion `Associated Guides/typing-speed-field-guide.html` likewise loads
Fraunces, IBM Plex Sans, and JetBrains Mono from Google Fonts (SIL OFL).

---

_Run `npm ls --all` or inspect `node_modules` for the complete, transitive
dependency list and exact versions. Generate a full license report any time with
a tool such as `npx license-checker --summary`._
