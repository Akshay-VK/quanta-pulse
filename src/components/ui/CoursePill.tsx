import { cx } from "../../lib/cx";
import { courseDot } from "../../lib/courseName";
import { courseLabel } from "../../lib/courseName";
import { Tooltip } from "./Tooltip";

/** Colour class for a course dot, from its assigned palette index. */
export function courseDotClass(courseId: number | null | undefined): string {
  const n = courseDot(courseId);
  return `course-dot-${(n + 12) % 12}`;
}

/**
 * A compact course chip: a colour dot plus the course's display name. With
 * `onOpen` it becomes the row's "go to this course" control; the caller is
 * responsible for not nesting it inside another interactive element.
 */
export function CoursePill({
  courseId,
  code,
  name,
  onOpen,
}: {
  courseId: number | null | undefined;
  /** Display name fallback when the course is not in the registry. */
  code: string;
  name?: string | null;
  onOpen?: () => void;
}) {
  const label = courseLabel(courseId);
  const text = label?.name ?? code;
  const tip = label ? (label.raw === text ? text : `${text} — ${label.raw}`) : name;
  const dot = <span className={cx("course-dot", courseDotClass(courseId))} aria-hidden="true" />;
  return (
    <Tooltip content={tip || text}>
      {onOpen ? (
        <button
          type="button"
          className="course-pill"
          aria-label={`Open ${text}`}
          onClick={onOpen}
        >
          {dot}
          <span className="cp-code">{text}</span>
        </button>
      ) : (
        <span className="course-pill">
          {dot}
          <span className="cp-code">{text}</span>
        </span>
      )}
    </Tooltip>
  );
}
