import { useSessionScroll } from "../hooks/useSessionViews";
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cx } from "../lib/cx";

export interface DataColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligns the header and cell in mono. */
  numeric?: boolean;
  /** Renders the header as a sort button with a chevron. */
  sortable?: boolean;
  width?: number;
  /** Extra class on the body cell (e.g. `title-cell`, `section-cell`). */
  className?: string;
  /** Full text for the cell's `title` when the cell truncates. */
  title?: (row: T) => string | undefined;
}

export interface DataTableNavigationHandle {
  /** Focus a matching row, scrolling it into the virtual window when needed. */
  focusKey: (key: string | number) => boolean;
  /** Only mounted rows have a DOM element. */
  getRowElement: (key: string | number) => HTMLTableRowElement | null;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getKey: (row: T) => string | number;
  sort?: { id: string; dir: "asc" | "desc" } | null;
  onSort?: (id: string) => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  focusedKey?: string | number | null;
  multiSelectedKeys?: readonly (string | number)[];
  onRowFocus?: (row: T) => void;
  navigationRef?: Ref<DataTableNavigationHandle>;
  empty?: ReactNode;
  ariaLabel?: string;
  groupHeader?: ReactNode;
  rowHeight?: number;
  /** Windowed rendering above 200 rows. */
  virtual?: boolean;
  /** Viewport height of the scroll box when virtual. */
  height?: number;
  sessionKey?: string;
}

const ROW_H = 34;
const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 8;
const hasModal = () => Boolean(document.querySelector(
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
));

/** A sortable data table. Numeric columns right-align; above 200 rows the body
 * is windowed against an internal scroll box. */
export default function DataTable<T>({
  columns,
  rows,
  getKey,
  sort,
  onSort,
  onRowClick,
  selectedKey,
  focusedKey,
  multiSelectedKeys,
  onRowFocus,
  navigationRef,
  empty,
  ariaLabel,
  groupHeader,
  rowHeight = ROW_H,
  virtual = false,
  height = 560,
  sessionKey,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowElements = useRef(new Map<string | number, HTMLTableRowElement>());
  const pendingFocus = useRef<string | number | null>(null);
  const mounted = useRef(false);
  const navigationEnabled = navigationRef != null || focusedKey !== undefined ||
    multiSelectedKeys !== undefined || onRowFocus !== undefined;
  const active = virtual && rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: active ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    getItemKey: useCallback((index: number) => getKey(rows[index]), [rows, getKey]),
  });

  useLayoutEffect(() => {
    mounted.current = true;
    if (!navigationEnabled) return () => { mounted.current = false; };
    const observer = new MutationObserver(() => {
      if (hasModal()) pendingFocus.current = null;
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role"] });
    return () => {
      mounted.current = false;
      pendingFocus.current = null;
      observer.disconnect();
    };
  }, [navigationEnabled]);

  useImperativeHandle(navigationRef, () => ({
    getRowElement: (key) => rowElements.current.get(key) ?? null,
    focusKey: (key) => {
      // Every request supersedes its predecessor, even an absent-key request.
      pendingFocus.current = null;
      if (!mounted.current) return false;
      const index = rows.findIndex((row) => getKey(row) === key);
      if (index < 0) return false;
      if (hasModal()) return true;
      const element = rowElements.current.get(key);
      if (!element && active) pendingFocus.current = key;
      // Redirect an earlier scroll even when the new target is still mounted.
      if (active) virtualizer.scrollToIndex(index, { align: "auto" });
      if (element) element.focus();
      return true;
    },
  }), [rows, getKey, active, virtualizer]);

  // A virtualizer render mounts the requested row. Never focus on refresh alone.
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    if (hasModal() || !rows.some((row) => getKey(row) === key)) {
      pendingFocus.current = null;
      return;
    }
    const element = rowElements.current.get(key);
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  });

  const tabStopKey = focusedKey != null && rows.some((row) => getKey(row) === focusedKey)
    ? focusedKey : rows.length > 0 ? getKey(rows[0]) : null;
  const items = active ? virtualizer.getVirtualItems() : [];
  // Wait for measured virtual rows to give the scroll box its full height.
  useSessionScroll(sessionKey ?? "table", scrollRef, Boolean(sessionKey) && rows.length > 0 && (!active || items.length > 0));
  const padTop = items.length > 0 ? items[0].start : 0;
  const padBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const visible: { row: T; index: number }[] = active
    ? items.map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }));

  return (
    <div
      className="table-scroll"
      ref={scrollRef}
      style={active ? { maxHeight: height, overflowY: "auto" } : undefined}
    >
      <table className={cx("data-table", navigationEnabled && "keyboard-list")} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sorted = sort?.id === column.id;
              return (
                <th
                  key={column.id}
                  className={cx(column.sortable && "sortable", column.className)}
                  style={{
                    width: column.width,
                    minWidth: column.width,
                    textAlign: column.numeric ? "right" : undefined,
                  }}
                  aria-sort={
                    sorted
                      ? sort?.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : column.sortable
                        ? "none"
                        : undefined
                  }
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => onSort?.(column.id)}
                    >
                      {column.header}
                      {sorted &&
                        (sort?.dir === "asc" ? (
                          <ChevronUp className="th-chevron icon-sm" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="th-chevron icon-sm" aria-hidden="true" />
                        ))}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
          {groupHeader && rows.length > 0 && <tr className="data-table-group"><td colSpan={columns.length}>{groupHeader}</td></tr>}
        </thead>
        <tbody>
          {active && padTop > 0 && <SpacerRow span={columns.length} height={padTop} />}
          {visible.map(({ row }) => (
            <tr
              key={getKey(row)}
              ref={navigationEnabled ? (element) => {
                const key = getKey(row);
                if (element) rowElements.current.set(key, element);
                else rowElements.current.delete(key);
              } : undefined}
              data-row-key={navigationEnabled ? getKey(row) : undefined}
              tabIndex={navigationEnabled ? (tabStopKey === getKey(row) ? 0 : -1) : undefined}
              className={cx(
                selectedKey === getKey(row) && "selected",
                navigationEnabled && focusedKey === getKey(row) && "keyboard-focused",
                navigationEnabled && multiSelectedKeys?.includes(getKey(row)) && "multi-selected",
              )}
              onFocus={navigationEnabled ? (event) => {
                if (event.target === event.currentTarget) onRowFocus?.(row);
              } : undefined}
              onClick={onRowClick ? (event) => {
                if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role=menuitem]")) return;
                onRowClick(row);
              } : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cx(column.numeric && "num", column.className)}
                  title={column.title?.(row)}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {active && padBottom > 0 && <SpacerRow span={columns.length} height={padBottom} />}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SpacerRow({ span, height }: { span: number; height: number }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={span} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}
