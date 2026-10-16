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
