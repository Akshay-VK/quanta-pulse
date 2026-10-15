import { useRef, type KeyboardEvent, type RefObject } from "react";
import { cx } from "../../lib/cx";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

function rovingKey(
  event: KeyboardEvent,
  index: number,
  count: number,
  select: (index: number) => void,
  refs: RefObject<(HTMLButtonElement | null)[]>,
) {
  let next = index;
  switch (event.key) {
    case "ArrowRight":
      next = (index + 1) % count;
      break;
    case "ArrowLeft":
      next = (index - 1 + count) % count;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  select(next);
  refs.current?.[next]?.focus();
}

/** Filter chips: a labelled group of toggle buttons with roving focus. */
export function FilterTabs({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className={cx("filter-tabs", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            className={cx("filter-tab", selected && "is-selected")}
            aria-pressed={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) =>
              rovingKey(event, index, items.length, (i) => onChange(items[i].id), refs)
            }
          >
            {item.label}
            {item.count !== undefined && (
              <span className="filter-tab-count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** View tabs: same look as FilterTabs but with tablist semantics. */
export function ViewTabs({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className={cx("filter-tabs", className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            className={cx("filter-tab", selected && "is-selected")}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) =>
              rovingKey(event, index, items.length, (i) => onChange(items[i].id), refs)
            }
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}