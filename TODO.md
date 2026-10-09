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
