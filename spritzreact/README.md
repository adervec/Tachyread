# spritzreact (app)

This folder is the React + Vite application. For the project overview,
disclaimers, privacy notes, and license, see the **[repository README](../README.md)**.

## Commands

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # production build -> dist/
npm run preview  # preview the production build
npm run lint     # eslint
```

Requires Node.js 20.19+ or 22.12+.

## Where things are

- Architecture & feature reference: [`DESIGN.md`](./DESIGN.md)
- Source: [`src/`](./src) — see the source-layout table in `DESIGN.md`.
- Themes are generated from the original WPF app: `node scripts/parse-themes.mjs`.

## Important

This app flashes text rapidly and uses microphone/screen/speech features. Read
the [disclaimer](../DISCLAIMER.md) and [privacy notes](../PRIVACY.md) before use.
