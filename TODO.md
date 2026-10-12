# To do

## Any number of named reading queues

Build as many queues as I like, each with its own name, and see full stats for each one. For example:
AI lore, AI science, real literature, sci-fi literature.

Each queue should show:

- **Progress**: how many items are done, and how much of the queue's total words have been read.
- **Analytics**: reading pace on that queue's books, time spent, and finishes over time.
- **ETA**: a finish date for each item and for the whole queue.
- **File presence**: whether each book's file is on this device, findable in the search folders, or missing.
- Anything else that falls out naturally, such as hours left at my reading speed and the next item up.

Notes for whoever builds it, checked against the code:

- Today there is one queue: every book whose Trackyread status is "On deck". The category pills only filter it by the fixed content types.
- A book has a single status, so a custom queue needs membership kept separately from status. That also lets one book sit in two queues.
- Order is currently by recommendation score. Custom queues probably want a hand-set order with drag to reorder.
- The ETA today divides cumulative words by recent words per day across all reading. A per-queue ETA has to decide whether to use the pace on that queue's books or overall pace.
- Books already carry free-form tags, so a queue could also be a saved filter, like "tag is sci-fi and not finished", that fills itself.
- Checking for a local copy is cheap. Searching the folders is slow, so file presence should be checked on demand or cached, not on every render.
- Queues are tracker data, so they need to ride the same cloud sync as the library.

## "Next in queue" when a book is finished

When I finish a queued book, the finished popup should offer to open the next unfinished item in that
queue whose file is available, or jump to it if it's already open in a tab.

Notes for whoever builds it, checked against the code:

- The popup is the book-finished dialog. Its save marks the file finished and, when the file is linked, marks the tracker book finished too.
- Marking a book finished moves it off the queue, so "next" should be worked out from the queue order as it stood.
- The queue's ▶ button already opens a book from an open tab, this device's copy, or the search folders. That logic lives inside the Queue view and would need lifting into a shared helper so the popup can reuse it.
- "Available" should skip items with no findable file, and say how many it skipped, rather than offer something that can't open.
- Today there's one queue. Once named queues exist, a book in several queues needs the popup to offer each one, or the one it was opened from.

## Clean up the Audiobook Manager for narrating it myself

When I read a book aloud myself, the Audiobook Manager layout is confusing and needs a cleanup. Most of all, I want to read the full text of the chunks before and after the one I'm on.

Notes for whoever builds it, checked against the code:

- There are two ways to record: the read-through wizard (one mic session for the whole book) and a per-chunk record dialog opened from the chunk table's 🎙 Rec… button.
- The read-through wizard already shows the previous and next chunk, but cut to two faded lines each. Full text could be a toggle to expand them, or a scrollable column showing several chunks either side.
- The per-chunk record dialog shows only its own chunk, cut at 220 characters, with no neighbours at all.
- In the chunk table, clicking a preview opens that one chunk's full text in a popup, with no way to step to the previous or next chunk.
- The manager mixes generated narration (queue, voices, passes) with your own recordings in the same tabs and tables. A "narrating myself" view that hides the voice-generation controls would remove much of the clutter.

## Voice-quality analysis on recorded chunks, like SpeechImprover

When I record chunks with my own voice, score each recording the way SpeechImprover does: richness, depth and the rest of its voice attributes, not just loudness.

Notes for whoever builds it, checked against both codebases:

- Tachyread already scores each take from the audio (level, peak, volume steadiness, clipping, words per minute) and turns that into a 0–100 score. Those scores show in the clip manager and as a per-book average.
- Only the read-through wizard computes that score. A clip recorded one at a time through the per-chunk 🎙 Rec… dialog, or an imported file, gets no score at all.
- SpeechImprover scores ten attributes: pace, clarity, filler economy, non-repetition/richness, resonant depth, expressiveness, non-nasal tone, no uptalk, projection, and breath & pausing. Each attribute comes with coaching tips.
- Most of these come from the audio alone, using pitch tracking and a frequency analysis. Pace, fillers and richness also need a speech-recognition transcript. Narration already knows the exact text being read, so pace can come from the chunk's word count.
- Its analysis code has no dependencies and sits in its own folder, so it could be copied across or shared. Depth is judged against a voice profile (male, female or neutral pitch centre), so Tachyread would need that one setting too.
- Tachyread already writes a narration log into a folder SpeechImprover watches, where each session counts as speech training. Richer per-take metrics could ride that same log, with its version number bumped.
- Doing a frequency analysis on every take is heavier than the current volume-only pass. It might need to run after the take is saved rather than live.

## Advance the text by reading it aloud, with live voice feedback

An option to move through the text by reading it aloud. It can't be on at the same time as voice commands. Strictness should be set with a slider or two: missing one word shouldn't stop everything, but random grunting shouldn't advance it either. While it's on, show live feedback on voice quality like SpeechImprover does (richness, depth, pacing and so on) as a running average plus a trend. The feedback is only for watching; nothing needs saving.

Notes for whoever builds it, checked against the code:

- Half of this exists. There's a "Speaking mode" in the per-tab settings, and the help text describes it as advancing when you read aloud. It uses the browser's speech recognition, which works in Chrome and Edge only.
- No menu item or button turns it on. The code only ever switches it off when another mode starts, so it's effectively unreachable today.
- Its matching is too loose and too strict at once. It compares the latest recognised phrase against only the one current word, and counts it as matching if either contains the other. So a short sound like "a" can match many words, but reading a whole sentence quickly never moves more than one word per result.
- Its only strictness setting is a Low/Medium/High confidence cut-off on the recogniser's score.
- Better matching: align the recognised words against a window of upcoming text, and jump to the furthest point that lines up. Sliders for:
  - how many words can be skipped or misheard before it stops following (lookahead window);
  - how close a word must sound to count (fuzzy match threshold);
  - minimum words matched in a row before it moves (stops grunts and single stray words advancing it);
  - the existing confidence cut-off.
- Mutually exclusive with voice commands: both listen through speech recognition, and a spoken command would be read as text. Turning one on should turn the other off, the same way typing and read-aloud already switch speaking off.
- The live voice feedback overlaps the "voice-quality analysis on recorded chunks" todo. SpeechImprover already has a live analyser built for exactly this (pitch, depth, projection, expressiveness from the mic). The same shared analysis code would serve both todos. Pace can come straight from the matched words per minute, with no transcript scoring needed.
- Keep the mic analysis light: it runs alongside the recogniser for the whole reading session, so it should sample a few times a second rather than every audio block, and drop old data as it goes.
