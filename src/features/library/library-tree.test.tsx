import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { readReference } from "@/features/agent/agent-references";
import type { FileRow, Root } from "@/lib/ipc-types";

import { LibraryTree, type LibraryTreeMode } from "./library-tree";

const LINK_MARK = /link/i;
const CHAT_REFERENCE = /to the chat$/;

const roots: Root[] = [
  { id: 1, path: "/Users/me/GitHub", enabled: true, addedAt: 0 },
  { id: 2, path: "/Users/me/.claude", enabled: true, addedAt: 0 },
];

function file(id: number, rootId: number, relPath: string): FileRow {
  const root = roots.find((candidate) => candidate.id === rootId);
  return {
    id,
    rootId,
    path: `${root?.path}/${relPath}`,
    relPath,
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
  };
}

const files = [
  file(1, 1, "app/packages/api/AGENTS.md"),
  file(2, 2, "agents/AGENTS.md"),
];

function folderTree(selectedFileId: number | null) {
  return (
    <LibraryTree
      expandAll={false}
      favoritePaths={new Set()}
      files={files}
      indexedFiles={files}
      mode="folders"
      onSelectFile={() => undefined}
      onToggleFavorite={() => Promise.resolve()}
      project={null}
      roots={roots}
      selectedAlias={null}
      selectedFileId={selectedFileId}
      showAliases
      showOtherFiles={false}
    />
  );
}

describe("LibraryTree arranged by folder", () => {
  it("opens as the list of roots, not every row at once", () => {
    render(folderTree(null));

    expect(screen.getByRole("treeitem", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: ".claude" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "app" })).toBeNull();
  });

  it("opens the folders above a file selected from elsewhere", async () => {
    render(folderTree(1));

    expect(
      await screen.findByRole("treeitem", { name: "AGENTS.md" })
    ).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "agents" })).toBeNull();
  });
});

describe("LibraryTree grouped by project", () => {
  it("stars a project from its row without opening it", async () => {
    const onToggleFavorite = vi.fn(() => Promise.resolve());
    render(
      <LibraryTree
        expandAll={false}
        favoritePaths={new Set()}
        files={files}
        indexedFiles={files}
        mode="grouped"
        onSelectFile={() => undefined}
        onToggleFavorite={onToggleFavorite}
        project={null}
        roots={roots}
        selectedAlias={null}
        selectedFileId={null}
        showAliases
        showOtherFiles={false}
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Add GitHub to favorites" })
    );

    expect(onToggleFavorite).toHaveBeenCalledWith("/Users/me/GitHub");
    expect(
      screen
        .getByRole("treeitem", { name: "GitHub" })
        .getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("shows the file that symlinks reach without a link mark", async () => {
    const original: FileRow = {
      ...file(3, 1, "skills/code/humanizer/SKILL.md"),
      kind: "skill",
      name: "humanizer",
      aliases: ["/Users/me/.claude/skills/humanizer/SKILL.md"],
    };
    render(
      <LibraryTree
        expandAll
        favoritePaths={new Set()}
        files={[original]}
        indexedFiles={[original]}
        mode="grouped"
        onSelectFile={() => undefined}
        onToggleFavorite={() => Promise.resolve()}
        project={null}
        roots={roots}
        selectedAlias={null}
        selectedFileId={null}
        showAliases
        showOtherFiles={false}
      />
    );

    const row = await screen.findByRole("treeitem", { name: "humanizer" });

    expect(within(row).queryByText(LINK_MARK)).toBeNull();
  });
});

describe("LibraryTree rows as chat references", () => {
  const skill: FileRow = {
    ...file(3, 1, "skills/code/humanizer/SKILL.md"),
    kind: "skill",
    name: "humanizer",
  };

  function tree({
    mode = "folders",
    onReference,
    onSelectFile = () => undefined,
  }: {
    mode?: LibraryTreeMode;
    onReference?: () => void;
    onSelectFile?: () => void;
  } = {}) {
    return (
      <LibraryTree
        expandAll
        favoritePaths={new Set()}
        files={[skill]}
        indexedFiles={[skill]}
        mode={mode}
        onReference={onReference}
        onSelectFile={onSelectFile}
        onToggleFavorite={() => Promise.resolve()}
        project={null}
        roots={roots}
        selectedAlias={null}
        selectedFileId={null}
        showAliases
        showOtherFiles={false}
      />
    );
  }

  it("hands the chat a skill's whole folder, without opening it", async () => {
    const onReference = vi.fn();
    const onSelectFile = vi.fn();
    render(tree({ mode: "grouped", onReference, onSelectFile }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Add humanizer to the chat" })
    );

    expect(onReference).toHaveBeenCalledWith({
      path: "/Users/me/GitHub/skills/code/humanizer",
      label: "humanizer",
      kind: "skill",
    });
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("drags a folder as a reference to its real path", async () => {
    render(tree({ onReference: vi.fn() }));
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };

    fireEvent.dragStart(await screen.findByText("code"), { dataTransfer });

    expect(readReference(dataTransfer)).toEqual({
      path: "/Users/me/GitHub/skills/code",
      label: "code",
      kind: "folder",
    });
  });

  it("offers no reference while no chat can take one", async () => {
    render(tree());

    expect(await screen.findByText("code")).toBeTruthy();
    expect(screen.queryByRole("button", { name: CHAT_REFERENCE })).toBeNull();
  });
});
