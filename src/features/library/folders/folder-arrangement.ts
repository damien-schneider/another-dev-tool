import type { FileRow, Root } from "@/lib/ipc-types";
import {
  buildTree,
  type FolderTree,
  folderIds,
  folderNodeId,
  TREE_ROOT_ID,
  type TreeIndex,
} from "@/lib/tree";

import { isWithin, pathName } from "../library-paths";

export interface FolderArrangement {
  index: TreeIndex;
  /** The open project's own rows, or every root while no project is open. */
  topIds: string[];
  worktreesId: string | null;
  worktreeIds: string[];
  personalIds: string[];
  branchIds: string[];
  /** Outermost first. */
  locations: Map<string, string[]>;
}

interface Placement {
  base: string;
  worktree: boolean;
}

function placementOf(
  file: FileRow,
  root: Root,
  project: string | null
): Placement {
  if (project !== null && isWithin(file.path, project)) {
    return { base: project, worktree: false };
  }
  if (
    project !== null &&
    file.repositoryDir === project &&
    file.projectDir !== null
  ) {
    return { base: file.projectDir, worktree: true };
  }
  return { base: root.path, worktree: false };
}

function underProject(
  { index, locations }: FolderTree,
  project: string,
  worktreeIds: ReadonlySet<string>
): FolderArrangement {
  const projectId = folderNodeId(project);
  const worktreesId = worktreeIds.size > 0 ? `${projectId}#worktrees` : null;
  for (const [fileId, [baseId = "", ...inner]] of locations) {
    if (baseId === projectId) {
      locations.set(fileId, inner);
    } else if (worktreesId !== null && worktreeIds.has(baseId)) {
      locations.set(fileId, [worktreesId, baseId, ...inner]);
    }
  }
  const baseIds = index[TREE_ROOT_ID]?.childIds ?? [];
  const branchIds = folderIds(index).filter((id) => id !== projectId);
  return {
    index,
    topIds: index[projectId]?.childIds ?? [],
    worktreesId,
    worktreeIds: baseIds.filter((id) => worktreeIds.has(id)),
    personalIds: baseIds.filter(
      (id) => id !== projectId && !worktreeIds.has(id)
    ),
    branchIds: worktreesId === null ? branchIds : [worktreesId, ...branchIds],
    locations,
  };
}

export function arrangeByFolder(
  files: readonly FileRow[],
  roots: readonly Root[],
  project: string | null
): FolderArrangement {
  const rootsById = new Map(roots.map((root) => [root.id, root]));
  const bases = new Map<number, string>();
  const worktreeIds = new Set<string>();
  for (const file of files) {
    const root = rootsById.get(file.rootId);
    if (root) {
      const { base, worktree } = placementOf(file, root, project);
      bases.set(file.id, base);
      if (worktree) {
        worktreeIds.add(folderNodeId(base));
      }
    }
  }

  const tree = buildTree(files, (file) => {
    const base = bases.get(file.id);
    return base === undefined ? null : { path: base, name: pathName(base) };
  });
  if (project !== null) {
    return underProject(tree, project, worktreeIds);
  }
  return {
    index: tree.index,
    topIds: tree.index[TREE_ROOT_ID]?.childIds ?? [],
    worktreesId: null,
    worktreeIds: [],
    personalIds: [],
    branchIds: folderIds(tree.index),
    locations: tree.locations,
  };
}
