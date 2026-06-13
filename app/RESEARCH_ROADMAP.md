# Research roadmap — maximal, ever‑improving read/write rate (with comprehension + comfort)

This is the design north star for Tachyread's reading/typing-rate features. The goal: let a user
**input and output text at an ever‑improving rate while holding baseline comprehension and comfort.**

## The finding that drives the design

The bottleneck on reading rate is **language/cognitive processing, not the eyes.** Visual word
identification needs only ~50–60 ms; you can't "see faster" into comprehension. RSVP's one real trick —
removing eye movements — also removes **regressions**, which *help* comprehension. Subvocalization caps
full‑comprehension reading around **~400 wpm**; above ~500–600 wpm comprehension reliably drops. Bionic
bolding shows **no** average speed benefit across thousands of readers.

**Implication:** "maximal rate" is not a flashing‑words problem. It's a **closed‑loop training + matching
problem** — push rate only as fast as *measured* comprehension and comfort allow, train the real limiters,
and match speed to the material. Tachyread already **measures** real WPM, coverage and re‑reads; the missing
pieces are a comprehension signal and a control loop on top. (See sources at the end.)

## Design principle

> Raise rate only as measured comprehension + comfort hold. Train the real limiters (language processing,
> vocabulary, perceptual span, subvocalization, motor output). Match speed to material difficulty.
> Be honest about evidence — this is the only product story consistent with our own DISCLAIMER.

## Tier 1 — highest impact, evidence‑backed, great app‑fit
- **Comprehension probes** — auto‑generated, low‑friction (inline cloze / end‑of‑chunk recall / 1‑tap
  confidence). You can't gate on what you don't measure.
- **Comprehension‑gated adaptive pacing** — double‑staircase: step WPM **up** after N consecutive passes,
  **down ~12%** on a miss/regression burst. This is the "ever‑improving while staying comprehensible" loop;
  validated adaptive reading‑acceleration training even changes brain circuitry.
- **Surprisal / difficulty‑weighted dwell** — spend ms where the *information* is. Reading time scales with
  word **surprisal**; upgrade the current double‑time multipliers to per‑word dwell from word‑frequency +
  predictability. Biggest *effective*-rate win at constant comprehension.
- **Personal calibration** — perceptual span, comprehension‑floor speed, context‑word count, ORP offset all
  vary per reader; calibrate the operating point.

## Tier 2 — capacity training (durable, transferable gains)
- **Visual/perceptual‑span expansion** drills (flashed n‑gram/chunk recognition). The one classic technique
  with decent evidence (~+63% max reading speed after a few days in one study) — but gains mostly *exploit*
  the existing ~15‑char span; set honest expectations.
- **Regression‑aware line mode** — measure/coach unhelpful regressions in normal‑layout reading, but never
  block purposeful re‑reads (they aid comprehension). RSVP trains pace; line mode trains transfer.
- **Subvocalization‑suppression "skim" mode** — faster‑than‑speech RSVP, explicitly labeled "skim/scan,
  expect lower recall." Honest about the comprehension trade.
- **Periodized program + spaced repetition** — progressive overload + deload; auto‑collect stumbled‑on rare
  words into an SRS deck (vocabulary is a real rate limiter).

## Tier 3 — the output side (input *and* output)
Output rate is dominated by **output‑per‑keystroke** (steno ~200–360 wpm vs ~40–95 QWERTY). The typing
minigame is QWERTY‑only — extend it:
- **Dictation‑throughput mode** — score net output WPM + accuracy via Web Speech; feed the same adaptive ramp.
- **"Flow typing"** — aggressive next‑word prediction (tap‑to‑accept), abbreviation/expansion, optional
  steno‑lite chord layer. Measure net WPM, not keystrokes.
- Apply the comprehension/accuracy‑gated ramp to output too.

## Tier 4 — frontier / experimental (opt‑in, caveated, safety‑gated)
- **Webcam gaze‑contingent training (WebGazer.js, fully local)** — the real perceptual‑span paradigm
  (moving window/mask), live regression detection, fixation biofeedback, attention‑gated RSVP. Low accuracy;
  must stay on‑device (fits our privacy stance).
  - **Not shipped — license blocker.** WebGazer.js is **GPL‑3.0‑or‑later**, which is incompatible with
    bundling into this MIT app. Rather than relicense or add a copyleft dependency, the gaze *intent*
    (attention readout / regression feedback) is delivered behaviorally instead — see **Attention Check**
    (on‑device focus estimate from regression bursts + comprehension + pace) and the **Regression Report**.
    A future webcam mode would need a permissively‑licensed tracker or a user‑supplied opt‑in script.
- **Rhythmic auditory pacing / temporal entrainment** — a subtle adaptive beat to entrain cadence. Low risk.
- **40 Hz "focus primer" (audio/visual)** — gamma stimulation is exciting for brain health and pairs with
  WM/motor gains via tACS, **but** single‑session sensory 40 Hz entrains EEG **without** acute cognitive
  benefit, and a flickering screen is a **photosensitive‑seizure hazard** (see our disclaimer). If built:
  hard opt‑in, seizure gating, "experimental, unproven for reading."
- **Behavioral attention‑state pacing** — derive attention from error rate / pace variance / regression
  bursts (skip EEG neurofeedback; it doesn't beat sham and far‑transfer to reading is weak).

## Comfort & safety (makes "maximal" sustainable)
- Fatigue/attention monitor from behavioral proxies → microbreak prompts; auto speed‑backoff when accuracy
  or pace degrade.
- Eye‑strain presets (contrast, spacing, warmth, dark mode) + a comfort score.
- Seizure‑safety layer governing any flicker/animation feature (gate by the disclaimer ack; cap flash rates).

## Recommended build order
1. **Comprehension probes + comprehension‑gated adaptive engine** ← flagship; extends the existing tracker.
2. **Surprisal‑weighted dwell** — principled upgrade of double‑time multipliers.
3. **Capacity drills** (span + regression‑aware + spaced vocab).
4. **Output track** (dictation throughput + flow/predictive typing) under the same ramp.
5. **Comfort/calibration** layer.
6. **Frontier opt‑ins** (gaze‑contingent first; 40 Hz last, behind safety).

## Sources
- Rayner, Schotter, Masson, Potter & Treiman (2016), *So Much to Read, So Little Time*, **Psychological
  Science in the Public Interest** — https://journals.sagepub.com/doi/10.1177/1529100615623267
- UCSD — speed‑reading apps may impair comprehension —
  https://today.ucsd.edu/story/dont_believe_what_you_read_only_once_speed_reading_apps_may_impair_reading
- Schotter, Tran & Rayner (2014), parafoveal preview / span —
  http://faculty.cas.usf.edu/eschotter/papers/Schotter_Tran_Rayner_2014_PsychSci.pdf
- Visual‑span training & reading speed — https://pubmed.ncbi.nlm.nih.gov/22750053/
- Reading‑acceleration training changes brain circuitry — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4178249/
- Bionic reading, 2,074 readers (no speed benefit) — https://blog.readwise.io/bionic-reading-results/
- 40 Hz gamma stimulation & brain health — https://www.sciencedaily.com/releases/2025/03/250303141656.htm
- Single‑session 40 Hz: EEG entrainment without acute cognitive gain —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11864247/
- Neurofeedback for attention — meta‑analysis — https://pmc.ncbi.nlm.nih.gov/articles/PMC12224457/
- Stenography throughput — https://www.121captions.com/how-do-stenographers-type-so-fast/live-captioning-services/

_Nothing here is medical, educational, or efficacy advice — see [`../DISCLAIMER.md`](../DISCLAIMER.md)._
