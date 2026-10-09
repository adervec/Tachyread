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
