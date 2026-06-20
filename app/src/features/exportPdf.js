// Export the active tab to a PDF. For grabbed/OCR'd books this preserves the SOURCE — each captured
// page image becomes a PDF page, with the recognised text added as an invisible (selectable /
// searchable) layer on top — so the PDF carries both the original page and the text, unlike a bare
// TXT export. Opened PDFs hand back their original bytes; plain-text docs are paginated as text.
import { jsPDF } from 'jspdf';

function imgMeta(dataUrl) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth || 1000, h: im.naturalHeight || 1400 });
    im.onerror = () => resolve({ w: 1000, h: 1400 });
    im.src = dataUrl;
  });
}

function imgFormat(dataUrl) {
  return /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';
}

// Reconstruct the per-segment (per-image) text from the word→segment map, for the invisible layer.
function segmentTexts(doc) {
  const n = doc.segmentCount || 1;
  const out = Array.from({ length: n }, () => []);
  const map = doc.wordToSegment;
  if (map && doc.words) {
    for (let i = 0; i < doc.words.length; i++) {
      const s = map[i] || 0;
      (out[s] || out[0]).push(doc.words[i]);
    }
  }
  return out.map((arr) => arr.join(' '));
}

export function tabCanExportSource(doc) {
  return doc?.source?.kind === 'images' && (doc.source.images?.length || 0) > 0;
}

export async function buildTabPdf(doc) {
  const src = doc.source;

  // Opened PDF — the source already IS a PDF; return its bytes unchanged.
  if (src?.kind === 'pdf' && src.pdfData) {
    return new Blob([src.pdfData.slice(0)], { type: 'application/pdf' });
  }

  // Grabbed/OCR'd images — one page per captured image + an invisible text layer.
  if (tabCanExportSource(doc)) {
    const images = src.images;
    const texts = segmentTexts(doc);
    const first = await imgMeta(images[0]);
    const pdf = new jsPDF({
      unit: 'px',
      hotfixes: ['px_scaling'],
      format: [first.w, first.h],
      orientation: first.w > first.h ? 'landscape' : 'portrait',
    });
    for (let i = 0; i < images.length; i++) {
      const meta = i === 0 ? first : await imgMeta(images[i]);
      if (i > 0) pdf.addPage([meta.w, meta.h], meta.w > meta.h ? 'landscape' : 'portrait');
      try { pdf.addImage(images[i], imgFormat(images[i]), 0, 0, meta.w, meta.h); } catch { /* skip unreadable image */ }
      const t = (texts[i] || '').trim();
      if (t) {
        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(t, Math.max(40, meta.w - 16));
        // Invisible render mode → text is selectable/searchable but the page image is what's shown.
        pdf.text(lines, 8, 14, { renderingMode: 'invisible', baseline: 'top' });
      }
    }
    return pdf.output('blob');
  }

  // Plain text document — paginate the reading text onto A4.
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const lineH = 16;
  pdf.setFontSize(12);
  const lines = pdf.splitTextToSize(doc.fullText || '', pageW - margin * 2);
  let y = margin;
  for (const ln of lines) {
    if (y + lineH > pageH - margin) { pdf.addPage(); y = margin; }
    pdf.text(ln, margin, y);
    y += lineH;
  }
  return pdf.output('blob');
}
