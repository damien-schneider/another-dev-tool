import type { FileRow, FolderEntry } from "@/lib/ipc-types";
import { fileNodeId, folderNodeId, type TreeIndex } from "@/lib/tree";

import { aliasEntryId, type LibraryEntry } from "../library-model";
import { parentPath } from "../library-paths";

export interface FolderLookup {
  entriesByPath: Map<string, LibraryEntry>;
  agentFolders: Set<string>;
}

export type FolderRow =
  | {
      type: "folder";
      id: string;
      path: string;
      name: string;
      linked: boolean;
      muted: boolean;
    }
  | { type: "entry"; id: string; name: string; entry: LibraryEntry }
  | { type: "other"; id: string; path: string; name: string; linked: boolean };

export function folderLookup(files: readonly FileRow[]): FolderLookup {
  const entriesByPath = new Map<string, LibraryEntry>();
  const agentFolders = new Set<string>();
  for (const file of files) {
    const reached: LibraryEntry[] = [
      { id: fileNodeId(file.id), file, path: file.path, linked: false },
      ...file.aliases.map((alias) => ({
        id: aliasEntryId(file.id, alias),
        file,
        path: alias,
        linked: true,
      })),
    ];
    for (const entry of reached) {
      entriesByPath.set(entry.path, entry);
      let folder = parentPath(entry.path);
      while (!agentFolders.has(folder)) {
        agentFolders.add(folder);
        const parent = parentPath(folder);
        if (parent === folder) {
          break;
        }
        folder = parent;
      }
    }
  }
  return { entriesByPath, agentFolders };
}

function listedRow(listed: FolderEntry, lookup: FolderLookup): FolderRow {
  if (listed.isDir) {
    return {
      type: "folder",
      id: folderNodeId(listed.path),
      path: listed.path,
      name: listed.name,
      linked: listed.isSymlink,
      muted: !lookup.agentFolders.has(listed.path),
    };
  }
  const entry = lookup.entriesByPath.get(listed.path);
  if (entry) {
    return { type: "entry", id: entry.id, name: listed.name, entry };
  }
  return {
    type: "other",
    id: `other:${listed.path}`,
    path: listed.path,
    name: listed.name,
    linked: listed.isSymlink,
  };
}

function byFolderThenName(left: FolderRow, right: FolderRow): number {
  const leftIsFolder = left.type === "folder";
  if (leftIsFolder !== (right.type === "folder")) {
    return leftIsFolder ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

export function folderRows(
  index: TreeIndex,
  path: string,
  listing: { entries: readonly FolderEntry[]; lookup: FolderLookup } | null
): FolderRow[] {
  const rows = new Map<string, FolderRow>();
  for (const childId of index[folderNodeId(path)]?.childIds ?? []) {
    const node = index[childId];
    if (!node) {
      continue;
    }
    rows.set(
      childId,
      node.file
        ? {
            type: "entry",
            id: childId,
            name: node.name,
            entry: {
              id: childId,
              file: node.file,
              path: node.path,
              linked: false,
            },
          }
        : {
            type: "folder",
            id: childId,
            path: node.path,
            name: node.name,
            linked: false,
            muted: false,
          }
    );
  }
  if (listing === null) {
    return [...rows.values()];
  }
  for (const listed of listing.entries) {
    const row = listedRow(listed, listing.lookup);
    rows.set(row.id, row);
  }
  return [...rows.values()].sort(byFolderThenName);
}
