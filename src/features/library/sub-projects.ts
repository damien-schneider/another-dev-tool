import type { FileKind, FileRow } from "@/lib/ipc-types";

import {
  agentHomeOf,
  isWithin,
  normalizePath,
  parentPath,
  relativePath,
} from "./library-paths";

const INSTRUCTION_KINDS: ReadonlySet<FileKind> = new Set([
  "agents-md",
  "claude-md",
  "gemini-md",
]);

/**
 * The folder a file makes into a sub-project: a repository's nested folder with
 * its own CLAUDE.md or AGENTS.md, like a monorepo package. The repository's own
 * config folders (`.claude`) and a skill's folder are not sub-projects.
 */
function subProjectDirOf(
  file: FileRow,
  home: string | null,
  skillDirs: ReadonlySet<string>
): string | null {
  if (
    file.projectDir === null ||
    !INSTRUCTION_KINDS.has(file.kind) ||
    agentHomeOf(file.path, home)
  ) {
    return null;
  }
  const folder = parentPath(file.path);
  const inProject = relativePath(folder, file.projectDir);
  return inProject === "" || inProject.startsWith(".") || skillDirs.has(folder)
    ? null
    : folder;
}

function isInSubProject(
  file: FileRow,
  subProjectDirs: ReadonlySet<string>
): boolean {
  if (file.projectDir === null) {
    return false;
  }
  const project = normalizePath(file.projectDir);
  let folder = parentPath(file.path);
  while (folder !== project && isWithin(folder, project)) {
    if (subProjectDirs.has(folder)) {
      return true;
    }
    folder = parentPath(folder);
  }
  return false;
}

/** Drops the files of monorepo packages, keeping what each repository holds at its top. */
export function withoutSubProjects(
  files: readonly FileRow[],
  home: string | null
): FileRow[] {
  const skillDirs = new Set(
    files
      .filter((file) => file.kind === "skill")
      .map((file) => parentPath(file.path))
  );
  const subProjectDirs = new Set(
    files.flatMap((file) => {
      const folder = subProjectDirOf(file, home, skillDirs);
      return folder === null ? [] : [folder];
    })
  );
  return files.filter((file) => !isInSubProject(file, subProjectDirs));
}
