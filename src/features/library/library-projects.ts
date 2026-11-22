import type { FileRow, Root } from "@/lib/ipc-types";

import { agentHomeOf } from "./library-paths";

/** `null`: every project lists it (in an agent home, or reached `through` a link kept there). */
export function projectOf(
  file: FileRow,
  roots: readonly Root[],
  home: string | null,
  through: string | null = null
): string | null {
  if (agentHomeOf(through ?? file.path, home)) {
    return null;
  }
  const root = roots.find((candidate) => candidate.id === file.rootId);
  if (!root) {
    return null;
  }
  return file.repositoryDir ?? file.projectDir ?? root.path;
}

export function filesInProject(
  files: readonly FileRow[],
  roots: readonly Root[],
  home: string | null,
  project: string,
  /** Keeps another project's file whose link an agent home lists. */
  showAliases: boolean
): FileRow[] {
  return files.filter((file) => {
    const owner = projectOf(file, roots, home);
    return (
      owner === null ||
      owner === project ||
      (showAliases &&
        file.aliases.some((alias) => agentHomeOf(alias, home) !== null))
    );
  });
}
