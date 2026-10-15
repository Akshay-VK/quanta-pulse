import { RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

/**
 * The sidebar sync action. Full-width secondary in the wide sidebar, an
 * icon-only button in the collapsed rail.
 */
export default function SyncButton({
  running,
  onSync,
  collapsed = false,
}: {
  running: boolean;
  onSync: () => void;
  /** Rail mode: icon only. */
  collapsed?: boolean;
}) {
  const label = running ? "Scanning" : "Sync now";
  if (collapsed) {
    return (
      <IconButton label={label} size={32} onClick={onSync} disabled={running}>
        <RefreshCw className={running ? "icon-spin" : undefined} aria-hidden="true" />
      </IconButton>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      className="sync-btn"
      loading={running}
      leadingIcon={<RefreshCw aria-hidden="true" />}
      onClick={onSync}
      disabled={running}
    >
      <span className="sync-btn-label">{label}</span>
    </Button>
  );
}