import type { Resource } from "./types";
import { resourceSectionPath } from "./sectionPath";

export interface CourseTreeNode {
  /** Stable key derived from the ordered section path, never a sibling index. */
  id: string;
  name: string;
  path: string[];
  children: CourseTreeNode[];
  resources: Resource[];
  count: number;
  sourcePageUrl: string | null;
}

export function dedupeCourseResources(resources: Resource[]): Resource[] {
  const unique = new Map<string, Resource>();
  for (const resource of resources) {
    const key = resource.externalResourceId || `local:${resource.id}`;
    if (!unique.has(key)) unique.set(key, resource);
  }
  return [...unique.values()];
}

/** Build a navigable tree from persisted, crawler-derived resource paths. */
export function buildCourseTree(resources: Resource[], courseName: string): CourseTreeNode {
  const root: CourseTreeNode = {
    id: JSON.stringify([]),
    name: courseName,
    path: [],
    children: [],
    resources: [],
    count: 0,
    sourcePageUrl: null,
  };
  const findOrCreate = (parent: CourseTreeNode, name: string): CourseTreeNode => {
    let child = parent.children.find((node) => node.name === name);
    if (!child) {
      child = {
        id: JSON.stringify([...parent.path, name]),
        name,
        path: [...parent.path, name],
        children: [],
        resources: [],
        count: 0,
        sourcePageUrl: null,
      };
      parent.children.push(child);
    }
    return child;
  };

  // The database normally guarantees one row per external resource id. Keep
  // the tree correct even if an API response contains the same row twice:
  // counts and rendered resources are both based on unique resources.
  for (const resource of dedupeCourseResources(resources)) {
    let node = root;
    node.count += 1;
    for (const segment of resourceSectionPath(resource)) {
      node = findOrCreate(node, segment);
      node.count += 1;
      node.sourcePageUrl ??= resource.sourcePageUrl;
    }
    node.resources.push(resource);
  }
  const sort = (node: CourseTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    node.resources.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function findNode(root: CourseTreeNode, path: string[]): CourseTreeNode | null {
  let node = root;
  for (const segment of path) {
    const child = node.children.find((item) => item.name === segment);
    if (!child) return null;
    node = child;
  }
  return node;
}
