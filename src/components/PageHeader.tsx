import type { ReactNode } from "react";

/**
 * The page heading block: caption, title, optional summary and actions.
 * `subtitle`/`children` are accepted for the pre-redesign call sites.
 */
export default function PageHeader({
  title,
  caption,
  summary,
  actions,
  subtitle,
  children,
}: {
  title: ReactNode;
  caption?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  subtitle?: string;
  children?: ReactNode;
}) {
  const summaryText = summary ?? subtitle;
  const actionNode = actions ?? children;
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div style={{ minWidth: 0 }}>
          {caption && <p className="page-caption">{caption}</p>}
          <h1 className="page-title">{title}</h1>
        </div>
        {actionNode && <div className="page-header-actions">{actionNode}</div>}
      </div>
      {summaryText && <p className="page-summary">{summaryText}</p>}
    </header>
  );
}