import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { parsePaletteQuery } from "../lib/paletteQuery";
import type { SearchInventory } from "../lib/desktopSearch";
import type { SavedContentResults } from "../lib/types";

/** Use the same body-search request and stale-response fence on every surface. */
export function useSavedContent(
  enabled: boolean,
  raw: string,
  inventory: Pick<SearchInventory, "courses" | "resources" | "displayNames">,
  localRevision: unknown,
) {
  const { courses, resources, displayNames } = inventory;
  const [revision, setRevision] = useState(0);
  const [job, setJob] = useState<SavedContentResults["state"] | null>(null);
  const request = useMemo(() => {
    if (!enabled) return null;
    const parsed = parsePaletteQuery(raw, { courses, resources, displayNames });
    return { terms: parsed.errors.length ? [] : parsed.terms };
  }, [enabled, raw, courses, resources, displayNames, localRevision, revision]);
  const [response, setResponse] = useState<{ request: typeof request; result: SavedContentResults }>();
  useEffect(() => {
    if (!request) return;
    let current = true;
    let timeout: ReturnType<typeof setTimeout>;
    const complete = (result: SavedContentResults) => {
      if (!current) return;
      setResponse({ request, result });
      if (result.state === "building") timeout = setTimeout(load, 250);
    };
    const unavailable = (): SavedContentResults => ({ state: "unavailable", indexed: 0, skipped: 0, hits: [] });
    const load = () => {
      void api.searchSavedContent(request.terms).then(
        result => complete(result ?? unavailable()),
        () => complete(unavailable()),
      );
    };
    timeout = setTimeout(load, request.terms.length ? 100 : 0);
    return () => { current = false; clearTimeout(timeout); };
  }, [request]);

  const result = request && response?.request === request ? response.result : undefined;
  const hits = useMemo(() => result?.hits.length
    ? new Map(result.hits.map(hit => [hit.resourceId, hit.snippet]))
    : undefined, [result]);

  const rebuild = async () => {
    setJob("building");
    try {
      const report = await api.rebuildSavedContent();
      setJob(report?.state === "cancelled" || report?.state === "unavailable" ? report.state : null);
    } catch {
      setJob("unavailable");
    } finally {
      setRevision(value => value + 1);
    }
  };

  const cancel = async () => {
    try {
      await api.cancelSavedContentRebuild();
    } catch {
      setJob("unavailable");
    }
  };

  return { result, hits, job, pending: Boolean(request?.terms.length && !result), rebuild, cancel };
}
