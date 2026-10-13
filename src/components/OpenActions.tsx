import type { OpenTarget } from "../lib/open";

interface Props {
  links: OpenTarget;
  onOpen: (url: string) => void;
}

/**
 * The canonical open actions for one resource/event row:
 *
 * - "Open" — opens the original page listing the resource (course/section/
 *   folder page). Rendered only when a listing page is known.
 * - "Open File" — always opens the direct file URL. When no listing page is
 *   known this is the only action, so opening a raw file is always explicit.
 */
export default function OpenActions({ links, onOpen }: Props) {
  const { sourcePageUrl, fileUrl } = links;
  if (!sourcePageUrl && !fileUrl) {
    return <span className="faint">—</span>;
  }
  return (
    <span className="open-actions">
      {sourcePageUrl && (
        <button
          type="button"
          className="btn-link"
          title="Open the page listing this resource"
          onClick={() => onOpen(sourcePageUrl)}
        >
          Open
        </button>
      )}
      {fileUrl && (
        <button
          type="button"
          className="btn-link"
          title={
            sourcePageUrl
              ? "Open the underlying file directly"
              : "Open the file directly (no listing page is known)"
          }
          aria-label="Open File"
          onClick={() => onOpen(fileUrl)}
        >
          Open File
        </button>
      )}
    </span>
  );
}