import { createContext, useContext } from "react";
import { materialActions, materialSource } from "../lib/materialActions";
import { canPreview } from "../lib/preview";
import type { ChangeEvent, Resource } from "../lib/types";
import type { MenuItemSpec } from "../components/ui/Menu";

/** App owns execution and mirror state; every material surface consumes this seam. */
export type MaterialDestinations = (resource: Resource | null, recorded?: ChangeEvent) => MenuItemSpec[];
export const MaterialActionsContext = createContext<MaterialDestinations | null>(null);
export function useMaterialActions(fallback?: { onOpen: (url: string) => void; onPreview: (resource: Resource) => void }) {
  const owner = useContext(MaterialActionsContext);
  if (owner || !fallback) return owner;
  // Standalone view consumers retain preview/browser props; local actions need App's owner.
  return (resource: Resource | null) => materialActions(resource, {
    preview: resource ? canPreview(resource.resourceType, resource.url) : false, local: "unsupported",
  }).map((action) => ({ ...action, onSelect: () => {
    if (!resource) return;
    if (action.id === "preview") fallback.onPreview(resource);
    else { const source = materialSource(resource); if (source) fallback.onOpen(source); }
  } }));
}
