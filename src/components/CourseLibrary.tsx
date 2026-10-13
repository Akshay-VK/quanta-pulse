import { useEffect, useMemo, useState } from "react";
import {
  RESOURCE_SORTS,
  categoryOptions,
  filterCourseResources,
  resourceCategory,
  sortResources,
  typeOptions,
  type ResourceCategoryId,
  type ResourceSort,
} from "../lib/courseLibrary";
import { buildCourseTree, dedupeCourseResources, findNode, type CourseTreeNode } from "../lib/courseTree";
import { describeUpload, formatBytes } from "../lib/format";
import { fileTone } from "../lib/filetype";
import { formatSectionPath } from "../lib/sectionPath";
import { previewMode } from "../lib/preview";
import type { Course, Resource } from "../lib/types";
import ResourcePreviewPanel from "./ResourcePreviewPanel";

interface Props {
  course: Course;
  resources: Resource[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (url: string) => void;
}

/** Course materials arranged in the crawler's section and nested-page paths. */
export default function CourseLibrary({ course, resources, loading, error, onRetry, onOpen }: Props) {
  const [path, setPath] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ResourceSort>("newest");
  const [type, setType] = useState("");
  const [category, setCategory] = useState<ResourceCategoryId | "all">("all");
  const [preview, setPreview] = useState<Resource | null>(null);

  const uniqueResources = useMemo(() => dedupeCourseResources(resources), [resources]);
  const tree = useMemo(() => buildCourseTree(uniqueResources, course.name), [uniqueResources, course.name]);
  const selectedNode = findNode(tree, path);
  const current = selectedNode ?? tree;
  const currentPath = selectedNode ? path : [];
  const types = useMemo(() => typeOptions(uniqueResources), [uniqueResources]);
  const categories = useMemo(() => categoryOptions(uniqueResources), [uniqueResources]);
  const matches = useMemo(
    () => filterCourseResources(uniqueResources, { search, type, category }),
    [uniqueResources, search, type, category],
  );
  const searching = search.trim().length > 0;

  // A sync may remove the selected node. Snap back to root and discard only
  // expansion keys that no longer exist; retained nodes keep their state.
  useEffect(() => {
    if (!selectedNode && path.length > 0) setPath([]);
    const validIds = collectNodeIds(tree);
    setExpanded((previous) => {
      const next = new Set([...previous].filter((id) => validIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [tree, selectedNode, path.length]);

  const visibleResources = useMemo(() => {
    if (searching) return sortResources(matches, sort);
    return sortResources(
      current.resources.filter((resource) =>
        (!type || resource.resourceType.toLowerCase() === type.toLowerCase()) &&
        (category === "all" || resourceCategory(resource.resourceType) === category),
      ),
      sort,
    );
  }, [searching, matches, current.resources, type, category, sort]);

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const resourceMatchesFilters = (resource: Resource) =>
    (!type || resource.resourceType.toLowerCase() === type.toLowerCase()) &&
    (category === "all" || resourceCategory(resource.resourceType) === category);

  return (
    <div className="library">
      <div className="library-toolbar">
        <input
          type="search"
          aria-label="Search resources in this course"
          placeholder="Search all sections…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select aria-label="Sort resources" value={sort} onChange={(event) => setSort(event.target.value as ResourceSort)}>
          {RESOURCE_SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select aria-label="Filter by file type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All types</option>
          {types.map((option) => <option key={option.type} value={option.type}>{option.type} ({option.count})</option>)}
        </select>
        <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value as ResourceCategoryId | "all")}>
          <option value="all">All categories</option>
          {categories.map((option) => <option key={option.id} value={option.id}>{option.label} ({option.count})</option>)}
        </select>
      </div>

      <nav className="breadcrumb library-breadcrumb" aria-label="Course section breadcrumb">
        <button type="button" className="btn-link" onClick={() => { setPath([]); setSearch(""); }}>{course.name}</button>
        {currentPath.map((part, index) => (
          <span className="breadcrumb-part" key={JSON.stringify(currentPath.slice(0, index + 1))}>
            <span className="sep">/</span>
            <button type="button" className="btn-link" onClick={() => { setPath(currentPath.slice(0, index + 1)); setSearch(""); }}>{part}</button>
          </span>
        ))}
        {searching && <><span className="sep">/</span><span>Search results</span></>}
      </nav>

      {error ? (
        <div className="library-state"><div className="alert error">{error}</div><button type="button" className="btn" onClick={onRetry}>Retry</button></div>
      ) : loading && uniqueResources.length === 0 ? (
        <div className="empty">Loading course structure…</div>
      ) : uniqueResources.length === 0 ? (
        <div className="empty">No resources have been discovered for this course yet.</div>
      ) : (
        <>
          <p className="library-count muted">
            {searching
              ? `Found ${visibleResources.length} of ${uniqueResources.length} resources across all sections`
              : `${current.count} descendant resources in ${currentPath.length ? current.name : course.name}`}
            {uniqueResources.length !== course.resourceCount ? ` (${course.resourceCount} recorded)` : ""}
          </p>
          {!searching && current.children.length > 0 && (
            <div className="course-tree" role="list" aria-label="Sections and nested pages">
              {current.children.map((node) => (
                <FolderRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded.has(node.id)}
                  onToggle={() => toggleExpanded(node.id)}
                  onNavigate={() => setPath(node.path)}
                  onOpen={onOpen}
                  isExpanded={(id) => expanded.has(id)}
                  toggleNode={toggleExpanded}
                  navigateTo={setPath}
                  resources={uniqueResources}
                  sort={sort}
                  resourceMatchesFilters={resourceMatchesFilters}
                  setPreview={setPreview}
                />
              ))}
            </div>
          )}
          {searching && visibleResources.length === 0 ? (
            <div className="empty">No resources match the current search and filters.</div>
          ) : !searching && current.children.length === 0 && visibleResources.length === 0 ? (
            <div className="empty">This section has no discovered child sections or resources.</div>
          ) : (
            <ResourceGroups resources={uniqueResources} items={visibleResources} showPath={searching} onPreview={setPreview} onOpen={onOpen} />
          )}
        </>
      )}

      {preview && <ResourcePreviewPanel resource={preview} onClose={() => setPreview(null)} onOpen={onOpen} />}
    </div>
  );
}

interface FolderRowProps {
  node: CourseTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onOpen: (url: string) => void;
  isExpanded: (id: string) => boolean;
  toggleNode: (id: string) => void;
  navigateTo: (path: string[]) => void;
  resources: Resource[];
  sort: ResourceSort;
  resourceMatchesFilters: (resource: Resource) => boolean;
  setPreview: (resource: Resource) => void;
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  onNavigate,
  onOpen,
  isExpanded,
  toggleNode,
  navigateTo,
  resources,
  sort,
  resourceMatchesFilters,
  setPreview,
}: FolderRowProps) {
  const directResources = sortResources(node.resources.filter(resourceMatchesFilters), sort);
  return (
    <div className="course-tree-node" role="listitem">
      <div className="course-tree-row" style={{ "--tree-depth": depth } as React.CSSProperties}>
        <button
          type="button"
          className="course-tree-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        </button>
        <button type="button" className="course-tree-navigate" title={`Open section ${node.name}`} onClick={onNavigate}>
          <strong title={node.name}>{node.name}</strong>
        </button>
        <span className="course-tree-count" title="Includes resources in this section and all nested sections">{node.count} resources</span>
        {node.sourcePageUrl ? (
          <button type="button" className="btn-link course-tree-external" onClick={() => onOpen(node.sourcePageUrl!)}>Open Quanta page ↗</button>
        ) : (
          <span className="course-tree-external-placeholder" aria-hidden="true" />
        )}
      </div>
      {expanded && (
        <div className="course-tree-contents" aria-label={`${node.name} contents`}>
          {directResources.length > 0 && (
            <div className="course-tree-resource-list" style={{ "--tree-depth": depth + 1 } as React.CSSProperties}>
              <ResourceGroups resources={resources} items={directResources} showPath={false} onPreview={setPreview} onOpen={onOpen} />
            </div>
          )}
          {node.children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={isExpanded(child.id)}
              onToggle={() => toggleNode(child.id)}
              onNavigate={() => navigateTo(child.path)}
              onOpen={onOpen}
              isExpanded={isExpanded}
              toggleNode={toggleNode}
              navigateTo={navigateTo}
              resources={resources}
              sort={sort}
              resourceMatchesFilters={resourceMatchesFilters}
              setPreview={setPreview}
            />
          ))}
          {directResources.length === 0 && node.children.length === 0 && (
            <div className="course-tree-empty">No resources in this section.</div>
          )}
        </div>
      )}
    </div>
  );

}

function ResourceGroups({
  resources,
  items,
  showPath,
  onPreview,
  onOpen,
}: {
  resources: Resource[];
  items: Resource[];
  showPath: boolean;
  onPreview: (resource: Resource) => void;
  onOpen: (url: string) => void;
}) {
  const groups = new Map<ResourceCategoryId, Resource[]>();
  for (const resource of items) {
    const id = resourceCategory(resource.resourceType);
    groups.set(id, [...(groups.get(id) ?? []), resource]);
  }
  return <>
    {[...groups.entries()].map(([id, groupItems]) => (
      <section className="library-group" key={id}>
        <h3 className="library-group-head">{categoryOptions(resources).find((option) => option.id === id)?.label ?? id}<span className="faint"> · {groupItems.length}</span></h3>
        {groupItems.map((resource) => <LibraryRow key={resource.id} resource={resource} showPath={showPath} onPreview={() => onPreview(resource)} onOpen={onOpen} />)}
      </section>
    ))}
  </>;
}

function collectNodeIds(root: CourseTreeNode): Set<string> {
  const ids = new Set<string>();
  const visit = (node: CourseTreeNode) => {
    ids.add(node.id);
    node.children.forEach(visit);
  };
  visit(root);
  return ids;
}

function LibraryRow({ resource, showPath, onPreview, onOpen }: { resource: Resource; showPath: boolean; onPreview: () => void; onOpen: (url: string) => void }) {
  const mode = previewMode(resource.resourceType, resource.url);
  const upload = describeUpload(resource);
  const listing = resource.sourcePageUrl && resource.sourcePageUrl !== resource.url ? resource.sourcePageUrl : null;
  const available = resource.availabilityStatus === "available";
  return (
    <div className="library-row">
      <div className="library-row-main">
        <button type="button" className="library-row-title" title={mode ? "Preview in app" : "Open the original resource"} onClick={() => (mode ? onPreview() : onOpen(resource.url))}>{resource.title}</button>
        {showPath && <div className="library-row-location">Section: {formatSectionPath(resource)}</div>}
        <div className="library-row-meta">
          <span className={`file-type ${fileTone(resource.resourceType)}`}><span className="file-dot" aria-hidden="true" />{resource.resourceType}</span><span className="sep">·</span>
          {upload.source === "unavailable" ? <span className="faint">Upload date unavailable</span> : <span>{upload.label}{upload.note && <span className="faint"> ({upload.note})</span>}</span>}
          {resource.sizeBytes ? <><span className="sep">·</span><span>{formatBytes(resource.sizeBytes)}</span></> : null}
          {!available && <><span className="sep">·</span><span className="text-danger">{resource.availabilityStatus}</span></>}
        </div>
      </div>
      <div className="library-row-actions">
        {mode && <button type="button" className="btn-link" onClick={onPreview}>Preview</button>}
        <button type="button" className="btn-link" onClick={() => onOpen(resource.url)}>Open Original Resource</button>
        {listing && <button type="button" className="btn-link" onClick={() => onOpen(listing)}>Open Listing Page</button>}
      </div>
    </div>
  );
}
