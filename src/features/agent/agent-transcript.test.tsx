import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentPart } from "@/lib/agent-ipc-types";
import type { AgentMessage } from "./agent-messages";
import { AgentTranscript } from "./agent-transcript";

const read = (state: "running" | "done"): AgentPart => ({
  kind: "tool",
  id: "read",
  name: "Read",
  title: null,
  input: { file_path: "/scratch/SKILL.md" },
  state,
  output: state === "done" ? "# Break" : null,
  durationMs: state === "done" ? 4000 : null,
});

const WORKED = /Worked for 6s/;
const COPY = /Copy/;

const asked: AgentMessage = {
  key: "0",
  role: "you",
  text: "tighten it",
  images: [],
};

const answer = (parts: AgentPart[]): AgentMessage => ({
  key: "1",
  role: "agent",
  parts,
  meta: {
    model: "claude-opus-5-5",
    requestedModel: "opus",
    effort: "high",
    durationMs: 9000,
  },
});

const show = (parts: AgentPart[], running: boolean) =>
  render(
    <AgentTranscript
      error={null}
      messages={[asked, answer(parts)]}
      running={running}
    />
  );

describe("AgentTranscript", () => {
  it("names the step Claude is on while it answers, without actions yet", () => {
    show(
      [{ kind: "thinking", text: "", durationMs: 1000 }, read("running")],
      true
    );

    expect(screen.getByText("Reading SKILL.md")).toBeTruthy();
    expect(
      screen.queryByRole("toolbar", { name: "Answer actions" })
    ).toBeNull();
  });

  it("folds the settled steps above the answer and offers copy with the run's model", () => {
    show(
      [
        { kind: "thinking", text: "Look first.", durationMs: 2000 },
        read("done"),
        { kind: "text", text: "Tightened the description." },
      ],
      false
    );

    expect(screen.getByRole("button", { name: WORKED })).toBeTruthy();
    expect(screen.getByText("Tightened the description.")).toBeTruthy();
    const actions = screen.getByRole("toolbar", { name: "Answer actions" });
    expect(within(actions).getByRole("button", { name: COPY })).toBeTruthy();
    expect(
      within(actions).getByText("Claude Opus 5.5 · High · 9s")
    ).toBeTruthy();
  });
});
