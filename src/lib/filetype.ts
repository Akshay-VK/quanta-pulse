// Maps a Quanta resource type to a muted, consistent colour class.
//
// Colour is always paired with the type name in markup, so the meaning never
// depends on colour alone. Kinds deliberately follow the terminal palette:
// documents red, notes/text cyan, spreadsheets green, slides amber, links violet.

export type FileTone =
  | "file-pdf"
  | "file-sheet"
  | "file-slides"
  | "file-link"
  | "file-text"
  | "file-other";

export function fileTone(type: string | null | undefined): FileTone {
  const value = (type ?? "").toLowerCase();
  if (/pdf|document|word|doc/.test(value)) return "file-pdf";
  if (/spreadsheet|sheet|excel|csv|dataset/.test(value)) return "file-sheet";
  if (/presentation|slide|powerpoint|ppt/.test(value)) return "file-slides";
  if (/link|url|web|external/.test(value)) return "file-link";
  if (/note|text|markdown|page|wiki|read/.test(value)) return "file-text";
  return "file-other";
}
