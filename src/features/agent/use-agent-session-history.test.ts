import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSession } from "./use-agent-session";
import {
  emitDelta,
  emitDone,
  emitError,
  emitPart,
  mocks,
  resetMocks,
  TEXT,
  texts,
} from "./use-agent-session.harness";

vi.mock(
  "@/lib/events",
  async () => (await import("./use-agent-session.harness")).eventsModule
);
vi.mock(
  "@/lib/ipc",
  async () => (await import("./use-agent-session.harness")).ipcModule
);

beforeEach(resetMocks);

function open(fileId: number | null = 1) {
  return renderHook(({ file }) => useAgentSession(file), {
    initialProps: { file: fileId },
  });
}

async function ask(
  view: ReturnType<typeof open>,
  prompt = "tighten it",
  document = "# Before"
) {
  await act(async () => {
    await view.result.current.send(
      { prompt, images: [], selection: null },
      document
    );
  });
}

describe("useAgentSession conversations", () => {
  it("reopens the most recent conversation, whichever file it began on", async () => {
    mocks.agentConversations.mockResolvedValue([
      { id: "latest", title: "tighten it", updatedAt: 2 },
      { id: "earlier", title: "add a title", updatedAt: 1 },
    ]);

    const view = open();

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "tighten it",
        "Tightened.",
      ])
    );
    expect(mocks.agentConversations).toHaveBeenCalledWith();
    expect(view.result.current.conversationId).toBe("latest");
    expect(view.result.current.conversations).toHaveLength(2);
  });

  it("stays in the conversation when another file opens, and asks about that file", async () => {
    mocks.agentConversations.mockResolvedValue([
      { id: "latest", title: "tighten it", updatedAt: 2 },
    ]);
    const view = open();
    await waitFor(() =>
      expect(view.result.current.conversationId).toBe("latest")
    );

    view.rerender({ file: 2 });

    expect(view.result.current.conversationId).toBe("latest");
    expect(texts(view.result.current.messages)).toEqual([
      "tighten it",
      "Tightened.",
    ]);
    await ask(view, "same for this one", "# Other");
    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 2,
        conversationId: "latest",
        content: "# Other",
      })
    );
  });

  it("carries on the open conversation, or opens an earlier one", async () => {
    mocks.agentConversations.mockResolvedValue([
      { id: "latest", title: "tighten it", updatedAt: 2 },
      { id: "earlier", title: "add a title", updatedAt: 1 },
    ]);
    const view = open();
    await waitFor(() =>
      expect(view.result.current.conversationId).toBe("latest")
    );

    await ask(view, "and the intro");
    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "latest" })
    );
    act(() => emitDone({ runId: 7, proposals: [], cancelled: false }));
    await waitFor(() => expect(view.result.current.running).toBe(false));

    act(() => view.result.current.openConversation("earlier"));

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "add a title",
        "Added.",
      ])
    );
  });

  it("starts a new conversation that joins the history once sent", async () => {
    mocks.agentConversations.mockResolvedValue([
      { id: "latest", title: "tighten it", updatedAt: 2 },
    ]);
    const view = open();
    await waitFor(() =>
      expect(view.result.current.conversationId).toBe("latest")
    );

    act(() => view.result.current.newConversation());
    expect(view.result.current.messages).toEqual([]);
    mocks.agentConversations.mockResolvedValue([
      { id: "started", title: "fresh start", updatedAt: 3 },
      { id: "latest", title: "tighten it", updatedAt: 2 },
    ]);
    await ask(view, "fresh start");

    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: null })
    );
    expect(view.result.current.conversationId).toBe("started");
    await waitFor(() =>
      expect(view.result.current.conversations.map((c) => c.id)).toEqual([
        "started",
        "latest",
      ])
    );
  });

  it("keeps a running answer in view when another file opens", async () => {
    const view = open();
    await ask(view);

    view.rerender({ file: 2 });
    act(() => {
      emitPart(0, TEXT);
      emitDelta({ runId: 7, index: 0, text: "Tightened." });
    });

    expect(texts(view.result.current.messages)).toEqual([
      "tighten it",
      "Tightened.",
    ]);
    expect(view.result.current.running).toBe(true);
  });

  it("answers with the agent the open conversation belongs to", async () => {
    mocks.agentConversations.mockResolvedValue([
      { id: "latest", title: "tighten it", updatedAt: 2, agentId: "codex-acp" },
    ]);
    const view = open();
    await waitFor(() =>
      expect(view.result.current.agent.agentId).toBe("codex-acp")
    );

    await ask(view, "and the intro");

    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "latest",
        agent: { id: "codex-acp", config: [] },
      })
    );
  });

  it("starts a new conversation when another agent is picked", async () => {
    mocks.agentConversations.mockResolvedValue([
      {
        id: "latest",
        title: "tighten it",
        updatedAt: 2,
        agentId: "claude-acp",
      },
    ]);
    const view = open();
    await waitFor(() =>
      expect(view.result.current.conversationId).toBe("latest")
    );

    act(() => view.result.current.agent.choose("codex-acp"));

    expect(view.result.current.conversationId).toBeNull();
    expect(view.result.current.messages).toEqual([]);
    await ask(view, "fresh start");
    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        agent: { id: "codex-acp", config: [] },
      })
    );
  });

  it("reports a signed-out agent apart from other failures", async () => {
    const view = open();
    await ask(view);

    act(() =>
      emitError({ runId: 7, message: "Sign in to Codex", signIn: true })
    );

    expect(view.result.current.signedOut).toBe(true);
    expect(view.result.current.error).toBe("Sign in to Codex");
    expect(view.result.current.running).toBe(false);
  });
});
