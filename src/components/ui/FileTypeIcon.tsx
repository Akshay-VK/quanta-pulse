import {
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  Link as LinkIcon,
  Presentation,
} from "lucide-react";
import { fileTone, type FileTone } from "../../lib/filetype";
import { cx } from "../../lib/cx";

const TONE_ICON: Record<FileTone, typeof File> = {
  "file-pdf": FileText,
  "file-text": FileText,
  "file-sheet": FileSpreadsheet,
  "file-slides": Presentation,
  "file-link": LinkIcon,
  "file-other": File,
};

/** Icon for a resource type, coloured by tone. Meaning never relies on colour. */
export function FileTypeIcon({ type }: { type: string | null | undefined }) {
  const isFolder = (type ?? "").toLowerCase() === "folder";
  const Icon = isFolder ? Folder : TONE_ICON[fileTone(type)];
  return (
    <Icon
      className={cx("file-type-icon", !isFolder && fileTone(type))}
      aria-hidden="true"
    />
  );
}