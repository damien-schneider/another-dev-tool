import type { FileRow } from "./ipc-types";

export const TREE_ROOT_ID = "root";

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  file: FileRow | null;
  childIds: string[];
}

export type TreeIndex = Record<string, TreeNode>;

export interface TreeBase {
  path: string;
  name: string;
}

export interface FolderTree {
  index: TreeIndex;
  /** Outermost first. */
  locations: Map<string, string[]>;
}

const SEPARATOR_PATTERN = /[\\/]+/;

export function fileNodeId(fileId: number): string {
  return `file:${fileId}`;
}

export function fileIdOf(nodeId: string): number | null {
  const raw = nodeId.startsWith("file:") ? nodeId.slice(5) : null;
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function folderNodeId(path: string): string {
  return `dir:${path}`;
}

function folderNode(path: string, name: string): TreeNode {
  return {
    id: folderNodeId(path),
    name,
    path,
    isFolder: true,
    file: null,
    childIds: [],
  };
}

function ensureNode(index: TreeIndex, node: TreeNode): TreeNode {
  const existing = index[node.id];
  if (existing) {
    return existing;
  }
  index[node.id] = node;
  return node;
}

function attach(parent: TreeNode, childId: string) {
  if (!parent.childIds.includes(childId)) {
    parent.childIds.push(childId);
  }
}

function sortChildren(index: TreeIndex) {
  for (const node of Object.values(index)) {
    node.childIds.sort((left, right) => {
      const a = index[left];
      const b = index[right];
      if (!(a && b)) {
        return 0;
      }
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
}

export function buildTree(
  files: readonly FileRow[],
  baseOf: (file: FileRow) => TreeBase | null
): FolderTree {
  const top: TreeNode = {
    id: TREE_ROOT_ID,
    name: "",
    path: "",
    isFolder: true,
    file: null,
    childIds: [],
  };
  const index: TreeIndex = { [TREE_ROOT_ID]: top };
  const locations = new Map<string, string[]>();

  for (const file of files) {
    const base = baseOf(file);
    if (!(base?.path && file.path.startsWith(`${base.path}/`))) {
      continue;
    }
    const segments = file.path
      .slice(base.path.length + 1)
      .split(SEPARATOR_PATTERN)
      .filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) {
      continue;
    }

    let parent = ensureNode(index, folderNode(base.path, base.name));
    attach(top, parent.id);
    const branchIds = [parent.id];
    for (const segment of segments) {
      const folder = ensureNode(
        index,
        folderNode(`${parent.path}/${segment}`, segment)
      );
      attach(parent, folder.id);
      branchIds.push(folder.id);
      parent = folder;
    }

    const leaf = ensureNode(index, {
      id: fileNodeId(file.id),
      name: fileName,
      path: file.path,
      isFolder: false,
      file,
      childIds: [],
    });
    attach(parent, leaf.id);
    locations.set(leaf.id, branchIds);
  }

  sortChildren(index);
  return { index, locations };
}

export function folderIds(index: TreeIndex): string[] {
  return Object.values(index)
    .filter((node) => node.isFolder && node.id !== TREE_ROOT_ID)
    .map((node) => node.id);
}
