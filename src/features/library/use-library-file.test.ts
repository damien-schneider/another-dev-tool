import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContent, FileRow } from "@/lib/ipc-types";

import { useLibraryFile } from "./use-library-file";

const mocks = vi.hoisted(() => ({ readFile: vi.fn() }));

vi.mock("@/lib/events", () => ({
  onIndexUpdated: () => Promise.resolve(() => undefined),
}));

vi.mock("@/lib/ipc", () => ({
  readFile: mocks.readFile,
  toIpcError: (cause: unknown) => cause,
  writeFile: vi.fn(),
}));

const LINK = "/Users/me/.claude/CLAUDE.md";

const FILE: FileRow = {
  id: 3,
  rootId: 1,
  path: "/Users/me/GitHub/skills/AGENTS.md",
  relPath: "AGENTS.md",
  kind: "agents-md",
  name: null,
  description: null,
  aliases: [LINK],
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

const OTHER: FileRow = {
  ...FILE,
  id: 4,
  path: "/Users/me/GitHub/echo/AGENTS.md",
  aliases: [],
};

const CONTENT: FileContent = {
  fileId: FILE.id,
  path: FILE.path,
  content: "# Rules\n",
  hash: "h3",
  mtimeMs: 1,
  isSymlink: false,
  symlinkTarget: null,
  managedBy: null,
};

describe("useLibraryFile", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.readFile.mockResolvedValue(CONTENT);
  });

  it("keeps unsaved edits editable when the open file is picked through its link", async () => {
    const { result } = renderHook(() => useLibraryFile(() => undefined));
    act(() => result.current.select(FILE));
    await waitFor(() => expect(result.current.editor.buffer).not.toBeNull());
    act(() => result.current.editor.replaceDocument("# Rules, edited\n"));

    act(() => result.current.select(FILE, LINK));

    expect(result.current.openedThroughLink).toBe(LINK);
    expect(result.current.editor.dirty).toBe(true);
    expect(result.current.editor.readOnly).toBe(false);
  });

  it("reports a file switched to past the unsaved-changes prompt, and not one dropped there", async () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useLibraryFile(onOpen));
    act(() => result.current.select(FILE));
    await waitFor(() => expect(result.current.editor.buffer).not.toBeNull());
    act(() => result.current.editor.replaceDocument("# Rules, edited\n"));
    onOpen.mockClear();

    act(() => result.current.select(OTHER));
    act(() => result.current.cancelPending());
    act(() => result.current.select(OTHER));
    act(() => result.current.confirmPending());

    expect(onOpen.mock.calls).toEqual([[OTHER, null]]);
  });
});
