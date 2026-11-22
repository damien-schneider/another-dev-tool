import "@testing-library/jest-dom/vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileRow, FolderEntry, Root } from "@/lib/ipc-types";

import { LibraryTree } from "./library-tree";

const HOME = "/Users/me";
const PROJECT = `${HOME}/GitHub/skills`;
const SKILL_PATH = `${PROJECT}/.agents/skills/ask-sonner/SKILL.md`;
const LINKED_PATH = `${PROJECT}/interface/ask-sonner/SKILL.md`;
const OTHER_FILE = "Not a skill, agent, or rule";
const NO_AGENT_FILES = "Holds no skill, agent, or rule";
const LINK_TO_SKILL =
  /^Link to ~\/GitHub\/skills\/\.agents\/skills\/ask-sonner/;

const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
];

function row(id: number, path: string, overrides: Partial<FileRow>): FileRow {
  return {
    id,
    rootId: path.startsWith(`${HOME}/GitHub`) ? 1 : 2,
    path,
    relPath: path,
    kind: "agents-md",
    name: null,
    description: null,
    aliases: [],
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
    ...overrides,
  };
}

const skill = row(1, SKILL_PATH, {
  kind: "skill",
  name: "ask-sonner",
  projectDir: PROJECT,
  aliases: [LINKED_PATH],
});
const files = [
  skill,
  row(2, `${HOME}/.claude/CLAUDE.md`, { kind: "claude-md" }),
];

function entry(path: string, isDir: boolean, isSymlink = false): FolderEntry {
  return { name: path.split("/").at(-1) ?? path, path, isDir, isSymlink };
}

const disk: Record<string, FolderEntry[]> = {
  [PROJECT]: [
    entry(`${PROJECT}/.agents`, true),
    entry(`${PROJECT}/interface`, true),
    entry(`${PROJECT}/scripts`, true),
    entry(`${PROJECT}/drafts`, true),
    entry(`${PROJECT}/README.md`, false),
  ],
  [`${PROJECT}/interface`]: [
    entry(`${PROJECT}/interface/ask-sonner`, true, true),
  ],
  [`${PROJECT}/interface/ask-sonner`]: [entry(LINKED_PATH, false)],
};

const unreadable: Record<string, { code: string; message: string }> = {
  [`${PROJECT}/scripts`]: {
    code: "io",
    message: "Operation not permitted (os error 1)",
  },
  [`${PROJECT}/drafts`]: { code: "not_found", message: "drafts" },
};

const listedFolders: string[] = [];

function folderOf(payload: unknown): string {
  return typeof payload === "object" &&
    payload !== null &&
    "path" in payload &&
    typeof payload.path === "string"
    ? payload.path
    : "";
}

beforeAll(() => {
  mockIPC((command, payload) => {
    if (command === "plugin:path|resolve_directory") {
      return HOME;
    }
    if (command === "list_folder") {
      const path = folderOf(payload);
      listedFolders.push(path);
      const failure = unreadable[path];
      if (failure) {
        throw failure;
      }
      return disk[path] ?? [];
    }
    return null;
  });
});

beforeEach(() => {
  listedFolders.length = 0;
});

function projectTree({
  showOtherFiles,
  expandAll = false,
  onSelectFile = () => undefined,
}: {
  showOtherFiles: boolean;
  expandAll?: boolean;
  onSelectFile?: (file: FileRow, alias: string | null) => void;
}) {
  return (
    <LibraryTree
      expandAll={expandAll}
      favoritePaths={new Set()}
      files={files}
      indexedFiles={files}
      mode="folders"
      onSelectFile={onSelectFile}
      onToggleFavorite={() => Promise.resolve()}
      project={PROJECT}
      roots={roots}
      selectedAlias={null}
      selectedFileId={null}
      showAliases
      showOtherFiles={showOtherFiles}
    />
  );
}

describe("LibraryTree arranged by folder with a project open", () => {
  it("starts at the project's own folders, with the personal files below", () => {
    render(projectTree({ showOtherFiles: false }));

    expect(
      screen
        .getByRole("treeitem", { name: ".agents" })
        .getAttribute("aria-level")
    ).toBe("1");
    expect(screen.queryByRole("treeitem", { name: "GitHub" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: ".claude" })).toBeTruthy();
    expect(listedFolders).toEqual([]);
  });

  it("lists what else sits in the project, dimmed, beside its agent folders", async () => {
    render(projectTree({ showOtherFiles: true }));

    const readme = await screen.findByRole("treeitem", { name: "README.md" });

    expect(readme.getAttribute("aria-level")).toBe("1");
    expect(readme).toHaveAccessibleDescription(OTHER_FILE);
    expect(
      screen.getByRole("treeitem", { name: "scripts" })
    ).toHaveAccessibleDescription(NO_AGENT_FILES);
    expect(
      screen.getByRole("treeitem", { name: ".agents" })
    ).not.toHaveAccessibleDescription(NO_AGENT_FILES);
  });

  it("reads only the folders that are open", async () => {
    render(projectTree({ showOtherFiles: true }));

    await screen.findByRole("treeitem", { name: "README.md" });

    expect(new Set(listedFolders)).toEqual(new Set([PROJECT]));
  });

  it("says when a folder can't be read, but not when it was deleted since", async () => {
    render(projectTree({ showOtherFiles: true }));

    fireEvent.click(await screen.findByText("scripts"));
    fireEvent.click(screen.getByText("drafts"));
    const failure = await within(
      screen.getByRole("treeitem", { name: "scripts" })
    ).findByRole("treeitem", { name: "Couldn't list this folder" });

    expect(failure).toHaveAccessibleDescription(
      "Operation not permitted (os error 1)"
    );
    expect(
      screen.getAllByRole("treeitem", { name: "Couldn't list this folder" })
    ).toHaveLength(1);
  });

  it("opens a skill reached through a symlinked folder as that link", async () => {
    const onSelectFile = vi.fn();
    render(projectTree({ showOtherFiles: true, onSelectFile }));

    fireEvent.click(await screen.findByText("interface"));
    const linkedFolder = await screen.findByRole("treeitem", {
      name: "ask-sonner",
    });
    expect(linkedFolder).toHaveAccessibleDescription("Symbolic link");
    fireEvent.click(within(linkedFolder).getByText("ask-sonner"));
    const linkedSkill = await within(linkedFolder).findByRole("treeitem", {
      name: "ask-sonner",
    });
    fireEvent.click(within(linkedSkill).getByText("ask-sonner"));

    expect(linkedSkill).toHaveAccessibleDescription(LINK_TO_SKILL);
    expect(onSelectFile).toHaveBeenCalledWith(skill, LINKED_PATH);
  });

  it("lists nothing on disk while a search opens every folder", () => {
    render(projectTree({ showOtherFiles: true, expandAll: true }));

    expect(screen.getByRole("treeitem", { name: "skills" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "README.md" })).toBeNull();
    expect(listedFolders).toEqual([]);
  });
});
