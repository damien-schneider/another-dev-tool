import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileRow } from "@/lib/ipc-types";

import { NewSkillDialog } from "./new-skill-dialog";

const mocks = vi.hoisted(() => ({
  installFiles: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: () => Promise.resolve("/Users/me"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/ipc", () => ({
  installFiles: mocks.installFiles,
  toIpcError: (cause: unknown) => cause,
}));

const caveman: FileRow = {
  id: 1,
  rootId: 1,
  path: "/Users/me/.claude/skills/caveman/SKILL.md",
  relPath: "skills/caveman/SKILL.md",
  kind: "skill",
  name: "caveman",
  description: null,
  aliases: [],
  projectDir: null,
  repositoryDir: null,
  size: 1,
  mtimeNs: 1,
  hash: "h",
  isSymlink: false,
  symlinkTarget: null,
  firstSeenAt: 0,
  lastSeenScanId: 1,
  deletedAt: null,
};

describe("NewSkillDialog", () => {
  it("creates a drafted skill with the drafted body instead of a stub", async () => {
    mocks.installFiles.mockResolvedValue({ fileIds: [7] });
    const onCreated = vi.fn();
    render(
      <NewSkillDialog
        draft={{
          name: "pr-link",
          description: "Share the PR link when done.",
          body: "# PR link\n\nAlways end with the PR URL.\n",
        }}
        files={[caveman]}
        onCreated={onCreated}
        onOpenChange={vi.fn()}
        open
        project={null}
        roots={[]}
        selectedFile={caveman}
      />
    );

    expect(screen.getByLabelText("Name")).toHaveValue("pr-link");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Share the PR link when done."
    );
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(7));
    expect(mocks.installFiles).toHaveBeenCalledWith(
      [
        {
          path: "/Users/me/.claude/skills/pr-link/SKILL.md",
          content:
            "---\nname: pr-link\ndescription: Share the PR link when done.\n---\n\n# PR link\n\nAlways end with the PR URL.\n",
        },
      ],
      false
    );
  });

  it.each([
    {
      when: "starts in the agent skills folder the open project already uses, not a busier nested one",
      project: "/Users/me/GitHub/app",
      created: "/Users/me/GitHub/app/.agents/skills/lint/SKILL.md",
    },
    {
      when: "starts in .claude/skills of an open project without skills",
      project: "/Users/me/GitHub/blank",
      created: "/Users/me/GitHub/blank/.claude/skills/lint/SKILL.md",
    },
  ])("$when", async ({ project, created }) => {
    mocks.installFiles.mockResolvedValue({ fileIds: [8] });
    const app = "/Users/me/GitHub/app";
    const appSkills = [
      ".agents/skills/deploy",
      "packages/kit/skills/a",
      "packages/kit/skills/b",
    ].map(
      (folder, index): FileRow => ({
        ...caveman,
        id: index + 2,
        path: `${app}/${folder}/SKILL.md`,
        relPath: `app/${folder}/SKILL.md`,
        projectDir: app,
      })
    );
    const onCreated = vi.fn();
    render(
      <NewSkillDialog
        files={[caveman, ...appSkills]}
        onCreated={onCreated}
        onOpenChange={vi.fn()}
        open
        project={project}
        roots={[]}
        selectedFile={null}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "lint" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Run the linter before pushing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(8));
    expect(mocks.installFiles).toHaveBeenLastCalledWith(
      [expect.objectContaining({ path: created })],
      false
    );
  });
});
