// Add documents to Trackyread WITHOUT opening them. Each file is parsed just long enough to learn its
// checksum and length, bound to a tracker book (an existing one of the same title, else a new one,
// status "to read"), then dropped — so a whole folder of books goes in without the memory of
// hundreds of open tabs. Files already bound are skipped. A bare settings record (name + length, no
// text) is saved so Trackyread can show and find the file later, like one read on another device.
import { parseFile } from '../document/parsers.js';
import { getBinding, setBinding, getLibraryBook, saveLibraryBook, loadFile, saveFile } from '../state/storage.js';
import { bookFromOpenedDoc } from './trackyreadAdd.js';

// onProgress({ i, total, name }) before each file; shouldStop() checked between files.
export async function trackFiles(files, { status = 'toread', onProgress, shouldStop } = {}) {
  let map = await getBinding();
  const r = { tracked: 0, linked: 0, skipped: 0, failed: 0, stopped: false, bound: [] };
  for (let i = 0; i < files.length; i++) {
    if (shouldStop?.()) { r.stopped = true; break; }
    const f = files[i];
    onProgress?.({ i, total: files.length, name: f.name });
    try {
      const doc = await parseFile(f);
      const cs = doc.contentChecksum;
      if (map[cs]) { r.skipped++; r.bound.push(f.name); continue; }
      const book = bookFromOpenedDoc({ fileName: f.name, words: doc.words.length, status });
      const existing = await getLibraryBook(book.id); // same title → bind to it, never overwrite it
      if (existing && !existing.deleted) r.linked++; else { await saveLibraryBook(book); r.tracked++; }
      map = await setBinding(cs, book.id);
      // ponytail: no updatedAt — a full record synced from a device that read it must win the merge
      if (!(await loadFile(cs))) await saveFile({ contentChecksum: cs, fileName: f.name, totalWords: doc.words.length });
      r.bound.push(f.name);
    } catch { r.failed++; }
    await new Promise((res) => setTimeout(res)); // a tick between files: the UI paints, the parsed text goes
  }
  return r;
}
