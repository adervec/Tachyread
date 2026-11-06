// The PWA's Web Share Target: share text or a link to Tachyread from any app on a phone. Text opens
// as a document; a link goes to File → Grab from Web URL (features/webGrab.js), which already knows
// how to fetch a page or fall back to a reader service / paste when the site blocks it.

// Share Target GET params → what to open. Android often puts the link inside `text`, so a text
// that is just a URL counts as a link; a long text is read as-is.
export function sharedPayload(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('share-target')) return null;
  const title = (p.get('title') || '').trim();
  const text = (p.get('text') || '').trim();
  let url = (p.get('url') || '').trim();
  const onlyUrl = /^https?:\/\/\S+$/i.exec(text);
  if (!url && onlyUrl) url = onlyUrl[0];
  const body = onlyUrl ? '' : text;
  if (body.split(/\s+/).length >= 40 || (!url && body)) return { kind: 'text', title: title || 'Shared text', text: body };
  if (url) return { kind: 'url', title, url, text: body };
  return null;
}

// A safe file name for the opened article.
export const shareFileName = (title, url) => `${(title || (url ? new URL(url).hostname : '') || 'Web article').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80).trim()}.txt`;
