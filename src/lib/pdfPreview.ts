import type { PDFDocumentProxy } from "pdfjs-dist";

export function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PdfMatch {
  page: number;
  boxes: Array<{ x: number; y: number; width: number; height: number }>;
}

/** Search PDF.js text runs together so a match can span formatting changes or lines. */
export async function findPdfMatches(document: PDFDocumentProxy, query: string, cancelled: () => boolean): Promise<PdfMatch[]> {
  const needle = query.toLowerCase();
  const matches: PdfMatch[] = [];
  if (!needle) return matches;

  for (let number = 1; number <= document.numPages && !cancelled(); number += 1) {
    const page = await document.getPage(number);
    const { items } = await page.getTextContent();
    if (cancelled()) break;

    let text = "";
    const runs = items.flatMap((item) => {
      if (!("str" in item)) return [];
      const start = text.length;
      const value = item.str.toLowerCase();
      text += value;
      const end = text.length;
      if (item.hasEOL) text += " ";
      return end > start ? [{ start, end, item }] : [];
    });
    let firstRun = 0;
    for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) {
      const end = start + needle.length;
      while (firstRun < runs.length && runs[firstRun].end <= start) firstRun += 1;
      const boxes: PdfMatch["boxes"] = [];
      for (let index = firstRun; index < runs.length && runs[index].start < end; index += 1) {
        const run = runs[index];
        const overlapStart = Math.max(start, run.start);
        const overlapEnd = Math.min(end, run.end);
        const charWidth = run.item.width / (run.end - run.start);
        // Unequal glyph widths make the highlight approximate within a text run.
        const inset = (overlapStart - run.start) * charWidth;
        const width = (overlapEnd - overlapStart) * charWidth;
        const x = run.item.dir === "rtl" ? run.item.width - inset - width : inset;
        boxes.push({ x: run.item.transform[4] + x, y: run.item.transform[5], width, height: run.item.height });
      }
      matches.push({ page: number, boxes });
    }
  }

  return matches;
}
