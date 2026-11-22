import "@testing-library/jest-dom/vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import type { FileRow, Root } from "@/lib/ipc-types";
import { pathName } from "./library-paths";
import { LibraryTree } from "./library-tree";

const HOME = "/Users/me";
const PERSONAL_MARK = "Personal skill in Claude Code and Shared agents";
const NOT_LOADED = "No agent loads this skill";
const PROJECT_PATH = `${HOME}/GitHub/skills/humanizer/SKILL.md`;

const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
  { id: 3, path: `${HOME}/.codex`, enabled: true, addedAt: 0 },
];

function skill(id: number, path: string, aliases: string[] = []): FileRow {
  const root = roots.find((candidate) => path.startsWith(candidate.path));
  return {
    id,
    rootId: root?.id ?? 1,
    path,
    relPath: path.slice((root?.path.length ?? 0) + 1),
    kind: "skill",
    name: path.split("/").at(-2) ?? null,
    description: null,
    aliases,
    projectDir: null,
    repositoryDir: null,
    size: 1,
    mtimeNs: 1,
    hash: `h${id}`,
    isSymlink: false,
    symlinkTarget: null,
    firstSeenAt: 0,
    lastSeenScanId: 1,
    deletedAt: null,
  };
}

function renderTree(files: FileRow[]) {
  render(
    <LibraryTree
      expandAll
      favoritePaths={new Set()}
      files={files}
      indexedFiles={files}
      mode="grouped"
      onSelectFile={() => undefined}
      onToggleFavorite={() => Promise.resolve()}
      project={null}
      roots={roots}
      selectedAlias={null}
      selectedFileId={null}
      showAliases
    />
  );
}

beforeAll(() => {
  mockIPC((command) =>
    command === "plugin:path|resolve_directory" ? HOME : undefined
  );
});

describe("LibraryTree skill reach", () => {
  it("tells on the project row of a skill every project gets, not on its rows in Personal", async () => {
    renderTree([
      skill(1, PROJECT_PATH, [
        `${HOME}/.agents/skills/humanizer/SKILL.md`,
        `${HOME}/.claude/skills/humanizer/SKILL.md`,
      ]),
    ]);

    const rows = await waitFor(() => {
      const found = screen.getAllByRole("treeitem", { name: "humanizer" });
      expect(found).toHaveLength(3);
      return found;
    });
    const isProjectRow = (row: HTMLElement) =>
      row.querySelector(`[title="${PROJECT_PATH}"]`) !== null;

    expect(rows.find(isProjectRow)).toHaveAccessibleDescription(PERSONAL_MARK);
    for (const personalRow of rows.filter((row) => !isProjectRow(row))) {
      expect(personalRow).toHaveAccessibleDescription(
        "Link to ~/GitHub/skills/humanizer/SKILL.md"
      );
    }
  });

  it.each([
    ["outside any agent folder", "GitHub/skills/emil/emil-color", NOT_LOADED],
    ["in an agent's trash", ".claude/skills/.trash/1794-a1/deploy", NOT_LOADED],
    ["in a project's Claude Code folder", "GitHub/app/.claude/skills/lint", ""],
    [
      "in a project's Mastra Code folder",
      "GitHub/mastra/.mastracode/skills/ship",
      "",
    ],
    ["among Codex's system skills", ".codex/skills/.system/imagegen", ""],
    ["synced from claude.ai", ".claude/skills/synced/org_account/docx", ""],
  ])(
    "tells whether any agent loads a skill %s",
    async (_, folder, description) => {
      renderTree([skill(1, `${HOME}/${folder}/SKILL.md`)]);

      await waitFor(() =>
        expect(
          screen.getByRole("treeitem", { name: pathName(folder) })
        ).toHaveAccessibleDescription(description)
      );
    }
  );
});
