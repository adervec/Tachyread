// Highlight algorithms for the Lines area (Tab Settings): research-backed emphasis rules that
// pick WHICH words get the chosen style. Each algorithm reflects a robust reading-science
// finding; the rationale strings surface in the settings UI so the choice is informed:
//   content  — function words (the/of/and…) are skipped or barely fixated by skilled readers
//              (Rayner 1998: ~35% of function words are fixated vs ~85% of content words);
//              fading them lets attention follow the information-carrying words.
//   long     — fixation duration grows with word length (Rayner & McConkie 1976); pre-flagging
//              long words smooths pacing by cueing the upcoming load.
//   rare     — word frequency is the strongest single predictor of fixation time (Inhoff &
//              Rayner 1986); emphasizing low-frequency words aids parafoveal preview.
//   sentence — sentence onsets get elevated attention and wrap-up effects cluster at boundaries
//              (Just & Carpenter 1980); marking starts anchors comprehension rhythm.
// (Fixation-anchor bolding — "bionic" — already exists as the separate Bionic font toggle.)
// Pure + node-testable; rendering lives in LinePane.

export const HIGHLIGHT_ALGOS = [
  { id: 'off', label: 'Off', desc: '' },
  {
    id: 'content', label: 'Content words (fade function words)',
    desc: 'Skilled readers fixate only ~35% of function words (the, of, and…) vs ~85% of content words — fading them lets the eye ride the meaning-carrying words.',
  },
  {
    id: 'long', label: 'Long words',
    desc: 'Fixation time grows with word length — flagging words of 9+ letters cues the upcoming processing load before the eye lands.',
  },
  {
    id: 'rare', label: 'Rare words',
    desc: 'Word frequency is the strongest predictor of fixation duration — emphasizing uncommon words primes them in parafoveal preview.',
  },
  {
    id: 'sentence', label: 'Sentence starts',
    desc: 'Sentence onsets anchor comprehension and processing "wrap-up" clusters at boundaries — marking each start paces the reading rhythm.',
  },
];
export const HIGHLIGHT_STYLES = [
  { id: 'bold', label: 'Bold' },
  { id: 'tint', label: 'Tint (colour)' },
  { id: 'underline', label: 'Underline' },
  { id: 'glow', label: 'Glow' },
];
export const highlightAlgoById = (id) => HIGHLIGHT_ALGOS.find((a) => a.id === id) || HIGHLIGHT_ALGOS[0];

// ~150 highest-frequency English function words (articles, prepositions, conjunctions, pronouns,
// auxiliaries). Deliberately conservative: only unambiguous closed-class words fade.
const FUNCTION_WORDS = new Set(('the a an and or but nor so yet of in on at by for with to from into onto over under above below ' +
  'between among through during before after since until about against along around behind beside besides beyond despite down ' +
  'except inside near off out outside past per than toward towards underneath unlike up upon within without ' +
  'i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself yourself himself ' +
  'herself itself ourselves yourselves themselves this that these those who whom whose which what ' +
  'is am are was were be been being do does did done have has had having will would shall should can could may might must ' +
  'not no nor as if then else when while where why how all any both each few more most other some such only own same too very ' +
  'just also there here because although though unless whether once again further once ever never always often'
).split(/\s+/));

// A compact common-word list on top of the function words — rarity ≈ "not common AND longish".
const COMMON_EXTRA = new Set(('time year people way day man thing woman life child world school state family student group country ' +
  'problem hand part place case week company system program question work government number night point home water room mother ' +
  'area money story fact month lot right study book eye job word business issue side kind head house service friend father power ' +
  'hour game line end member law car city community name president team minute idea body information back parent face others level ' +
  'office door health person art war history party result change morning reason research girl guy moment air teacher force education ' +
  'said made went come came get got take took see saw know knew think thought look looked want wanted give gave use used find found ' +
  'tell told ask asked seem seemed feel felt try tried leave left call called good new first last long great little old big high ' +
  'small large next early young important public bad able').split(/\s+/));

const stripEdge = (w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');

// The class a word earns under an algorithm: 'hl-mark' (emphasize), 'hl-fade' (de-emphasize),
// or null. `ctx.sentenceStart` marks the first word after a sentence end / paragraph start.
export function hlWordClass(rawTok, algo, ctx = {}) {
  if (!algo || algo === 'off') return null;
  const w = stripEdge(String(rawTok || '')).toLowerCase();
  if (!w) return null;
  switch (algo) {
    case 'content': return FUNCTION_WORDS.has(w) ? 'hl-fade' : null;
    case 'long': return w.length >= 9 ? 'hl-mark' : null;
    case 'rare':
      // ponytail: rarity ≈ "not in the common lists and 7+ letters" — a real frequency corpus
      // would ship megabytes for a marginally better split.
      return !FUNCTION_WORDS.has(w) && !COMMON_EXTRA.has(w) && w.length >= 7 ? 'hl-mark' : null;
    case 'sentence': return ctx.sentenceStart ? 'hl-mark' : null;
    default: return null;
  }
}

// Does this text end a sentence (terminator, optionally followed by closing quotes/brackets)?
export function endsSentence(text) {
  return /[.!?…]["'”’)\]]*\s*$/.test(String(text || ''));
}
