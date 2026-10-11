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
