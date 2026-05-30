// Build a reader document from grabbed/OCR'd segments. Each segment keeps its original image
// so the Source pane can show the captured page beside the reading position (like PDF pages).
import { readerDocFromText, attachChecksum } from './readerDocument.js';

const SEGMENT_SEPARATOR = '\n\n';

// segments: [{ text, image }] (image = dataURL of the original capture)
export async function buildGrabbedDoc(segments, name = 'Grabbed text') {
  const texts = segments.map((s) => (s.text || '').trim());
  const doc = readerDocFromText(texts.join(SEGMENT_SEPARATOR), name);

  // Map each word back to the segment (image) it came from, for the synced Source pane.
  const map = new Uint32Array(doc.words.length);
  let wi = 0;
  for (let s = 0; s < texts.length; s++) {
    const n = (texts[s].match(/\S+/g) || []).length;
    for (let k = 0; k < n && wi < doc.words.length; k++) map[wi++] = s;
  }
  while (wi < doc.words.length) map[wi++] = Math.max(0, texts.length - 1);

  doc.wordToSegment = map;
  doc.segmentCount = texts.length;
  doc.source = { kind: 'images', images: segments.map((s) => s.image) };
  await attachChecksum(doc);
  return doc;
}
