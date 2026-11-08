# To do

Backlog from the 2026-11 GitHub sweep (sharing/lending items excluded by choice). Built in chunks;
delete an item when it ships.

## Chunk 8 — Audio & speaking
- Word-exact highlighting for Kokoro narration (kokoro-js doesn't expose per-word timings yet).

## Pocket listening — follow-ups
- iPhone: Safari can't play Ogg Opus — clips would need a CAF or WebM container (clipCodec keeps WAV there for now).
- Faster WASM Kokoro on phones without WebGPU needs cross-origin isolation (COOP/COEP via the service worker), which would break the Google sign-in popup — revisit only with a Drive-free sync path.
