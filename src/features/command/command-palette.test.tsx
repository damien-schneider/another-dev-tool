import "@testing-library/jest-dom/vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./command-palette";

const HOME = "/Users/me";
const MASTRA = `${HOME}/GitHub/mastra`;
const ECHO = `${HOME}/GitHub/echo`;
const ECHO_OPTION = /^echo/;
const MASTRA_OPTION = /^mastra~/;
const MASTRA_CLOUD_OPTION = /^mastra-cloud/;

const projects = [
  { label: "mastra", path: MASTRA },
  { label: "mastra-cloud", path: `${HOME}/GitHub/mastra-cloud` },
  { label: "echo", path: ECHO },
];

function palette({
  project = null,
  onOpenProject = () => undefined,
}: {
  project?: string | null;
  onOpenProject?: (path: string | null) => void;
}) {
  return (
    <CommandPalette
      files={[]}
      onNewSkill={() => undefined}
      onOpenChange={() => undefined}
      onOpenFile={() => undefined}
      onOpenProject={onOpenProject}
      onRescan={() => undefined}
      onSelectView={() => undefined}
      open
      project={project}
      projects={projects}
    />
  );
}

beforeAll(() => {
  mockIPC((command) =>
    command === "plugin:path|resolve_directory" ? HOME : undefined
  );
});

describe("CommandPalette projects", () => {
  it("opens the project whose name matches the search", async () => {
    const onOpenProject = vi.fn();
    render(palette({ project: MASTRA, onOpenProject }));

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "ech" },
    });
    fireEvent.click(await screen.findByRole("option", { name: ECHO_OPTION }));

    expect(onOpenProject).toHaveBeenCalledWith(ECHO);
  });

  it("offers the other projects matching the search, not the one already open", async () => {
    render(palette({ project: MASTRA }));

    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "mastra" },
    });

    expect(
      await screen.findByRole("option", { name: MASTRA_CLOUD_OPTION })
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: MASTRA_OPTION })).toBeNull();
  });

  it("goes back to every project while one is open", async () => {
    const onOpenProject = vi.fn();
    render(palette({ project: MASTRA, onOpenProject }));

    fireEvent.click(
      await screen.findByRole("option", { name: "Show all projects" })
    );

    expect(onOpenProject).toHaveBeenCalledWith(null);
  });
});
