import { useRef, useState } from "react";

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

export default function ClearActivityButton({ scope, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false);
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
      setConfirming(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      request.current = false;
      setClearing(false);
    }
  }

  return (
    <>
      <button
        className="btn"
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={clearing}
      >
        Clear All
      </button>
      {confirming && (
        <div className="confirm-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-activity-title"
            aria-describedby="clear-activity-message"
          >
            <h2 id="clear-activity-title">Clear {scope} activity?</h2>
            <p id="clear-activity-message">{confirmation(scope)}</p>
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="confirm-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void clear()} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear All"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
