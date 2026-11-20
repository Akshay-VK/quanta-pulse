/** Pure keyboard and stable-identity focus policy for material lists. */

/** The normalized state and guards supplied by a list's current surface. */
export interface ListNavigationInput {
  /** Stable IDs of rows currently in the list, in display order. */
  ids: readonly string[];
  focusedId: string | null;
  inspectedId: string | null;
  selectedIds: readonly string[];
  key: string;
  activeSurface: boolean;
  editableTarget: boolean;
  /** True for a nested native control whose own keyboard behavior must win. */
  nestedControl: boolean;
  modalOpen: boolean;
  isComposing: boolean;
  /** Mirrors the existing useHotkey guard for legacy IME keyCode 229. */
  imeKeyCode229: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Authoritative complete scope supplied by the owner, never derived here. */
  completeEventIds: readonly number[];
}

/** Intents only; the surface owner performs state changes and confirmation. */
export type ListNavigationIntent =
  | { type: "focus"; id: string }
  | { type: "inspect"; id: string }
  | { type: "toggleSelection"; id: string }
  | { type: "setReadState"; ids: readonly string[]; isRead: boolean }
  | { type: "confirmDelete"; ids: readonly string[] }
  | { type: "preview"; id: string }
  | { type: "openCapturedScope"; eventIds: readonly number[] };

/**
 * Resolve a vanished focused ID against a changed ordered list. Prefer the
 * next surviving old neighbor, then the previous one, then the new first row.
 */
export function recoverFocusedId(
  previousIds: readonly string[],
  nextIds: readonly string[],
  focusedId: string | null,
): string | null {
  if (nextIds.length === 0) return null;
  if (focusedId !== null && nextIds.includes(focusedId)) return focusedId;

  const oldIndex = focusedId === null ? -1 : previousIds.indexOf(focusedId);
  if (oldIndex >= 0) {
    for (let index = oldIndex + 1; index < previousIds.length; index += 1) {
      if (nextIds.includes(previousIds[index])) return previousIds[index];
    }
    for (let index = oldIndex - 1; index >= 0; index -= 1) {
      if (nextIds.includes(previousIds[index])) return previousIds[index];
    }
  }
  return nextIds[0];
}

/**
 * Map one key event to a list intent. All surface, editing, modal, IME,
 * repeat, and modifier filtering is explicit; this function reads no DOM or
 * global state. Focus movement never inspects a row or changes read state.
 */
export function getListNavigationIntent(input: ListNavigationInput): ListNavigationIntent | null {
  const {
    ids,
    focusedId,
    selectedIds,
    key,
    activeSurface,
    editableTarget,
    nestedControl,
    modalOpen,
    isComposing,
    imeKeyCode229,
    repeat,
    defaultPrevented,
    shiftKey,
    ctrlKey,
    altKey,
    metaKey,
  } = input;

  if (
    !activeSurface || editableTarget || nestedControl || modalOpen || isComposing || imeKeyCode229 || repeat || defaultPrevented
  ) return null;

  const normalizedKey = key.toLowerCase();
  const shiftA = normalizedKey === "a" && shiftKey && !ctrlKey && !altKey && !metaKey;
  if (shiftA) {
    return {
      type: "openCapturedScope",
      eventIds: Object.freeze([...input.completeEventIds]),
    };
  }
  if (shiftKey || ctrlKey || altKey || metaKey) return null;

  const focusedIndex = focusedId === null ? -1 : ids.indexOf(focusedId);
  if (normalizedKey === "j" || normalizedKey === "arrowdown") {
    if (ids.length === 0) return null;
    return { type: "focus", id: ids[Math.min(focusedIndex < 0 ? 0 : focusedIndex + 1, ids.length - 1)] };
  }
  if (normalizedKey === "k" || normalizedKey === "arrowup") {
    if (ids.length === 0) return null;
    return { type: "focus", id: ids[Math.max(focusedIndex < 0 ? ids.length - 1 : focusedIndex - 1, 0)] };
  }

  if (focusedId === null || !ids.includes(focusedId)) return null;
  if (key === "Enter") return { type: "inspect", id: focusedId };
  if (normalizedKey === "x") return { type: "toggleSelection", id: focusedId };
  if (key === " ") return { type: "preview", id: focusedId };

  const targets = selectedIds.filter((id) => ids.includes(id));
  const actionIds = targets.length > 0 ? targets : [focusedId];
  if (normalizedKey === "e") return { type: "setReadState", ids: [...actionIds], isRead: true };
  if (normalizedKey === "u") return { type: "setReadState", ids: [...actionIds], isRead: false };
  if (key === "Delete") return { type: "confirmDelete", ids: [...actionIds] };
  return null;
}
