import { cx } from "../../lib/cx";

/** A dot marking unread state, with visually hidden text for screen readers. */
export function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span
      className={cx("unread-dot", !unread && "read")}
      title={unread ? "Unread" : "Read"}
    >
      <span className="sr-only">{unread ? "Unread" : "Read"}</span>
    </span>
  );
}