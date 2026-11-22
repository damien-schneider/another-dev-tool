import type { FileKind, FileRow, Root } from "@/lib/ipc-types";
import { fileNodeId } from "@/lib/tree";

import {
  type AgentHome,
  agentHomeOf,
  isWithin,
  normalizePath,
  parentPath,
  pathName,
  relativePath,
} from "./library-paths";

/** One row of the library: a file where it lives, or where a link makes it show up. */
export interface LibraryEntry {
  /** Tree value; unique per row even when one file shows in several places. */
  id: string;
  file: FileRow;
  /** Where this row's file is reached: its own path, or the link's. */
  path: string;
  /** Reached through a symbolic link rather than living here. */
  linked: boolean;
}

/** A folder of the library that holds several files, e.g. a `skills` directory. */
export interface LibraryCollection {
  id: string;
  path: string;
  /** Path from the enclosing collection, else from the scope; empty at the scope's top level. */
  relativePath: string;
  entries: LibraryEntry[];
  /** Folders below this one that hold files of their own. */
  children: LibraryCollection[];
  /** Files listed in `entries` and in `children`. */
  entryCount: number;
}

/**
 * `personal`: an agent's home folder (`~/.claude`), whose skills every project gets.
 * `project`: a repository, or an indexed folder outside any agent home.
 * `worktree`: a second checkout of a repository, listed inside that repository.
 */
export type LibraryScopeKind = "personal" | "project" | "worktree";

/** A place the library groups files by, and everything found in it. */
export interface LibraryScope {
  id: string;
  kind: LibraryScopeKind;
  label: string;
  path: string;
  /** Files listed in `collections`. */
  entryCount: number;
  collections: LibraryCollection[];
  /** A worktree's files whose content matches the repository's copy. */
  unchanged: LibraryCollection[];
  /** A repository's worktrees: those with changes first, then by name. */
  worktrees: LibraryScope[];
}

export interface LibraryLocation {
  /** The branches above an entry, outermost first. */
  branchIds: string[];
}

export interface LibraryModel {
  /** Agent home folders, in the order of `AGENT_HOMES`. */
  personal: LibraryScope[];
  /** Repositories and other folders: favorites first, then by name. */
  projects: LibraryScope[];
  /** Every branch of the grouped tree. */
  branchIds: string[];
  locationsByEntryId: Map<string, LibraryLocation>;
}

export function worktreesBranchId(scope: LibraryScope): string {
  return `${scope.id}:worktrees`;
}

export function unchangedBranchId(scope: LibraryScope): string {
  return `${scope.id}:unchanged`;
}

export function aliasEntryId(fileId: number, alias: string): string {
  return `${fileNodeId(fileId)}@${alias}`;
}

export function aliasOfEntryId(entryId: string): string | null {
  const separator = entryId.indexOf("@");
  return separator === -1 ? null : entryId.slice(separator + 1);
}

const WHITESPACE_PATTERN = /\s+/;

/** A skill is its folder: `SKILL.md` alone would name every skill the same. */
function titleAt(kind: FileKind, path: string): string {
  return kind === "skill" ? pathName(parentPath(path)) : pathName(path);
}

export function fileTitle(file: FileRow): string {
  return titleAt(file.kind, file.path);
}

export function entryTitle(entry: LibraryEntry): string {
  return titleAt(entry.file.kind, entry.path);
}

/** The folder a row is listed under; a skill is listed under its folder's parent. */
function collectionPath(kind: FileKind, path: string): string {
  const immediateParent = parentPath(path);
  return kind === "skill" ? parentPath(immediateParent) : immediateParent;
}

interface ScopeInfo {
  kind: LibraryScopeKind;
  label: string;
  path: string;
  /** The repository a worktree checks out. */
  repositoryPath: string | null;
}

function projectScope(path: string, repositoryPath: string | null): ScopeInfo {
  return {
    kind: repositoryPath === null ? "project" : "worktree",
    label: pathName(path),
    path,
    repositoryPath,
  };
}

function personalScope(agentHome: AgentHome): ScopeInfo {
  return {
    kind: "personal",
    label: agentHome.label,
    path: agentHome.path,
    repositoryPath: null,
  };
}

class ModelBuilder {
  readonly scopes = new Map<string, LibraryScope>();
  readonly branchIds = new Set<string>();
  readonly locations = new Map<string, LibraryLocation>();
  private readonly collections = new Map<string, LibraryCollection>();
  /** The branches above each top-level collection, by collection id. */
  private readonly aboveIds = new Map<string, string[]>();

  /** The branches from the top of the tree down to `info`'s scope. */
  private scopePath(info: ScopeInfo): [LibraryScope, string[]] {
    const id = `scope:${info.path}`;
    const repository =
      info.repositoryPath === null
        ? null
        : this.scopePath(projectScope(info.repositoryPath, null));
    let scope = this.scopes.get(id);
    if (!scope) {
      scope = {
        id,
        kind: info.kind,
        label: info.label,
        path: info.path,
        entryCount: 0,
        collections: [],
        unchanged: [],
        worktrees: [],
      };
      this.scopes.set(id, scope);
      repository?.[0].worktrees.push(scope);
    }
    if (!repository) {
      return [scope, [id]];
    }
    const [parent, parentIds] = repository;
    return [scope, [...parentIds, worktreesBranchId(parent), id]];
  }

  add(info: ScopeInfo, entry: LibraryEntry, unchanged = false): void {
    const [scope, scopeIds] = this.scopePath(info);
    const groupIds = unchanged ? [unchangedBranchId(scope)] : [];
    const folderPath = collectionPath(entry.file.kind, entry.path);
    const collectionId = `${groupIds[0] ?? scope.id}:folder:${folderPath}`;
    let collection = this.collections.get(collectionId);
    if (!collection) {
      collection = {
        id: collectionId,
        path: folderPath,
        relativePath: relativePath(folderPath, scope.path),
        entries: [],
        children: [],
        entryCount: 0,
      };
      this.collections.set(collectionId, collection);
      this.aboveIds.set(collectionId, [...scopeIds, ...groupIds]);
      (unchanged ? scope.unchanged : scope.collections).push(collection);
    }

    if (!unchanged) {
      scope.entryCount += 1;
    }
    collection.entries.push(entry);
  }

  /** Nests every folder in its scope's tree, then records where each entry sits. */
  finish(): void {
    for (const scope of this.scopes.values()) {
      scope.collections = nestCollections(scope, scope.collections);
      scope.unchanged = nestCollections(scope, scope.unchanged);
      sortScope(scope);
      for (const collection of [...scope.collections, ...scope.unchanged]) {
        this.locate(collection, this.aboveIds.get(collection.id) ?? []);
      }
    }
  }

  private locate(collection: LibraryCollection, aboveIds: string[]): number {
    const branchIds = [...aboveIds, collection.id];
    for (const id of branchIds) {
      this.branchIds.add(id);
    }
    for (const entry of collection.entries) {
      this.locations.set(entry.id, { branchIds });
    }
    collection.entryCount = collection.children.reduce(
      (sum, child) => sum + this.locate(child, branchIds),
      collection.entries.length
    );
    return collection.entryCount;
  }
}

/** A file kept in a skill's folder belongs with that skill: each folder nests in the closest one above holding files. */
function nestCollections(
  scope: LibraryScope,
  collections: LibraryCollection[]
): LibraryCollection[] {
  const byFolder = new Map(
    collections.map((collection) => [collection.path, collection])
  );
  const topLevel: LibraryCollection[] = [];
  for (const collection of collections) {
    let parent: LibraryCollection | undefined;
    for (
      let folder = parentPath(collection.path);
      !parent && folder !== scope.path && isWithin(folder, scope.path);
      folder = parentPath(folder)
    ) {
      parent = byFolder.get(folder);
    }
    if (parent) {
      parent.children.push(collection);
      collection.relativePath = relativePath(collection.path, parent.path);
    } else {
      topLevel.push(collection);
    }
  }
  return topLevel;
}

const byPath = (left: LibraryCollection, right: LibraryCollection) =>
  left.relativePath.localeCompare(right.relativePath);

function sortCollections(collections: LibraryCollection[]): void {
  collections.sort(byPath);
  for (const collection of collections) {
    collection.entries.sort((left, right) =>
      entryTitle(left).localeCompare(entryTitle(right))
    );
    sortCollections(collection.children);
  }
}

function sortScope(scope: LibraryScope): void {
  sortCollections(scope.collections);
  sortCollections(scope.unchanged);
  scope.worktrees.sort(
    (left, right) =>
      Number(right.entryCount > 0) - Number(left.entryCount > 0) ||
      left.label.localeCompare(right.label)
  );
}

function matchesRepository(
  file: FileRow,
  scope: ScopeInfo,
  hashesByPath: ReadonlyMap<string, string>
): boolean {
  if (scope.repositoryPath === null) {
    return false;
  }
  const inWorktree = relativePath(file.path, scope.path);
  return (
    hashesByPath.get(`${normalizePath(scope.repositoryPath)}/${inWorktree}`) ===
    file.hash
  );
}

/** A linked file shows where it is installed and where it is maintained; a worktree sits inside its repository, unchanged files set apart. */
export function buildLibraryModel(
  files: readonly FileRow[],
  roots: readonly Root[],
  /** The user's home folder; `null` lists everything under Projects. */
  home: string | null,
  favoritePaths: ReadonlySet<string> = new Set(),
  /** Every indexed file, `files` being a search's matches among them. */
  indexed: readonly FileRow[] = files,
  showAliases = true
): LibraryModel {
  const rootsById = new Map(roots.map((root) => [root.id, root]));
  const hashesByPath = new Map(
    indexed.map((file) => [normalizePath(file.path), file.hash])
  );
  const builder = new ModelBuilder();
  const ranks = new Map<string, number>();

  for (const file of files) {
    const root = rootsById.get(file.rootId);
    if (!root) {
      continue;
    }
    const id = fileNodeId(file.id);
    const agentHome = agentHomeOf(file.path, home);
    if (agentHome) {
      ranks.set(agentHome.path, agentHome.rank);
    }
    const scope = agentHome
      ? personalScope(agentHome)
      : projectScope(file.projectDir ?? root.path, file.repositoryDir);
    const unchanged = matchesRepository(file, scope, hashesByPath);
    builder.add(scope, { id, file, path: file.path, linked: false }, unchanged);

    for (const alias of showAliases ? file.aliases : []) {
      const link = {
        id: aliasEntryId(file.id, alias),
        file,
        path: alias,
        linked: true,
      };
      const aliasHome = agentHomeOf(alias, home);
      if (aliasHome) {
        ranks.set(aliasHome.path, aliasHome.rank);
        builder.add(personalScope(aliasHome), link);
      } else if (isWithin(alias, scope.path)) {
        builder.add(scope, link, unchanged);
      }
    }
  }

  builder.finish();
  const scopes = [...builder.scopes.values()];
  const homeRank = (scope: LibraryScope) => ranks.get(scope.path) ?? 0;

  return {
    personal: scopes
      .filter((scope) => scope.kind === "personal")
      .sort(
        (left, right) =>
          homeRank(left) - homeRank(right) ||
          left.path.localeCompare(right.path)
      ),
    projects: scopes
      .filter((scope) => scope.kind === "project")
      .sort(
        (left, right) =>
          Number(favoritePaths.has(right.path)) -
            Number(favoritePaths.has(left.path)) ||
          left.label.localeCompare(right.label) ||
          left.path.localeCompare(right.path)
      ),
    branchIds: [...builder.branchIds],
    locationsByEntryId: builder.locations,
  };
}

/** Matches every whitespace-separated term against a file's name, paths, and description. */
export function filterFiles(
  files: readonly FileRow[],
  query: string
): FileRow[] {
  const terms = query.toLowerCase().split(WHITESPACE_PATTERN).filter(Boolean);
  if (terms.length === 0) {
    return [...files];
  }
  return files.filter((file) => {
    const haystack =
      `${file.path} ${file.aliases.join(" ")} ${file.name ?? ""} ${file.description ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
