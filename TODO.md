# To do

## Effect on words moved past by reading aloud, stronger the better they were read

An option to show an effect on the words the text moved past while advancing by reading aloud, more intense the better each word was read.

Notes for whoever builds it, checked against the code:

- The matcher already knows, per heard word, which text word it matched. Its trace pairs each heard word with a text word (or none). Text words between two matches were skipped.
- Per-word "how well" could come from:
  - an exact match (best)
  - a fuzzy match, using its similarity score
  - a skipped or misheard word (weakest)
  The matcher has the similarity but doesn't return it yet; returning it in the trace is a small change.
- A per-word voice score isn't available. Voice scores (depth, clarity…) are averages over a session or take, not per word. Per word, only the match quality is realistic. The live voice score at that moment could tint the whole phrase.
- The reading panes don't style individual words by how they were read today. The reading tracker records how each word was first read (spoken words are tagged), but nothing in the line or reader panes draws per-word marks. A transient effect, such as a glow that fades over a second or two on the words just passed, is the light version and needs no stored data. A lasting mark would need a per-word quality value kept alongside the read mask.
- Effect styles: off, glow, colour, or a particle "pop" for perfect words. Intensity scales with match quality. Under reduced motion, use colour only.
- The Audiobook Manager's read-through already turns words green as they're said, and could use the same intensity scale.

## Typing: Ctrl+Backspace as the only backspace

An option in typing mode where plain Backspace does nothing and Ctrl+Backspace is the only way to correct. You wipe the whole word you're on and retype it, rather than nibbling single letters.

Notes for whoever builds it, checked against the code:

- Today the typing key handler ignores any key pressed with Ctrl, so Ctrl+Backspace falls through to the browser's own "delete previous word". The run sees that as the typed text shrinking, so it already works as "clear the current word" without the app knowing.
- That shortcut is also Option+Backspace on a Mac, and phone keyboards usually have no equivalent. The option should say it needs a physical keyboard, or offer an on-screen "clear word" key.
- The new option is a fourth "discipline" tile alongside No backspace, Fix errors and Stop on error. Plain Backspace is refused, with the "wrong key" sound, the same way No backspace refuses it now.
- Decide what Ctrl+Backspace does on an empty word. Plain Backspace on an empty word currently reopens the previous word. The same could apply here (reopen and clear the previous word), or it could be blocked.
- It conflicts with No backspace, which blocks every correction, so turning one on should turn the other off. It combines fine with Fix errors.
- The browser's word delete stops at punctuation, so on a word like "don't" it may only clear part of it. Handling Ctrl+Backspace in the app (clear the current word buffer outright) makes it predictable.

## Bug: full JSON backup fails with a string length error

Saving the full backup (Data → backup to a JSON file) failed with a string-length error.

Likely cause, from reading the code (not yet reproduced):

- The backup is built as one object holding every store, and then turned into one string in a single go. Browsers cap a single string at roughly 512 MB in Chrome, and less in some others. A big library goes over that cap.
- The audiobook store is the big part. Every narration and generated clip is binary audio, and is written into the backup as base64 text, which is about a third larger than the audio itself. Each base64 string is also built by joining pieces one at a time. Saved documents and grabbed pages add more.
- Even when the string fits, the dialog keeps the whole backup text in memory to offer "Copy JSON" and show it in a text box. That roughly doubles memory use and can freeze the page on a large backup.

Fix ideas:

- **Write the file in pieces:** build the JSON one record at a time into a list of chunks and save them as one file, so no single string ever holds the whole backup. Use the file picker's writable stream where available, so it isn't all in memory at once.
- **Make audio optional, or a separate file:** offer "Back up without audio", or save audio as its own file next to the JSON. The Audiobook Manager's own transfer export already moves audio between devices.
- **Drop "Copy JSON" and the text box** once the backup is past a size threshold, saying "too large to show — use the file".
- **Restore has the same limit:** it reads the whole file into one string before parsing, so a big backup may not load back either. Restore needs the matching piece-by-piece approach, or the audio split above. Test both directions on a library with a lot of audio.
- **Say what's big:** before saving, show how big each store is, so you can tell where the size comes from.
