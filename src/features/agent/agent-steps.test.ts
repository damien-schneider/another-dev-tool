import { describe, expect, it } from "vitest";

import type { AgentPart } from "@/lib/agent-ipc-types";

import {
  type AgentStep,
  answerText,
  formatDuration,
  groupTitle,
  metaLabel,
  segments,
  stepLabel,
} from "./agent-steps";

const thinking = (durationMs: number | null): AgentStep => ({
  kind: "thinking",
  text: "Let me look.",
  durationMs,
});

const tool = (
  name: string,
  input: unknown,
  state: "running" | "done" | "error" = "done",
  durationMs: number | null = 1000,
  title: string | null = null
): AgentStep => ({
  kind: "tool",
  id: name,
  name,
  title,
  input,
  state,
  output: null,
  durationMs,
});

const text = (value: string): AgentPart => ({ kind: "text", text: value });

describe("agent steps", () => {
  it("names what Claude is doing while it does it, then what it did", () => {
    const read = { file_path: "/tmp/session/scratch/SKILL.md" };
    expect(stepLabel(tool("Read", read, "running"))).toBe("Reading SKILL.md");
    expect(stepLabel(tool("Read", read))).toBe("Read SKILL.md");
    expect(stepLabel(tool("Edit", read))).toBe("Edited SKILL.md");
    expect(stepLabel(tool("Grep", { pattern: "when to use" }, "running"))).toBe(
      "Searching for “when to use”"
    );
    expect(stepLabel(tool("Glob", { pattern: "**/*.md" }))).toBe(
      "Found **/*.md"
    );
    expect(stepLabel(tool("Read", null, "running"))).toBe("Reading");
    expect(stepLabel(tool("mcp__notes", {}))).toBe("Used mcp__notes");
    expect(stepLabel(thinking(null))).toBe("Thinking");
    expect(stepLabel(thinking(3400))).toBe("Thought for 3s");
  });

  it("names a loaded playbook without its plugin, and a shell command by its first line", () => {
    expect(
      stepLabel(tool("Skill", { skill: "explainer:history" }, "running"))
    ).toBe("Loading playbook history");
    expect(stepLabel(tool("Bash", { command: "git log --oneline -5" }))).toBe(
      "Ran git log --oneline -5"
    );
    expect(
      stepLabel(
        tool("Bash", {
          command: `git log --since="3 months ago" --format="%ad %an" --date=short --name-only\n| sort`,
        })
      )
    ).toBe('Ran git log --since="3 months ago" --format="%ad %an" --date=sho…');
  });

  it("names another agent's step by the title it gives, or by its kind", () => {
    expect(
      stepLabel(tool("execute", {}, "running", null, "List files\nls -la"))
    ).toBe("List files");
    expect(stepLabel(tool("execute", {}, "running", null, "  "))).toBe(
      "Using execute"
    );
  });

  it("folds the steps between two pieces of text into one group", () => {
    const parts = [
      thinking(2000),
      tool("Read", {}),
      text("Here it is."),
      text(""),
      tool("Edit", {}),
      text("Done."),
    ];

    expect(
      segments(parts).map((segment) =>
        segment.kind === "steps" ? segment.steps.length : segment.text
      )
    ).toEqual([2, "Here it is.", 1, "Done."]);
    expect(answerText(parts)).toBe("Here it is.\n\nDone.");
  });

  it("titles a settled group by its one step, or by the work it adds up to", () => {
    expect(groupTitle([tool("Read", { file_path: "a.md" })])).toBe("Read a.md");
    expect(groupTitle([thinking(2000), tool("Read", {}, "done", 10_000)])).toBe(
      "Worked for 12s"
    );
    expect(groupTitle([thinking(null), tool("Read", {}, "done", null)])).toBe(
      "2 steps"
    );
  });

  it("reads the run's model, thinking level and time as one line", () => {
    expect(
      metaLabel({
        model: "claude-opus-5-5",
        requestedModel: "opus",
        effort: "xhigh",
        durationMs: 64_000,
      })
    ).toBe("Claude Opus 5.5 · Extra high · 1m 4s");
    expect(
      metaLabel({
        model: null,
        requestedModel: "sonnet",
        effort: "high",
        durationMs: null,
      })
    ).toBe("Sonnet · High");
    expect(
      metaLabel({
        model: null,
        requestedModel: "GPT-5.5",
        effort: "Medium",
        durationMs: 2000,
      })
    ).toBe("GPT-5.5 · Medium · 2s");
    expect(
      metaLabel({
        model: null,
        requestedModel: "Gemini CLI",
        effort: null,
        durationMs: null,
      })
    ).toBe("Gemini CLI");
    expect(formatDuration(400)).toBe("<1s");
  });
});
