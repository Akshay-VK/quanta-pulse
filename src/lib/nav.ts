// Navigation model. The redesign merges six views into five; legacy `ui:navigate`
// payloads are mapped so old names keep working.

export type ViewId = "today" | "calendar" | "library" | "history" | "settings";

export const NAV: { id: ViewId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "calendar", label: "Calendar" },
  { id: "library", label: "Library" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

const LEGACY: Record<string, ViewId> = {
  dashboard: "today",
  resources: "library",
  courses: "library",
};

/** Map a stored or backend-supplied view name to the current five-view model. */
export function resolveView(name: string | null | undefined): ViewId {
  if (!name) return "today";
  if (LEGACY[name]) return LEGACY[name];
  return (NAV.some((item) => item.id === name) ? name : "today") as ViewId;
}