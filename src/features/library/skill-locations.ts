import type { FileRow, Root } from "@/lib/ipc-types";

import { parentPath } from "./library-paths";

export interface SkillLocation {
  path: string;
  /** Skills already living there; zero for a suggested but still empty location. */
  skillCount: number;
  /** True for the per-user folders every project of that agent reads. */
  personal: boolean;
}

/** Most widely supported first. */
const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

export function isInsideRoots(path: string, roots: readonly Root[]): boolean {
  return roots.some(
    (root) =>
      root.enabled && (path === root.path || path.startsWith(`${root.path}/`))
  );
}

/** Folders already holding skills plus the personal ones the indexed home allows: personal first, by support, then busiest. */
export function skillLocations(
  files: readonly FileRow[],
  roots: readonly Root[],
  home: string | null
): SkillLocation[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.kind === "skill") {
      const location = parentPath(parentPath(file.path));
      counts.set(location, (counts.get(location) ?? 0) + 1);
    }
  }

  const personalRanks = new Map<string, number>();
  if (home !== null) {
    for (const [rank, relative] of SKILL_DIRS.entries()) {
      const path = `${home}/${relative}`;
      if (isInsideRoots(path, roots)) {
        personalRanks.set(path, rank);
        counts.set(path, counts.get(path) ?? 0);
      }
    }
  }

  const unranked = SKILL_DIRS.length;
  return [...counts]
    .map(([path, skillCount]) => ({
      path,
      skillCount,
      personal: personalRanks.has(path),
    }))
    .sort(
      (left, right) =>
        (personalRanks.get(left.path) ?? unranked) -
          (personalRanks.get(right.path) ?? unranked) ||
        right.skillCount - left.skillCount ||
        left.path.localeCompare(right.path)
    );
}

export function projectSkillLocation(
  locations: readonly SkillLocation[],
  project: string
): string {
  const candidates = SKILL_DIRS.map((relative) => `${project}/${relative}`);
  return (
    locations.find((location) => candidates.includes(location.path))?.path ??
    `${project}/${SKILL_DIRS[0]}`
  );
}

export function skillFilePath(location: string, name: string): string {
  return `${location}/${name}/SKILL.md`;
}
