import { Select } from "./ui/Select";
import { useMemo } from "react";
import type { Course, Resource } from "../lib/types";
import { paletteQueryFilterValues, parsePaletteQuery, replacePaletteQueryFilter, type PaletteTokenKey } from "../lib/paletteQuery";
import { searchDesktop, type SearchScope, type SearchFilters } from "../lib/desktopSearch";

/** Controls edit the same query tokens accepted by every search surface. */
export function SearchControls({ raw, onRaw, scope, onScope, filters, onFilters, courses, resources }: {
  raw: string; onRaw: (raw: string) => void; scope: SearchScope; onScope: (scope: SearchScope) => void;
  filters: SearchFilters; onFilters: (filters: SearchFilters) => void; courses: Course[]; resources: Resource[];
}) {
  const parsed = parsePaletteQuery(raw, { courses, resources });
  const folders = useMemo(() => searchDesktop({ raw: "", scope: { kind: "everywhere" } }, { courses, resources }).folders, [courses, resources]);
  const value = JSON.stringify(scope);
  const options = [
    { scope: { kind: "everywhere" } as SearchScope, label: "Everywhere" },
    ...courses.map(c => ({ scope: { kind: "course", courseId: c.id } as SearchScope, label: `Course · ${c.displayName ?? c.shortName ?? c.name}` })),
    ...folders.map(f => ({ scope: { kind: "folder", courseId: f.courseId, path: f.path } as SearchScope, label: `Folder · ${courses.find(c => c.id === f.courseId)?.shortName ?? f.courseId} / ${f.path.join(" / ")}` })),
  ];
  if (!options.some(o => JSON.stringify(o.scope) === value)) options.push({ scope, label: "Unavailable destination" });
  const edit = (key: PaletteTokenKey, next: string, dimension?: string[]) => onRaw(replacePaletteQueryFilter(parsed, key, next, dimension));
  const selected = (key: PaletteTokenKey, dimension?: string[]) => paletteQueryFilterValues(parsed, key, resources, dimension);
  const select = (label: string, key: PaletteTokenKey, values: string[], dimension?: string[]) => {
    const active = selected(key, dimension);
    return <label className="filter-chip"><span>{label}</span><select aria-label={label} value={active.length === 1 ? active[0] : active.length > 1 ? "multiple" : ""} onChange={e => edit(key, e.target.value, dimension)}>
      <option value="">Any</option>{active.length > 1 && <option value="multiple" disabled>Multiple</option>}
      {values.map(v => <option key={v} value={v}>{v}</option>)}
    </select></label>;
  };
  return <div className="desktop-search-controls" role="group" aria-label="Search scope and filters">
    <label className="filter-chip"><span>Scope</span><select aria-label="Search scope" value={value} onChange={e => onScope(JSON.parse(e.target.value) as SearchScope)}>
      {options.map(o => <option key={JSON.stringify(o.scope)} value={JSON.stringify(o.scope)}>{o.label}</option>)}
    </select></label>
    <Select ariaLabel="Filter by file type" value={selected("type").length === 1 ? selected("type")[0] : "all"} onValueChange={v => edit("type", v === "all" ? "" : v)} options={[
      { value: "all", label: selected("type").length > 1 ? "Multiple types" : "All types" },
      ...[...new Set(resources.map(r => r.resourceType))].sort().map(type => ({ value: type, label: `${type} (${resources.filter(r => r.resourceType === type).length})` })),
    ]} />
    <Select ariaLabel="Filter by course" value={selected("course").length === 1 ? selected("course")[0] : "all"} onValueChange={v => edit("course", v === "all" ? "" : v)} options={[
      { value: "all", label: selected("course").length > 1 ? "Multiple courses" : "All courses" },
      ...courses.map(c => ({ value: c.displayName ?? c.shortName ?? c.name, label: c.displayName ?? c.shortName ?? c.name })),
      ...selected("course").filter(v => !courses.some(c => (c.displayName ?? c.shortName ?? c.name) === v)).map(v => ({ value: v, label: v })),
    ]} />
    {select("Read state", "is", ["unread", "read"], ["unread", "read"])}
    {select("Saved state", "is", ["saved", "unsaved"], ["saved", "unsaved"])}
    {select("Deadline", "due", ["today", "week", "overdue", "none"])}
    <label className="filter-chip"><span>Source from</span><input aria-label="Source date from" type="date" value={filters.sourceFrom ?? ""} onChange={e => onFilters({ ...filters, sourceFrom: e.target.value })} /></label>
    <label className="filter-chip"><span>through</span><input aria-label="Source date through" type="date" value={filters.sourceThrough ?? ""} onChange={e => onFilters({ ...filters, sourceThrough: e.target.value })} /></label>
    <span className="faint">Source date: upload, publication, modification, then first seen</span>
  </div>;
}
