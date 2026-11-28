# Overlaps and interactions (house standard 27)

Where Tachyread and another app, or Tachyread and the hub, hold the same data, do the same job, or
could feed each other. A register for the maker to choose from, not a to-do list: **an entry is not
permission to build anything.** The hub's own register is `../CoworkSyncHub/OVERLAPS.md`; the
entries it already names for Tachyread are repeated here so this file stands on its own.

One line per overlap:

    - [state] App + App: what overlaps -> what could be shared, and through what

`state` is `idea` (noticed), `planned` (the maker said yes), `done`, or `dropped` (with the reason).

Reviewed: 2026-11-28

## Already connected

- [done] Tachyread + SpeechImprover: both record you reading aloud -> Tachyread writes its narration and reading-aloud session logs into the Tachyread folder's `speech/` subfolder, and into `shared-speech.json` in the reader's cloud folder (Tachyread owns it, SpeechImprover only reads it, so it works on a phone too)
- [done] Tachyread + SimpleClicker: Grab Text's hands-free capture needs pages turned -> SimpleClicker's "Remote arm (HTTP)" loopback endpoint turns them (features/pageArm.js)
- [done] Tachyread + hub: finished reading sections, typing runs and reading-aloud sittings -> one row each in the hub's session ledger via appFont.logSession
- [done] Tachyread + every app: app font, language, units, clock, base themes, update / crash notices -> taken from the shared font.js, not kept here

## Ideas

- [idea] Tachyread + SpeechImprover: both record you reading a text aloud (Tachyread's speaking minigames and audiobook recording, SpeechImprover's reading projects) -> open a Tachyread book as a SpeechImprover reading project; one passage library
- [idea] LanguageLab + Tachyread: graded reading input is Tachyread's whole job -> LanguageLab stories open in Tachyread's reader; words tapped in either land in one list
- [idea] Tachyread + learning-pit: words and facts met while reading (Trackyread notes, the Vocabulary deck) are not reviewed anywhere else -> "send to a deck" from Trackyread notes and the Vocabulary deck
- [idea] Tachyread + HandwritingHelper: typing drills and handwriting drills both need text to copy, and both train DEX -> one passage source for both
- [idea] Tachyread + Mise + classical-journey + learning-pit + LanguageLab: each reads text aloud with its own voice and speed setting -> one shared voice setting in font.js, like the font and language
- [idea] HandwritingHelper + MarksmanApp + BodybuildingProgressCoach + MicroMiniger + Tachyread: each takes a photo and straightens, crops or reads it its own way (Tachyread: Grab Text's document camera and OCR) -> one shared capture helper
- [idea] Tachyread + SpeechImprover: both score a reading-aloud sitting (match quality, voice and presenting scores) and both now have an AI session review -> one scorer and one review rubric, shared as a font.js piece
- [idea] Tachyread + hub: Trackyread's finished-books list and reading streak overlap the hub's habits and character sheet -> the hub reads a `shared-reading.json` Tachyread owns (books finished, pages, streak) instead of inferring from ledger rows
