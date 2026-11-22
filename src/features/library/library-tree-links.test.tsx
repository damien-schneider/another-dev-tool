import { mockIPC } from "@tauri-apps/api/mocks";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { FileRow, Root } from "@/lib/ipc-types";

import { LibraryTree } from "./library-tree";

const HOME = "/Users/me";
const LINK_MARK = /link/i;
const ALIAS = `${HOME}/.claude/skills/humanizer/SKILL.md`;

const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
];

const original: FileRow = {
  id: 3,
  rootId: 1,
  path: `${HOME}/GitHub/skills/humanizer/SKILL.md`,
  relPath: "skills/humanizer/SKILL.md",
  kind: "skill",
  name: "humanizer",
  description: null,
  aliases: [ALIAS],
  projectDir: null,
  repositoryDir: null,
  size: 1,
  mtimeNs: 1,
  hash: "h3",
  isSymlink: false,
  symlinkTarget: null,
  firstSeenAt: 0,
  lastSeenScanId: 1,
  deletedAt: null,
};

function tree({
  selectedFileId = null,
  selectedAlias = null,
  showAliases = true,
  onSelectFile = () => undefined,
}: {
  selectedFileId?: number | null;
  selectedAlias?: string | null;
  showAliases?: boolean;
  onSelectFile?: (file: FileRow, alias: string | null) => void;
}) {
  return (
    <LibraryTree
      expandAll
      favoritePaths={new Set()}
      files={[original]}
      indexedFiles={[original]}
      mode="grouped"
      onSelectFile={onSelectFile}
      onToggleFavorite={() => Promise.resolve()}
      project={null}
      roots={roots}
      selectedAlias={selectedAlias}
      selectedFileId={selectedFileId}
      showAliases={showAliases}
    />
  );
}

async function rows() {
  const named = await waitFor(() => {
    const found = screen.getAllByRole("treeitem", { name: "humanizer" });
    expect(found).toHaveLength(2);
    return found;
  });
  const isLink = (row: HTMLElement) =>
    within(row).queryByText(LINK_MARK) !== null;
  return {
    link: named.find(isLink) ?? document.body,
    original: named.find((row) => !isLink(row)) ?? document.body,
  };
}

beforeAll(() => {
  mockIPC((command) =>
    command === "plugin:path|resolve_directory" ? HOME : undefined
  );
});

describe("LibraryTree links", () => {
  it("tells which link a file was picked through, and none for its original row", async () => {
    const onSelectFile = vi.fn();
    render(tree({ onSelectFile }));
    const { link, original: originalRow } = await rows();

    fireEvent.click(within(link).getByText("humanizer"));
    fireEvent.click(within(originalRow).getByText("humanizer"));

    expect(onSelectFile.mock.calls).toEqual([
      [original, ALIAS],
      [original, null],
    ]);
  });

  it("highlights the link row the open file came through", async () => {
    render(tree({ selectedFileId: original.id, selectedAlias: ALIAS }));
    const { link, original: originalRow } = await rows();

    expect(link.getAttribute("aria-selected")).toBe("true");
    expect(originalRow.getAttribute("aria-selected")).toBe("false");
  });

  it("falls back to the original row once links are hidden", async () => {
    const { rerender } = render(
      tree({ selectedFileId: original.id, selectedAlias: ALIAS })
    );
    await rows();

    rerender(
      tree({
        selectedFileId: original.id,
        selectedAlias: ALIAS,
        showAliases: false,
      })
    );

    expect(
      screen
        .getByRole("treeitem", { name: "humanizer" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });
});
