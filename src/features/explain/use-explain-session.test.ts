import {
  act,
  type RenderHookResult,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answerText } from "../agent/agent-steps";
import type { AgentMessage } from "../agent/use-agent-session";
import {
  type ExplainRequest,
  type UseExplainSession,
  useExplainSession,
} from "./use-explain-session";
import {
  emitDelta,
  emitDone,
  emitError,
  emitTextPart,
  mocks,
  PROJECT,
  resetMocks,
  SETTINGS,
  said,
} from "./use-explain-session.harness";

vi.mock(
  "@/lib/events",
  async () => (await import("./use-explain-session.harness")).eventsModule
);
vi.mock(
  "@/lib/ipc",
  async () => (await import("./use-explain-session.harness")).ipcModule
);

beforeEach(() => resetMocks());

const TOUR: ExplainRequest = {
  text: "Give me the tour",
  level: "brief",
  settings: SETTINGS,
};

const texts = (messages: AgentMessage[]) =>
  messages.map((message) =>
    message.role === "you" ? message.text : answerText(message.parts)
  );

function open(project: string | null = PROJECT) {
  return renderHook(({ shown }) => useExplainSession(shown), {
    initialProps: { shown: project },
  });
}

type Opened = RenderHookResult<UseExplainSession, { shown: string | null }>;

async function ask(view: Opened, request = TOUR) {
  await act(async () => {
    await view.result.current.ask(request);
  });
}

describe("useExplainSession", () => {
  it("asks about the open project at the chosen detail level", async () => {
    const view = open();

    await ask(view);

    expect(mocks.explainSend).toHaveBeenCalledWith({
      project: PROJECT,
      conversationId: null,
      text: "Give me the tour",
      level: "brief",
      settings: SETTINGS,
    });
    expect(view.result.current.conversationId).toBe("started");
    expect(texts(view.result.current.messages)).toEqual(["Give me the tour"]);
    expect(view.result.current.running).toBe(true);
  });

  it("streams its own answer and ignores runs it did not start", async () => {
    const view = open();
    await ask(view);

    act(() => {
      emitTextPart();
      emitDelta("The shop has ");
      emitTextPart(99);
      emitDelta("SECRET", 99);
      emitDelta("three layers.");
    });

    expect(texts(view.result.current.messages)).toEqual([
      "Give me the tour",
      "The shop has three layers.",
    ]);
  });

  it("settles on the saved conversation once the answer is done", async () => {
    const view = open();
    await ask(view);
    mocks.explainConversation.mockResolvedValue([
      said(1, "you", "Give me the tour"),
      said(2, "agent", "Three layers: UI, API, store."),
    ]);

    act(() => {
      emitDelta("Three layers");
      emitDone();
    });

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "Give me the tour",
        "Three layers: UI, API, store.",
      ])
    );
    expect(mocks.explainConversation).toHaveBeenCalledWith("started");
    expect(view.result.current.running).toBe(false);
  });

  it("reports a failed run and keeps what was saved of the answer", async () => {
    const view = open();
    await ask(view);
    mocks.explainConversation.mockResolvedValue([
      said(1, "you", "Give me the tour"),
      said(2, "agent", "The shop has"),
    ]);

    act(() => {
      emitDelta("The shop has");
      emitError("Claude stopped: rate limited");
    });

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "Give me the tour",
        "The shop has",
      ])
    );
    expect(view.result.current.error).toBe("Claude stopped: rate limited");
    expect(view.result.current.running).toBe(false);
  });

  it("retries the last question at the level it was asked", async () => {
    mocks.explainSend.mockRejectedValueOnce(new Error("busy"));
    const view = open();
    await ask(view, { ...TOUR, level: "deep" });
    expect(view.result.current.error).toBe("busy");

    await act(async () => {
      await view.result.current.retry?.();
    });

    expect(mocks.explainSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Give me the tour", level: "deep" })
    );
  });

  it("starts a fresh conversation when another project is opened", async () => {
    const view = open();
    await ask(view);
    act(() => emitDone());

    view.rerender({ shown: "/work/blog" });

    expect(view.result.current.conversationId).toBeNull();
    expect(view.result.current.messages).toEqual([]);
    await waitFor(() =>
      expect(mocks.explainConversations).toHaveBeenCalledWith("/work/blog")
    );
  });

  it("asks nothing until a project is open", async () => {
    const view = open(null);

    await ask(view);

    expect(mocks.explainSend).not.toHaveBeenCalled();
  });
});
