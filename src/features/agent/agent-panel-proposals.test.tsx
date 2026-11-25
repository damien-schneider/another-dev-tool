import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IpcError } from "@/lib/ipc";

import { PROPOSAL, renderPanel, suggested } from "./agent-panel.fixtures";

const mocks = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  writeFile: mocks.writeFile,
}));

const QUALITY = { fileId: 5, path: "/skills/quality/SKILL.md" };

describe("AgentPanel suggestions for other files", () => {
  afterEach(() => vi.clearAllMocks());

  it("names each file, so suggestions for several files read apart", () => {
    renderPanel({
      proposals: [suggested(PROPOSAL), suggested("# Better", QUALITY)],
    });

    expect(
      screen.getByRole("region", {
        name: "Suggested edit to ux-rules/SKILL.md",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Suggested edit to quality/SKILL.md" })
    ).toBeTruthy();
  });

  it("saves a suggestion for a file that is not open straight to disk, then clears it", async () => {
    mocks.writeFile.mockResolvedValue({ hash: "new" });
    const { session, onApply } = renderPanel({
      proposals: [suggested("# Better", QUALITY)],
    });

    fireEvent.click(screen.getByRole("button", { name: "Save to file" }));

    await waitFor(() =>
      expect(session.dismissProposal).toHaveBeenCalledWith(QUALITY.fileId)
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      QUALITY.fileId,
      "# Better",
      "h"
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the suggestion and says why when the file changed since it was read", async () => {
    mocks.writeFile.mockRejectedValue(
      new IpcError({ code: "conflict", message: "SKILL.md changed on disk" })
    );
    const { session } = renderPanel({
      proposals: [suggested("# Better", QUALITY)],
    });

    fireEvent.click(screen.getByRole("button", { name: "Save to file" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "changed since"
    );
    expect(session.dismissProposal).not.toHaveBeenCalled();
  });
});
