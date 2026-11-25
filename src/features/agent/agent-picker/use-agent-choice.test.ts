import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PREPARED } from "../agent-panel.fixtures";
import { AGENT_KEY, pickKey, useAgentChoice } from "./use-agent-choice";

const ipc = vi.hoisted(() => ({
  agentCatalog: vi.fn(),
  agentPrepare: vi.fn(),
  agentSignIn: vi.fn(),
  toIpcError: (cause: unknown) =>
    cause instanceof Error ? cause : new Error(String(cause)),
}));

vi.mock("@/lib/ipc", () => ipc);

beforeEach(() => {
  window.localStorage.clear();
  ipc.agentCatalog.mockReset().mockResolvedValue([]);
  ipc.agentPrepare.mockReset().mockResolvedValue(PREPARED);
  ipc.agentSignIn.mockReset();
});

const ready = (pinned: string | null = null) => {
  const view = renderHook(({ agent }) => useAgentChoice(agent), {
    initialProps: { agent: pinned },
  });
  return waitFor(() => {
    expect(view.result.current.preparing.state).toBe("ready");
    return view;
  });
};

describe("useAgentChoice", () => {
  it("runs with the picks stored for the agent that it still offers, else its defaults", async () => {
    window.localStorage.setItem(pickKey("claude-acp", "model"), "sonnet");
    window.localStorage.setItem(pickKey("claude-acp", "effort"), "ludicrous");
    window.localStorage.setItem(pickKey("codex-acp", "effort"), "low");

    const { result } = await ready();

    expect(result.current.model).toBe("sonnet");
    expect(result.current.effort).toBe("high");
    expect(result.current.config).toEqual([{ id: "model", value: "sonnet" }]);
  });

  it("keeps a new pick for the next time the agent is used", async () => {
    const first = await ready();

    act(() => first.result.current.pick("effort", "low"));
    expect(first.result.current.config).toEqual([
      { id: "effort", value: "low" },
    ]);
    first.unmount();

    const again = await ready();
    expect(again.result.current.effort).toBe("low");
  });

  it("answers with the conversation's agent over the one last chosen", async () => {
    window.localStorage.setItem(AGENT_KEY, "gemini");

    const { result } = await ready("codex-acp");

    expect(result.current.agentId).toBe("codex-acp");
    expect(ipc.agentPrepare).toHaveBeenCalledWith("codex-acp");
    expect(ipc.agentPrepare).not.toHaveBeenCalledWith("gemini");
  });

  it("starts the agent again on refresh, reporting why it failed", async () => {
    const view = await ready();
    ipc.agentPrepare.mockRejectedValue(new Error("npx not found"));

    act(() => view.result.current.refresh());

    expect(view.result.current.preparing.state).toBe("starting");
    await waitFor(() =>
      expect(view.result.current.preparing).toEqual({
        state: "failed",
        message: "npx not found",
      })
    );
    expect(ipc.agentPrepare).toHaveBeenCalledTimes(2);
  });
});
