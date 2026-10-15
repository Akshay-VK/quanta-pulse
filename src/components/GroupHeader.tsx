/** A sticky day (or section) divider with a mono item count. */
export default function GroupHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="group-header">
      <span>{label}</span>
      {count !== undefined && <span className="group-count">{count}</span>}
      <span className="group-hairline" aria-hidden="true" />
    </div>
  );
}