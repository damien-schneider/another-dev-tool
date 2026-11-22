import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FileContent, ManagedBy } from "@/lib/ipc-types";

import { useFileLock } from "./use-file-lock";

function fileContent(fileId: number, managedBy: ManagedBy | null): FileContent {
  return {
    fileId,
    path: `/skills/${fileId}/SKILL.md`,
    content: "# Skill\n",
    hash: `hash-${fileId}`,
    mtimeMs: 1,
    isSymlink: false,
    symlinkTarget: null,
    managedBy,
  };
}

const INSTALLED = fileContent(7, {
  tool: "npxSkills",
  source: "emilkowalski/skills",
});
const OWN = fileContent(8, null);
const LINK = "/Users/me/.claude/CLAUDE.md";

describe("useFileLock", () => {
  it("keeps a file a tool manages read-only until the user edits it anyway", () => {
    const { result } = renderHook(() => useFileLock(INSTALLED, null));
    expect(result.current.readOnly).toBe(true);

    act(() => result.current.editAnyway());
    expect(result.current.readOnly).toBe(false);
  });

  it("asks again for each managed file, but not twice for the same one", () => {
    const other = fileContent(9, { tool: "codex" });
    const { result, rerender } = renderHook(
      ({ content }) => useFileLock(content, null),
      { initialProps: { content: INSTALLED } }
    );
    act(() => result.current.editAnyway());

    rerender({ content: other });
    expect(result.current.readOnly).toBe(true);

    rerender({ content: INSTALLED });
    expect(result.current.readOnly).toBe(false);
  });

  it("leaves a file no tool manages editable", () => {
    const { result } = renderHook(() => useFileLock(OWN, null));

    expect(result.current.readOnly).toBe(false);
  });

  it("keeps a file opened through a link read-only until the user edits it anyway", () => {
    const { result } = renderHook(() => useFileLock(OWN, LINK));
    expect(result.current.readOnly).toBe(true);

    act(() => result.current.editAnyway());
    expect(result.current.readOnly).toBe(false);
  });

  it("frees a file opened through a link once it is shown at its own path", () => {
    const opened: { link: string | null } = { link: LINK };
    const { result, rerender } = renderHook(
      ({ link }) => useFileLock(OWN, link),
      { initialProps: opened }
    );

    rerender({ link: null });

    expect(result.current.readOnly).toBe(false);
  });
});
