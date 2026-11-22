import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileRow } from "@/lib/ipc-types";
import type {
  Pattern,
  PatternsProgress,
  PatternsState,
} from "@/lib/patterns-ipc-types";

import { PatternsView } from "./patterns-view";

const mocks = vi.hoisted(() => ({
  homeDir: vi.fn(),
  writeText: vi.fn(),
  patternsState: vi.fn(),
  patternsAnalyze: vi.fn(),
  patternsCancel: vi.fn(),
  patternsDismiss: vi.fn(),
  progress: [] as ((payload: PatternsProgress) => void)[],
  done: [] as ((payload: { cancelled: boolean }) => void)[],
}));

vi.mock("@tauri-apps/api/path", () => ({ homeDir: mocks.homeDir }));
vi.mock("@/lib/events", () => ({
  onPatternsProgress: (handler: (payload: PatternsProgress) => void) => {
    mocks.progress.push(handler);
    return Promise.resolve(() => undefined);
  },
  onPatternsDone: (handler: (payload: { cancelled: boolean }) => void) => {
    mocks.done.push(handler);
    return Promise.resolve(() => undefined);
  },
  onPatternsError: () => Promise.resolve(() => undefined),
}));
vi.mock("@/lib/ipc", () => ({
  patternsState: mocks.patternsState,
  patternsAnalyze: mocks.patternsAnalyze,
  patternsCancel: mocks.patternsCancel,
  patternsDismiss: mocks.patternsDismiss,
  toIpcError: (cause: unknown) => cause,
}));

const AGENTS_MD = "/Users/me/.claude/AGENTS.md";

function pattern(id: number, overrides: Partial<Pattern> = {}): Pattern {
  return {
    id,
    kind: "rule",
    title: "Run one test file at a time",
    statement: "Never run the whole test suite at once.",
    scope: "global",
    target: AGENTS_MD,
    change: "- Run only the tests you touched.",
    why: "The machine freezes under a full run.",
    evidence: [
      "my computer freezes, run one file",
      "don't run all the tests at once",
      "only the touched tests please",
      "again: not the whole suite",
    ].map((text, index) => ({
      agent: index % 2 === 0 ? "claude-code" : "codex",
      project: "/Users/me/Github/another-dev-tool",
      at: Date.UTC(2026, 10, 2 + index),
      text,
    })),
    sessions: 6,
    days: 4,
    foundAt: Date.UTC(2026, 10, 20),
    ...overrides,
  };
}

const agentsFile: FileRow = {
  id: 9,
  rootId: 1,
  path: AGENTS_MD,
  relPath: "AGENTS.md",
  kind: "agents-md",
  name: "AGENTS",
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

function loaded(
  patterns: Pattern[],
  unreadable: NonNullable<PatternsState["lastRun"]>["unreadable"] = []
): PatternsState {
  return {
    patterns,
    lastRun: {
      finishedAt: Date.UTC(2026, 10, 20),
      prompts: 1240,
      sessions: 86,
      firstAt: Date.UTC(2026, 9, 2),
      lastAt: Date.UTC(2026, 10, 20),
      agents: [
        { agent: "claude-code", prompts: 800 },
        { agent: "codex", prompts: 440 },
      ],
      costUsd: 1.2,
      unreadable,
    },
    running: null,
  };
}

function renderView(files: FileRow[] = [agentsFile]) {
  const onOpenInEditor = vi.fn();
  const onCreateSkill = vi.fn();
  render(
    <PatternsView
      files={files}
      onCreateSkill={onCreateSkill}
      onOpenInEditor={onOpenInEditor}
    />
  );
  return { onOpenInEditor, onCreateSkill };
}

describe("PatternsView", () => {
  beforeEach(() => {
    mocks.progress = [];
    mocks.done = [];
    mocks.homeDir.mockReset().mockResolvedValue("/Users/me");
    mocks.writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    mocks.patternsState.mockReset().mockResolvedValue({
      patterns: [],
      lastRun: null,
      running: null,
    });
    mocks.patternsAnalyze.mockReset().mockResolvedValue(null);
    mocks.patternsCancel.mockReset().mockResolvedValue(null);
    mocks.patternsDismiss.mockReset().mockResolvedValue(null);
  });

  it("offers a first analysis and shows it started", async () => {
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));

    expect(mocks.patternsAnalyze).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reading your conversations…"
    );
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  });

  it("picks up a run already going and follows it to the end", async () => {
    mocks.patternsState.mockResolvedValueOnce({
      patterns: [],
      lastRun: null,
      running: { stage: "reading", prompts: 0, sessions: 0 },
    });
    mocks.patternsState.mockResolvedValueOnce(loaded([pattern(1)]));
    renderView();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reading your conversations…"
    );
    act(() => {
      for (const handler of mocks.progress) {
        handler({ stage: "analyzing", prompts: 1240, sessions: 86 });
      }
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Analyzing 1,240 prompts from 86 sessions…"
    );

    act(() => {
      for (const handler of mocks.done) {
        handler({ cancelled: false });
      }
    });
    expect(
      await screen.findByRole("article", {
        name: "Run one test file at a time",
      })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Analyze again" })).toBeVisible();
  });

  it("tells the user Claude Code is missing instead of starting", async () => {
    mocks.patternsAnalyze.mockRejectedValue({
      code: "agent_missing",
      message: "claude not found",
    });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Analyze" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Claude Code isn’t installed"
      )
    );
  });
  it("names an agent history that could not be read", async () => {
    mocks.patternsState.mockResolvedValue(
      loaded([], [{ agent: "mastra-code", reason: "file is not a database" }])
    );
    renderView();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn’t read Mastra Code: file is not a database"
    );
  });

  it("shows what the user said apart from the suggested change", async () => {
    mocks.patternsState.mockResolvedValue(loaded([pattern(1)]));
    renderView();

    const card = await screen.findByRole("article", {
      name: "Run one test file at a time",
    });
    expect(within(card).getByText("Rule")).toBeVisible();
    const said = within(card).getByRole("region", {
      name: "You said this in 6 sessions over 4 days",
    });
    expect(within(said).getAllByRole("article", { name: "You" })).toHaveLength(
      3
    );
    expect(
      within(said).getByText("my computer freezes, run one file")
    ).toBeVisible();
    expect(
      await within(card).findByText("Add to ~/.claude/AGENTS.md")
    ).toBeVisible();

    fireEvent.click(within(card).getByRole("button", { name: "Show all 4" }));

    expect(within(said).getAllByRole("article", { name: "You" })).toHaveLength(
      4
    );
  });

  it("opens the target file with the change ready to send", async () => {
    mocks.patternsState.mockResolvedValue(loaded([pattern(1)]));
    const { onOpenInEditor } = renderView();

    fireEvent.click(
      await screen.findByRole("button", { name: "Open in editor" })
    );

    expect(onOpenInEditor).toHaveBeenCalledWith(
      agentsFile,
      expect.stringContaining(
        "- Run only the tests you touched.\n\nWhy: Never run the whole test suite at once."
      )
    );
  });

  it("drafts a new skill from the proposed SKILL.md", async () => {
    mocks.patternsState.mockResolvedValue(
      loaded([
        pattern(1, {
          kind: "skill",
          target: null,
          change:
            "---\nname: pr-link\ndescription: Share the PR link when done.\n---\n\n# PR link\n\nAlways end with the PR URL.\n",
        }),
      ])
    );
    const { onCreateSkill } = renderView();

    fireEvent.click(
      await screen.findByRole("button", { name: "Create skill" })
    );

    expect(onCreateSkill).toHaveBeenCalledWith({
      name: "pr-link",
      description: "Share the PR link when done.",
      body: "# PR link\n\nAlways end with the PR URL.\n",
    });
  });

  it("offers only a copy when the target is not in the library", async () => {
    mocks.patternsState.mockResolvedValue(loaded([pattern(1)]));
    renderView([]);

    fireEvent.click(await screen.findByRole("button", { name: "Copy change" }));

    expect(screen.queryByRole("button", { name: "Open in editor" })).toBeNull();
    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(
        "- Run only the tests you touched."
      )
    );
  });

  it("drops a dismissed pattern and remembers it", async () => {
    mocks.patternsState.mockResolvedValue(
      loaded([pattern(1), pattern(2, { title: "Share the PR link" })])
    );
    renderView();

    const card = await screen.findByRole("article", {
      name: "Run one test file at a time",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(card).not.toBeInTheDocument());
    expect(mocks.patternsDismiss).toHaveBeenCalledWith(1);
    expect(
      screen.getByRole("heading", { name: "Share the PR link" })
    ).toHaveFocus();
  });
});
