import type { useSavedContent } from "../hooks/useSavedContent";

type Content = ReturnType<typeof useSavedContent>;

const STATUS = {
  empty: "Build the index to search saved text.",
  building: "Indexing saved text…",
  cancelled: "Rebuild cancelled.",
  ready: "",
  limited: "Saved text coverage is limited.",
  stale: "Some saved copies changed. Rebuild the index to refresh coverage.",
  tooLarge: "Saved text search is available for inventories up to 5,000 files.",
  queryTooLong: "This query exceeds the saved text search limit.",
  unavailable: "Saved text search is temporarily unavailable.",
  unsupported: "Saved text search is unavailable on this platform.",
};

export function SavedContentControls({ enabled, onToggle, content }: {
  enabled: boolean;
  onToggle: () => void;
  content: Content;
}) {
  const state = content.job ?? content.result?.state;
  const canRebuild = state && !["building", "tooLarge", "unsupported"].includes(state);
  return <div className="saved-content-controls">
    <button className="filter-chip" type="button" aria-pressed={enabled} onClick={onToggle}>Include saved text</button>
    {enabled && <>
      {state === "building" && <button className="filter-chip" type="button" onClick={() => void content.cancel()}>Cancel rebuild</button>}
      {canRebuild && <button className="filter-chip" type="button" onClick={() => void content.rebuild()}>
        {state === "empty" ? "Build text index" : "Rebuild text index"}
      </button>}
      <span className="faint" role="status">
        {state ? STATUS[state] : "Searching saved text…"}
        {content.result && ["ready", "limited", "stale"].includes(content.result.state)
          ? ` ${content.result.indexed} indexed, ${content.result.skipped} skipped at last build.` : ""}
        {" PDF contents are unavailable."}
      </span>
    </>}
  </div>;
}

/** React renders the SQLite snippet as escaped text. */
export function BodyMatch({ snippet, id }: { snippet: string | undefined; id?: string }) {
  if (snippet === undefined) return null;
  return <span className="body-match" id={id} title={snippet}><strong>Body match</strong><span>{snippet}</span></span>;
}
