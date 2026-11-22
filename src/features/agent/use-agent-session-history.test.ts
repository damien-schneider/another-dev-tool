import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSession } from "./use-agent-session";
import {
  emitDelta,
  emitDone,
  emitPart,
  mocks,
  resetMocks,
  SETTINGS,
  said,
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
    await view.result.current.send({ prompt, images: [] }, document, SETTINGS);
  });
}

describe("useAgentSession conversations", () => {
  it("reopens the latest conversation of the file", async () => {
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
    expect(view.result.current.conversationId).toBe("latest");
    expect(view.result.current.conversations).toHaveLength(2);
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
    act(() => emitDone({ runId: 7, proposal: null, cancelled: false }));
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

  it("keeps a run going while another file is open, and shows its answer back home", async () => {
    const view = open();
    await ask(view);

    view.rerender({ file: 2 });
    act(() => {
      emitPart(0, TEXT);
      emitDelta({ runId: 7, index: 0, text: "Tightened." });
    });

    expect(view.result.current.messages).toEqual([]);
    expect(view.result.current.running).toBe(false);

    mocks.agentConversation.mockResolvedValue([
      said(1, "you", "tighten it"),
      said(2, "agent", "Tightened."),
    ]);
    act(() => emitDone({ runId: 7, proposal: "# After", cancelled: false }));
    expect(view.result.current.proposal).toBeNull();

    mocks.agentConversations.mockResolvedValue([
      { id: "started", title: "tighten it", updatedAt: 3 },
    ]);
    view.rerender({ file: 1 });

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "tighten it",
        "Tightened.",
      ])
    );
  });
});
