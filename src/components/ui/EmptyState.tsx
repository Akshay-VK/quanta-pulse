import { Button } from "./Button";

/** The shared empty state: a title, optional supporting copy and one action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}