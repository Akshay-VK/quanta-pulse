interface Crumb {
  label: string;
  onClick?: () => void;
}

/** The top-bar breadcrumb. The last segment is plain text, never a button. */
export default function Breadcrumb({
  items = [],
  current,
}: {
  items?: Crumb[];
  current: string;
}) {
  return (
    <nav className="crumb" aria-label="Breadcrumb">
      {items.map((item) => (
        <span key={item.label} style={{ display: "contents" }}>
          <button type="button" className="crumb-item" onClick={item.onClick}>
            {item.label}
          </button>
          <span className="crumb-react" aria-hidden="true">
            /
          </span>
        </span>
      ))}
      <span className="crumb-current" aria-current="page">
        {current}
      </span>
    </nav>
  );
}