# To do

## Sort the open tabs

Sort the tab bar in one go instead of dragging tabs around. Each key should sort both ways.

- **Name**, A to Z.
- **Length**, by word count.
- **Completion**, by how much of the text has actually been read.
- **Position**, by how far through the document the reader is parked.
- **Time left**, the unread remainder at the reader's own words per minute.
- **Last read**, most recent first.
- **Opened**, the order the tabs were opened in, as a way back.
- **Trackyread status**, grouping Reading, On deck, To read, Finished, Abandoned and untracked.
- **Content type**, grouping long-form, short-form, articles and AI-generated.
- **File type**, grouping PDF, EPUB, text and web pages.

Notes for whoever builds it:

- Reordering only exists as a single-tab move for drag-and-drop, so a sort needs a small action that sets the whole order at once.
- The natural home is the tab right-click menu, beside Close finished.
- Unloaded tabs on phones only carry their saved settings, so every key must work from those, not from the parsed document.
- A tab whose file belongs to a named book group shows the group's name, so sorting by name would sort editions by their group. A sort could also keep a group's editions next to each other.

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

## Typing practice gets laggy after a while

A long typing run slows down until keystrokes feel delayed.

Not profiled yet. Suspects from reading the code, to check first:

- The live metrics re-score keystroke rhythm over every interval since the run began, and they run on each display tick. That array grows with every key, so the work per tick grows all run.
- The per-word results list is copied on every completed word and never trimmed.
- Every tick re-renders the whole typing run, including the trend chart. The chart is capped at about 600 points but rebuilds its SVG path each tick.
- Endless mode pre-builds a 5,000-word passage instead of topping it up.

A browser performance profile of a ten-minute run should show which of these it is.

## Gibberish typing drill

A drill of random characters from across the whole keyboard, so practice can't lean on knowing the words.

Notes for whoever builds it, checked against the code:

- The row drills already generate gibberish, but each only uses one keyboard row's characters.
- A new drill is one entry in the typing-modes list plus one line in the passage builder, using the existing random-word generator with a full-keyboard character set.
- Worth offering options for mixed case, digits and symbols.
- The typing difficulty data already scores each character, so the drill could weight towards the keys I'm weakest on.
- Side note: the "Numbers & symbols" drill only uses digits plus - and =, so it barely covers symbols.

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

## Typing WPM and sound for corrected words

Words I mistype and then fix should count properly in WPM, and finishing a fixed word should play its own sound. At the moment it plays the "word failed" sound.

Notes for whoever builds it, checked against the code:

- Net WPM is (characters typed ÷ 5 − errors) per minute. Every wrong keystroke is counted as an error the moment it's typed, and nothing takes it back when it's fixed. So a fixed word is penalised exactly like one left wrong.
- The typed-character count also includes the wrong keystrokes and the retypes, so gross WPM counts effort, not finished text.
- The usual convention (Monkeytype and similar) is that net WPM counts only the characters of correctly finished words, so time spent fixing slows you down without counting as an error. Accuracy is where the fixed mistakes still show up.
- A word only counts as perfect if no wrong key was pressed in it. Anything else plays the "word error" sound, whether it ended up correct or not.
- The fix is a third outcome, "corrected": the word matches the target but had a mistake on the way. Give it its own sound setting next to "word perfect" and "word error", with its own default. It should keep resetting the clean line, sentence and paragraph streaks, as it does now.
- Results are stored per word as perfect or not. Storing the corrected state too would let the results screen show perfect, corrected and wrong counts. Problem-word mining could treat corrected words as near-misses.
- One-word mode already treats a fixed word as perfect. Once there are three outcomes, decide whether it should report "corrected" instead.

## Split grades for long typing runs

After a long typing run, keep the overall grade as it is now. Also split the run into halves, thirds and quarters, and show each part's averages and grade. Add a differential grade too: how much I sped up or slowed down from start to finish.

Notes for whoever builds it, checked against the code:

- The grade today is a letter from net WPM alone: A at 90 and above, B 70, C 50, D 35, F below that.
- The results chart is fed by samples taken every tick, but those are running totals since the start, not per-part numbers. A part's own WPM is the difference between the totals at its two ends.
- The sample list only keeps the most recent ~600 points, so on a long run the start has already been dropped. A split needs its own unbounded record of time and characters, kept small: one entry every few seconds or per word.
- Per-word results already carry each word's time, so splitting by words (each part has the same number of words) is possible without new tracking. Splitting by time needs the record above.
- Each part should show net WPM, gross WPM, accuracy and its grade. The differential could be last part minus first, or the slope across all parts, shown as a signed number with its own grade scale, for example holding pace within ±5% counts as an A.
- "Pretty long" needs a threshold, such as only showing quarters after a few minutes and halves after one minute, so short runs don't get noisy splits.
- Ties into the typing-lag todo: the new record must stay cheap per tick.
