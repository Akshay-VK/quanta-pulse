/** A label plus a mono value; zero renders muted. No colour fills. */
export default function StatBlock({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  const zero = value === 0 || value === "0";
  return (
    <div className="stat-block">
      <span className="stat-label">{label}</span>
      <span className={zero ? "stat-value zero" : "stat-value"}>{value}</span>
    </div>
  );
}
