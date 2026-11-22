import "@testing-library/jest-dom/vitest";
import { SidebarProvider } from "@ctrl-ui/react/ui/sidebar";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { UseScan } from "@/features/scan/use-scan";
import type { FileRow, Root } from "@/lib/ipc-types";

import { LibraryPanel } from "./library-panel";

const HOME = "/Users/me";
const MASTRA = `${HOME}/GitHub/mastra`;
const ECHO = `${HOME}/GitHub/echo`;
const ECHO_OPTION = /^echo/;
const ALL_PROJECTS_OPTION = /^All projects/;

const roots: Root[] = [
  { id: 1, path: `${HOME}/GitHub`, enabled: true, addedAt: 0 },
  { id: 2, path: `${HOME}/.claude`, enabled: true, addedAt: 0 },
];

function file(
  id: number,
  path: string,
  overrides: Partial<FileRow> = {}
): FileRow {
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

const files = [
  file(1, `${HOME}/.claude/CLAUDE.md`),
  file(2, `${MASTRA}/.claude/skills/release/SKILL.md`, {
    kind: "skill",
    projectDir: MASTRA,
  }),
  file(3, `${MASTRA}/.claude/skills/triage/SKILL.md`, {
    kind: "skill",
    projectDir: MASTRA,
  }),
  file(4, `${ECHO}/AGENTS.md`, { projectDir: ECHO }),
];

const scan: UseScan = {
  running: false,
  stats: null,
  lastResult: null,
  error: null,
  start: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
};

function panel({
  project = null,
  onOpenProject = () => undefined,
  onToggleFavorite = () => Promise.resolve(),
}: {
  project?: string | null;
  onOpenProject?: (path: string | null) => void;
  onToggleFavorite?: (path: string) => Promise<void>;
}) {
  return (
    <SidebarProvider>
      <LibraryPanel
        favoritePaths={new Set()}
        index={{
          files,
          roots,
          ready: true,
          error: null,
          refresh: () => Promise.resolve(),
        }}
        onNewSkill={() => undefined}
        onOpenProject={onOpenProject}
        onOpenSettings={() => undefined}
        onSelectFile={() => undefined}
        onToggleFavorite={onToggleFavorite}
        project={project}
        scan={scan}
        selectedAlias={null}
        selectedFileId={null}
      />
    </SidebarProvider>
  );
}

beforeAll(() => {
  window.localStorage.clear();
  mockIPC((command) =>
    command === "plugin:path|resolve_directory" ? HOME : undefined
  );
});

describe("LibraryPanel with a project open", () => {
  it("lists that project's folders first, then the personal files, and no other project", async () => {
    render(panel({ project: MASTRA }));

    const skills = await screen.findByRole("treeitem", {
      name: ".claude/skills",
    });

    expect(skills.getAttribute("aria-level")).toBe("1");
    expect(screen.getByRole("treeitem", { name: "Claude Code" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "mastra" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "echo" })).toBeNull();
    expect(screen.getByText("3 files")).toBeTruthy();
  });

  it("switches to another project from the project menu", async () => {
    const onOpenProject = vi.fn();
    render(panel({ project: MASTRA, onOpenProject }));

    fireEvent.click(screen.getByRole("button", { name: "Project: mastra" }));
    fireEvent.click(await screen.findByRole("option", { name: ECHO_OPTION }));

    expect(onOpenProject).toHaveBeenCalledWith(ECHO);
  });

  it("goes back to every project from the project menu", async () => {
    const onOpenProject = vi.fn();
    render(panel({ project: MASTRA, onOpenProject }));

    fireEvent.click(screen.getByRole("button", { name: "Project: mastra" }));
    fireEvent.click(
      await screen.findByRole("option", { name: ALL_PROJECTS_OPTION })
    );

    expect(onOpenProject).toHaveBeenCalledWith(null);
  });

  it("stars the highlighted project from the keyboard", async () => {
    const onToggleFavorite = vi.fn(() => Promise.resolve());
    render(panel({ project: MASTRA, onToggleFavorite }));

    fireEvent.click(screen.getByRole("button", { name: "Project: mastra" }));
    const search = await screen.findByPlaceholderText("Search projects");
    fireEvent.change(search, { target: { value: "echo" } });
    const row = await screen.findByRole("option", { name: ECHO_OPTION });
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(search, { key: "d", metaKey: true });

    expect(onToggleFavorite).toHaveBeenCalledWith(ECHO);
  });
});
