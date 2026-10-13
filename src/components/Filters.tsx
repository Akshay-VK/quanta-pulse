import type { Course } from "../lib/types";
import { FEED_KINDS, type FeedKind } from "../lib/filter";

interface Props {
  kind: FeedKind;
  onKind: (k: FeedKind) => void;
  courses: Course[];
  courseId: number | null;
  onCourse: (id: number | null) => void;
  search: string;
  onSearch: (s: string) => void;
}

export default function Filters({
  kind,
  onKind,
  courses,
  courseId,
  onCourse,
  search,
  onSearch,
}: Props) {
  return (
    <div className="filters">
      <div className="chips">
        {FEED_KINDS.map((k) => (
          <button
            key={k.id}
            className={`chip${kind === k.id ? " active" : ""}`}
            onClick={() => onKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <select
        value={courseId ?? ""}
        onChange={(e) => onCourse(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">All courses</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.shortName || c.name}
          </option>
        ))}
      </select>
      <input
        type="search"
        placeholder="Search titles…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
  );
}
