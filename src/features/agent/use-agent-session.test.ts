import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentReference } from "./agent-references";
import { useAgentSession } from "./use-agent-session";
import {
  emitDelta,
  emitDone,
  emitPart,
  kinds,
  mocks,
  READ,
  resetMocks,
  SETTINGS,
  said,
  TEXT,
  THINKING,
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

const SCREENSHOT = {
  id: "screenshot-1",
  name: "CleanShot.png",
  mediaType: "image/png" as const,
  base64: "iVBORw0KGgo=",
  width: 1568,
  height: 980,
};

describe("useAgentSession", () => {
  it("sends pasted images with the request and keeps them on the asked message", async () => {
    const view = open();

    await act(async () => {
      await view.result.current.send(
        { prompt: "match this layout", images: [SCREENSHOT] },
        "# Before",
        SETTINGS
      );
    });

    expect(mocks.agentSend).toHaveBeenCalledWith({
      fileId: 1,
      conversationId: null,
      content: "# Before",
      prompt: "match this layout",
      images: [SCREENSHOT],
      references: [],
      settings: SETTINGS,
    });
    expect(view.result.current.messages).toEqual([
      expect.objectContaining({
        role: "you",
        text: "match this layout",
        images: [SCREENSHOT],
      }),
    ]);
  });

  it("leaves the open file out of a request once it is removed, until the next file", async () => {
    const view = open();

    act(() => view.result.current.includeFile(false));
    await ask(view, "what does interface hold?");

    expect(mocks.agentSend).toHaveBeenCalledWith(
      expect.objectContaining({ content: null })
    );
    view.rerender({ file: 2 });
    expect(view.result.current.includesFile).toBe(true);
  });

  it("grows one answer while it streams, across its text blocks", async () => {
    const view = open();
    await ask(view);

    act(() => {
      emitPart(0, TEXT);
      emitDelta({ runId: 7, index: 0, text: "Tight" });
      emitDelta({ runId: 7, index: 0, text: "ened." });
      emitPart(1, TEXT);
      emitDelta({ runId: 7, index: 1, text: "Done." });
    });

    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "tighten it",
        "Tightened.\n\nDone.",
      ])
    );
  });

  it("keeps thinking and tool steps in order, out of the answer text", async () => {
    const view = open();
    await ask(view);

    act(() => {
      emitPart(0, THINKING);
      emitDelta({ runId: 7, index: 0, text: "Let me look." });
    });
    expect(kinds(view.result.current.messages)).toEqual(["thinking"]);

    act(() => emitPart(1, READ));
    expect(kinds(view.result.current.messages)).toEqual(["thinking", "tool"]);

    act(() => {
      emitPart(2, TEXT);
      emitDelta({ runId: 7, index: 2, text: "Done." });
    });
    await waitFor(() =>
      expect(texts(view.result.current.messages)).toEqual([
        "tighten it",
        "Done.",
      ])
    );
  });

  it("keeps the answer's key once the saved copy replaces the live one", async () => {
    const view = open();
    await ask(view);
    act(() => {
      emitPart(0, TEXT);
      emitDelta({ runId: 7, index: 0, text: "Tightened." });
    });
    const live = view.result.current.messages.at(-1)?.key;

    mocks.agentConversation.mockResolvedValue([
      said(1, "you", "tighten it"),
      said(2, "agent", "Tightened."),
    ]);
    act(() => emitDone({ runId: 7, proposal: null, cancelled: false }));

    await waitFor(() =>
      expect(view.result.current.messages.at(-1)?.key).toBe(live)
    );
    expect(texts(view.result.current.messages)).toEqual([
      "tighten it",
      "Tightened.",
    ]);
  });

  it("surfaces the edited document once the run reports back", async () => {
    const view = open();
    await ask(view);

    act(() => emitDone({ runId: 7, proposal: "# After", cancelled: false }));

    await waitFor(() => {
      expect(view.result.current.proposal).toBe("# After");
      expect(view.result.current.running).toBe(false);
    });
  });

  it("ignores a run it does not own, so a stale reply cannot land", async () => {
    const view = open();
    await ask(view);

    act(() => {
      emitPart(0, TEXT, 99);
      emitDelta({ runId: 99, index: 0, text: "ghost" });
      emitDone({ runId: 99, proposal: "# Wrong", cancelled: false });
    });

    expect(view.result.current.proposal).toBeNull();
    expect(view.result.current.messages).toHaveLength(1);
    expect(view.result.current.running).toBe(true);
  });

  it("lets the agent read each reference on every request until another file opens", async () => {
    const view = open();
    const folder: AgentReference = {
      path: "/skills/interface",
      label: "interface",
      kind: "folder",
    };
    const skill: AgentReference = {
      path: "/skills/ux-rules",
      label: "ux-rules",
      kind: "skill",
    };

    act(() => {
      view.result.current.addReference(folder);
      view.result.current.addReference(skill);
      view.result.current.addReference(folder);
    });
    act(() => view.result.current.removeReference(skill.path));
    for (const prompt of ["match them", "and the intro"]) {
      await ask(view, prompt);
      act(() => emitDone({ runId: 7, proposal: null, cancelled: false }));
      await waitFor(() => expect(view.result.current.running).toBe(false));
    }

    expect(mocks.agentSend).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.agentSend.mock.calls) {
      expect(request.references).toEqual([folder.path]);
    }
    expect(view.result.current.references).toEqual([folder]);
    view.rerender({ file: 2 });
    expect(view.result.current.references).toEqual([]);
  });
});
