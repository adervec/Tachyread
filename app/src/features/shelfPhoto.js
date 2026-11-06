// Shelf photo → books: Claude (your own API key) reads the spines in a photo of a bookshelf, and the
// titles go through the same review as a Goodreads import (features/shelfImport.js) — nothing is
// added until you tick it. Only the photo (downscaled) is sent, only when you pick one.
import { deriveId } from './journeyLibrary.js';

export const SHELF_PROMPT = 'This is a photo of a bookshelf (or a stack of books). List every book whose title you can read on a spine or cover. Reply with ONLY a JSON array, no prose: [{"title": "...", "author": "..."}]. Use "" for an author you cannot read. Skip anything you are not reasonably sure of; do not guess titles from partial letters.';

// Claude's reply → [{ title, author }]: the first JSON array in the text, cleaned and de-duplicated.
export function parseShelfReply(text) {
  const m = /\[[\s\S]*\]/.exec(String(text || ''));
  if (!m) return [];
  let arr;
  try { arr = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const title = String(x?.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const author = String(x?.author || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const k = `${title.toLowerCase()}|${author.toLowerCase()}`;
    if (!title || seen.has(k)) continue;
    seen.add(k);
    out.push({ title, author });
  }
  return out;
}

export const shelfBooks = (list) => list.map((x) => { const b = { title: x.title, author: x.author, source: 'shelf-photo' }; return { ...b, id: deriveId(b) }; });

// A photo file → base64 JPEG no wider/taller than `max` px (fewer tokens; spines stay legible).
export async function photoToBase64(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1);
}
