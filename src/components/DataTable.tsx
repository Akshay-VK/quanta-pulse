import { useRef, type ReactNode } from "react";
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

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getKey: (row: T) => string | number;
  sort?: { id: string; dir: "asc" | "desc" } | null;
  onSort?: (id: string) => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  empty?: ReactNode;
  ariaLabel?: string;
  /** Windowed rendering above 200 rows. */
  virtual?: boolean;
  /** Viewport height of the scroll box when virtual. */
  height?: number;
}

const ROW_H = 40;
const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 8;

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
  empty,
  ariaLabel,
  virtual = false,
  height = 560,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const active = virtual && rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: active ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: OVERSCAN,
  });

  const items = active ? virtualizer.getVirtualItems() : [];
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
      <table className="data-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sorted = sort?.id === column.id;
              return (
                <th
                  key={column.id}
                  className={cx(column.sortable && "sortable")}
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
        </thead>
        <tbody>
          {active && padTop > 0 && <SpacerRow span={columns.length} height={padTop} />}
          {visible.map(({ row }) => (
            <tr
              key={getKey(row)}
              className={cx(selectedKey === getKey(row) && "selected")}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
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
