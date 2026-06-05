# Going Public — Plan & Checklist

A practical checklist for open-sourcing this repo. It's a **non-commercial hobby
project** with **no plans to monetize**, so the bar is "clean, honest, and
low-risk," not "enterprise compliance." Items already handled in the repo are
checked; items needing **your** decision or action are called out.

---

## 0. Two decisions only you can make

### A. License model — _drafted as MIT_
[`LICENSE`](./LICENSE) is currently **MIT**: anyone may use, modify, and
redistribute, **including commercially**. That's the standard, friction-free
choice and it fits "I'm not monetizing this."

- If you're fine with others (even companies) reusing it → **keep MIT**. ✅ recommended
- If you specifically want to **forbid others from monetizing** it → switch to a
  *source-available* non-commercial license such as **PolyForm Noncommercial**
  or **CC BY-NC** (note: these are **not** OSI "open source," and GitHub won't
  show an open-source badge). Tell me and I'll swap it.

> Easy to change now while the repo is private. Lock it in before flipping public.

### B. The name — ✅ RESOLVED: renamed to **Tachyread**
"**Spritz**" is a trademark of **Spritz Technology, Inc.**, the company that
commercialized this exact one-word-at-a-time ORP reading method. Naming the
project "SPRITZ Reader" / `SPRITZReact` and using "SPRITZ" throughout could draw
a trademark complaint — risk is **lower** for a free, non-commercial project, but
not zero, and a public repo is public use.

Options:
1. **Rename** to a generic term — *RSVP Reader*, *ORP Reader*, *FlashRead*,
   *QuickWord*, etc. Safest; removes the issue entirely. Touches the repo name,
   UI strings, the IndexedDB database name (`SPRITZReader`), and docs.
2. **Keep the name** + rely on the non-affiliation disclaimer (already written in
   [`DISCLAIMER.md`](./DISCLAIMER.md)). Lower effort, residual risk.

✅ Renamed to **Tachyread** across the UI, window title, the core one-word pane
(now labeled **"Flash"**), the IndexedDB DB name, the package name, and the docs.
Remaining manual step on your side: rename the GitHub repo `SPRITZReact` →
`Tachyread` (Settings → General → Repository name), then point your clone at it
with `git remote set-url origin <new-url>`. The Pages base path in `deploy.yml`
is already set to `/Tachyread/` to match.

---

## 1. License & dependency legality — ✅ done
- [x] MIT license added (swappable — see decision A).
- [x] **Dependency audit:** every dependency is permissively licensed — **no
      copyleft, no conflicts.**

  | Package | License | | Package | License |
  |---|---|---|---|---|
  | react / react-dom | MIT | | mammoth | BSD-2-Clause |
  | three | MIT | | epubjs | BSD-2-Clause |
  | @react-three/fiber, drei | MIT | | idb | ISC |
  | react-window | MIT | | pdfjs-dist | Apache-2.0 |
  | vite, eslint, plugins | MIT | | tesseract.js | Apache-2.0 |

- [x] [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) created (Apache-2.0 /
      BSD attribution; tesseract trained-data note).
- [x] Original WPF app you ported (themes, design) is **your own IP** — fine to
      relicense as MIT.

## 2. Disclaimers — ✅ done
[`DISCLAIMER.md`](./DISCLAIMER.md) covers, in plain language:
- [x] "I'm a software guy, **not a doctor, coach, teacher, or lawyer**" — no
      medical / educational / coaching / legal advice.
- [x] **⚠️ Photosensitivity / seizure warning** (rapid flashing text up to
      1500 WPM, neon/pulsing themes, blinking pointers).
- [x] **No speed-reading efficacy claims** — stats are for fun, not a clinical or
      educational assessment.
- [x] **Trademark / non-affiliation** with Spritz Technology, Inc. and others.
- [x] **Your-content responsibility** (you must have rights to what you load/OCR).
- [x] No-warranty restatement of the MIT terms.

## 3. Privacy — ✅ done
[`PRIVACY.md`](./PRIVACY.md): fully client-side, no telemetry/account. Flags the
network/hardware touch-points honestly:
- [x] Mic (clap/voice/record), screen capture (Grab Text).
- [x] **Chrome `webkitSpeechRecognition` sends audio to Google** (browser
      behavior).
- [x] tesseract.js downloads OCR data from a CDN on first use.
- [x] Right-click word lookups open Google/Merriam-Webster.

## 4. Repo hygiene — ✅ done in this change
- [x] Added a root [`.gitignore`](./.gitignore).
- [x] **Untracked** (kept on disk, removed from the repo going forward):
  - `.vs/` — Visual Studio folder incl. the binary `.suo` user-options file.
  - `spritzreact/obj/` — MSBuild intermediate output.
  - `spritzreact/2026-05-24-…port-the-wpf-app….txt` — a **Claude Code session
    transcript** containing your local Windows paths and prompts. Not something
    to publish.
- [x] **Deleted** unused template leftovers: `src/assets/{hero.png, react.svg,
      vite.svg}` and `public/icons.svg` (a social-logo sheet from a scrapped
      landing page; contained third-party brand marks — now gone).

### ⚠️ 4b. Git history still contains the removed files — your call
Untracking removes files from **future** commits, but they remain in **git
history** (recoverable from old commits). For a hobby repo under your own name
this may be fine. If you want them truly gone before going public, scrub history
with **`git filter-repo`** (or BFG) to purge:
`.vs/`, `**/obj/`, and the `…port-the-wpf-app….txt` transcript — then force-push.
Tell me if you want this and I'll prepare the commands. (Do it before adding
collaborators/forks.)

## 5. Content to verify — ⬜ your check
- [ ] `Associated Guides/typing-speed-field-guide.html` — confirm it's **your own
      writing** (it looks original; loads only open-licensed Google Fonts). Decide
      whether it ships with the public repo.
- [ ] Skim the app's built-in sample/placeholder strings for anything personal.

## 6. Security — ✅ / optional
- [x] **No secrets** in source (keyless, no backend).
- [x] CI (lint + build) already runs on push/PR.
- [ ] _Optional:_ branch protection requiring CI to pass before merge to `main`
      (Settings → Branches → Add rule). `gh` isn't installed here, so this is a
      quick manual step — or install `gh` and I'll script it.
- [ ] _Optional:_ enable Dependabot / `npm audit` in CI.

## 7. Recommended (optional) — surface disclaimers in the app
Right now the disclaimers live only in repo docs; someone using the deployed app
won't see them. Consider:
- [ ] A first-run **"About / Disclaimer"** notice (seizure warning + "not
      medical/coaching advice" + non-affiliation), dismissible.
- [ ] A one-time note before first mic/screen/speech use.

Say the word and I'll build a small dialog + footer link.

## 8. Flip-to-public steps
1. Settle decisions **A** (license) and **B** (name).
2. Verify §5 content; decide on §4b history scrub.
3. Merge `dev` → `main` so docs + CI are on the default branch.
4. GitHub → **Settings → General → Danger Zone → Change visibility → Public**.
5. _(Optional demo)_ Settings → **Pages → Source: GitHub Actions**; the deploy
   workflow publishes to `https://adervec.github.io/Tachyread/`.
6. Add a repo **description** + **topics**; optionally `SECURITY.md`,
   `CONTRIBUTING.md`, and issue templates.

---

_Generated as part of go-public prep. Nothing here is legal advice — see
[`DISCLAIMER.md`](./DISCLAIMER.md). If anything trademark- or
copyright-sensitive matters to you, run it by an actual lawyer._
