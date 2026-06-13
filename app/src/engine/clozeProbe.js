// Auto-generate a cloze comprehension probe from text the reader just covered: blank one content word
// and offer multiple-choice distractors drawn from other content words in the passage. No authored
// questions needed, so it works on any document. Pure.

const STOP = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','as','is','are','was','were','be',
  'been','being','it','its','this','that','these','those','he','she','they','we','you','i','him','her','them',
  'his','hers','their','our','your','from','by','not','no','nor','so','if','then','than','too','very','can',
  'could','will','would','shall','should','may','might','must','do','did','does','done','has','have','had',
  'about','into','over','under','out','up','down','off','again','more','most','some','any','all','each','also',
  'there','here','what','when','where','which','who','whom','why','how','because','while','after','before',
]);

function clean(w) { return (w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); }
function isContent(w) {
  const c = clean(w);
  return c.length >= 4 && /\p{L}/u.test(c) && !STOP.has(c.toLowerCase());
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Build a probe from doc.words over [startIdx, endIdx). Uses doc.sentences/wordToSentence for context when
// available. Returns { words:[{w,blank}], answer, choices:[str], answerIndex } or null if not buildable.
export function makeClozeProbe(doc, startIdx, endIdx, rand = Math.random) {
  if (!doc || !Array.isArray(doc.words)) return null;
  const a = Math.max(0, Math.min(doc.words.length, startIdx | 0));
  const b = Math.max(a, Math.min(doc.words.length, endIdx | 0));
  const cands = [];
  for (let i = a; i < b; i++) if (isContent(doc.words[i])) cands.push(i);
  if (cands.length < 3) return null;
  const blankAt = cands[Math.floor(rand() * cands.length)];
  const answer = clean(doc.words[blankAt]);
  if (!answer) return null;

  // Context = the sentence containing the blank (fallback: a word window around it).
  let cs = Math.max(a, blankAt - 9), ce = Math.min(b, blankAt + 10);
  if (Array.isArray(doc.wordToSentence) && Array.isArray(doc.sentences)) {
    const sent = doc.sentences[doc.wordToSentence[blankAt]];
    if (sent) { cs = sent.startWordIndex; ce = sent.endWordIndex + 1; }
  }
  const words = [];
  for (let i = cs; i < ce; i++) words.push({ w: doc.words[i], blank: i === blankAt });

  // Distractors: other content words, preferring similar length, unique, case-insensitively != answer.
  const seen = new Set([answer.toLowerCase()]);
  const pool = [];
  for (const i of cands) {
    const w = clean(doc.words[i]);
    const k = w.toLowerCase();
    if (w && !seen.has(k)) { seen.add(k); pool.push(w); }
  }
  pool.sort((x, y) => Math.abs(x.length - answer.length) - Math.abs(y.length - answer.length));
  const distract = pool.slice(0, 3);
  if (distract.length < 2) return null; // need at least a couple of plausible options
  const choices = shuffle([answer, ...distract], rand);
  return { words, answer, choices, answerIndex: choices.indexOf(answer) };
}
