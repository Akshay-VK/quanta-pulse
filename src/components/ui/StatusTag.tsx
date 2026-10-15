import { cx } from "../../lib/cx";

export type StatusKind =
  | "new"
  | "updated"
  | "deadline"
  | "note"
  | "unavailable"
  | "restored";

const DEFAULT_LABEL: Record<StatusKind, string> = {
  new: "New",
  updated: "Updated",
  deadline: "Deadline",
  note: "Announcement",
  unavailable: "Unavailable",
  restored: "Restored",
};

/** A small status chip. Labels longer than 16 characters are truncated. */
export function StatusTag({
  kind,
  label,
}: {
  kind: StatusKind;
  label?: string;
}) {
  const text = (label ?? DEFAULT_LABEL[kind]).slice(0, 16);
  return (
    <span className={cx("tag", `tag-${kind}`)} data-status={kind}>
      {text}
    </span>
  );
}