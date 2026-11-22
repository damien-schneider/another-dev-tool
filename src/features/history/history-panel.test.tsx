import "@testing-library/jest-dom/vitest";
import { isDeepStrictEqual } from "node:util";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FileCommit, FileHistory, WorkingState } from "@/lib/ipc-types";

import { HistoryPanel } from "./history-panel";

const HOUR_MS = 3_600_000;
const RENAME_COMMIT = /Move the rules/;
const CREATION_COMMIT = /Add the rules/;

const creation: FileCommit = {
  hash: "b".repeat(40),
  shortHash: "bbbbbbb",
  author: "Ana",
  timeMs: Date.now() - 72 * HOUR_MS,
  subject: "Add the rules",
  path: "CLAUDE.md",
  previousPath: null,
};

const rename: FileCommit = {
  hash: "a".repeat(40),
  shortHash: "aaaaaaa",
  author: "Damien",
  timeMs: Date.now() - 2 * HOUR_MS,
  subject: "Move the rules",
  path: "AGENTS.md",
  previousPath: "CLAUDE.md",
};

const CLEAN: WorkingState = { state: "clean" };

function history(
  commits: FileCommit[],
  working: WorkingState = CLEAN
): FileHistory {
  return { commits, working };
}

function panel(savedHash = "h1") {
  return (
    <HistoryPanel fileId={7} onClose={() => undefined} savedHash={savedHash} />
  );
}

afterEach(() => {
  clearMocks();
});

describe("HistoryPanel", () => {
  it("shows what a commit changed in the file once it is opened", async () => {
    mockIPC((command, args) => {
      if (command === "file_history") {
        return history([rename, creation]);
      }
      if (
        command === "file_commit_change" &&
        isDeepStrictEqual(args, {
          fileId: 7,
          hash: rename.hash,
          path: "AGENTS.md",
          previousPath: "CLAUDE.md",
        })
      ) {
        return { before: "# Rules\n", after: "# Rules\n\nBe brief.\n" };
      }
      throw new Error(`Unexpected ${command}`);
    });
    render(panel());

    const commit = await screen.findByRole("button", { name: RENAME_COMMIT });
    expect(commit).toHaveTextContent("Damien");
    expect(commit).toHaveTextContent("aaaaaaa");
    fireEvent.click(commit);

    expect(await screen.findByRole("figure")).toHaveTextContent(
      "Added line 3: Be brief."
    );
  });

  it("tells a file outside a git repository has no history, without offering a retry", async () => {
    mockIPC(() =>
      Promise.reject({
        code: "not_found",
        message: "This file isn't in a git repository.",
      })
    );
    render(panel());

    expect(
      await screen.findByText("This file isn't in a git repository.")
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows a saved edit as uncommitted changes as soon as it is saved", async () => {
    let working: WorkingState = CLEAN;
    mockIPC((command) => {
      if (command === "file_history") {
        return history([creation], working);
      }
      if (command === "file_working_change") {
        return { before: "# Rules\n", after: "# Rules\n\nBe kind.\n" };
      }
      throw new Error(`Unexpected ${command}`);
    });
    const { rerender } = render(panel("h1"));
    await screen.findByRole("button", { name: CREATION_COMMIT });

    working = { state: "modified" };
    rerender(panel("h2"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Uncommitted changes" })
    );

    expect(await screen.findByRole("figure")).toHaveTextContent(
      "Added line 3: Be kind."
    );
  });

  it("shows a file git does not track yet as not committed", async () => {
    mockIPC((command) =>
      command === "file_history"
        ? history([], { state: "untracked" })
        : { before: "", after: "# Draft\n" }
    );
    render(panel());

    fireEvent.click(
      await screen.findByRole("button", { name: "Not committed yet" })
    );

    expect(await screen.findByRole("figure")).toHaveTextContent(
      "Added line 1: # Draft"
    );
  });

  it("names the rule that keeps an ignored file out of git", async () => {
    mockIPC(() =>
      history([], {
        state: "ignored",
        source: ".gitignore",
        line: 9,
        pattern: "interface/explain-interface/",
      })
    );
    render(panel());

    expect(await screen.findByText("Ignored by git")).toBeVisible();
    expect(
      screen.getByText(
        "Excluded by interface/explain-interface/ in .gitignore, line 9. Git records none of its changes."
      )
    ).toBeVisible();
  });

  it("picks up a commit made while the app was in the background", async () => {
    let calls = 0;
    mockIPC(() => {
      calls += 1;
      return calls === 1 ? history([creation]) : history([rename, creation]);
    });
    render(panel());
    await screen.findByRole("button", { name: CREATION_COMMIT });

    fireEvent.focus(window);

    expect(
      await screen.findByRole("button", { name: RENAME_COMMIT })
    ).toBeVisible();
  });
});
