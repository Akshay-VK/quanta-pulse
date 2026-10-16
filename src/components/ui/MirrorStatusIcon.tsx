import { AlertCircle, Check, Clock, HardDrive, LoaderCircle } from "lucide-react";
import { cx } from "../../lib/cx";
import { MIRROR_STATUS, mirrorTip } from "../../lib/mirrorState";
import type { LocalFileStatus } from "../../lib/types";

const ICON = {
  ok: Check,
  downloading: LoaderCircle,
  queued: Clock,
  failed: AlertCircle,
  skipped: AlertCircle,
  kept: HardDrive,
} as const;

/**
 * The 16px mirror marker before a row's time: saved, downloading, queued,
 * failed (with the reason), or kept. Every state is announced.
 */
export function MirrorStatusIcon({ file }: { file: LocalFileStatus }) {
  const meta = MIRROR_STATUS[file.status as keyof typeof MIRROR_STATUS];
  if (!meta) return null;
  const Icon = ICON[file.status as keyof typeof ICON];
  const tip = mirrorTip(file);
  return (
    <span
      className={cx("mirror-icon", `mirror-${meta.tone}`)}
      role="img"
      aria-label={tip ?? meta.label}
      title={tip ?? meta.label}
    >
      <Icon
        aria-hidden="true"
        className={file.status === "downloading" ? "mirror-spin" : undefined}
      />
    </span>
  );
}
