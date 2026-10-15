import { useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { Button } from "./ui/Button";

type Scope = "Dashboard" | "History";

interface Props {
  scope: Scope;
  onConfirm: () => Promise<void>;
}

function confirmation(scope: Scope): string {
  return scope === "Dashboard"
    ? "Clear all Dashboard activity? This clears its activity entries and counts. Course resources and History will remain unchanged."
    : "Clear all visible History records? This hides change and scan entries but does not delete Quanta files or resources. Dashboard and Calendar will remain unchanged.";
}

function getLabel(scope: Scope): string {
  return scope === "Dashboard" ? "Clear activity" : "Clear history";
}

export default function ClearActivityButton({ scope, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(false);

  async function clear() {
    if (request.current) return;
    request.current = true;
    setClearing(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (reason) {
      setError(String(reason));
      // Re-throw so ConfirmDialog keeps the dialog open and disables dismissal.
      throw reason;
    } finally {
      request.current = false;
      setClearing(false);
    }
  }

  const label = getLabel(scope);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={clearing}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (clearing) return;
          setOpen(next);
        }}
        title={label}
        body={
          <div>
            <p>{confirmation(scope)}</p>
            {error && (
              <div
                role="alert"
                style={{ color: "var(--t-red-fg)", fontSize: 13, lineHeight: "18px" }}
              >
                {error}
              </div>
            )}
          </div>
        }
        confirmLabel={label}
        cancelLabel="Cancel"
        destructive
        onConfirm={clear}
      />
    </>
  );
}
