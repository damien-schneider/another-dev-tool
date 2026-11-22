import { ChatWorkspace } from "@ctrl-ui/react/chat-workspace";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "./agent-panel";
import {
  composer,
  DOCUMENT,
  FILE,
  PROPOSAL,
  renderPanel,
  SCREENSHOT,
} from "./agent-panel.fixtures";

let typeInEditor: (text: string) => void = () => undefined;

function LiveEditor() {
  const [document, setDocument] = useState(DOCUMENT);
  const [proposal, setProposal] = useState<string | null>(PROPOSAL);
  typeInEditor = setDocument;
  return (
    <>
      <output data-testid="editor">{document}</output>
      <ChatWorkspace>
        <AgentPanel
          documentText={document}
          file={FILE}
          onApply={setDocument}
          onClose={vi.fn()}
          session={{
            available: true,
            conversations: [],
            conversationId: null,
            openConversation: vi.fn(),
            newConversation: vi.fn(),
            messages: [
              { key: "you-1", role: "you", text: "be kind", images: [] },
            ],
            running: false,
            error: null,
            proposal,
            references: [],
            addReference: vi.fn(),
            removeReference: vi.fn(),
            includesFile: true,
            includeFile: vi.fn(),
            send: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue(undefined),
            dismissProposal: () => setProposal(null),
            draft: "",
            setDraft: vi.fn(),
            prefill: vi.fn(),
          }}
        />
      </ChatWorkspace>
    </>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("AgentPanel", () => {
  it("sends the request with the open document on Enter", async () => {
    const { session } = renderPanel();

    fireEvent.change(composer(), { target: { value: "tighten it" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(session.send).toHaveBeenCalledWith(
        { prompt: "tighten it", images: [] },
        DOCUMENT,
        {
          model: "opus",
          effort: "high",
        }
      )
    );
  });

  it("runs with the model and thinking level picked last time, ignoring unknown ones", async () => {
    window.localStorage.setItem("another-dev-tool.agent-model", "haiku");
    window.localStorage.setItem("another-dev-tool.agent-effort", "ludicrous");
    const { session } = renderPanel();

    fireEvent.change(composer(), { target: { value: "tighten it" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() =>
      expect(session.send).toHaveBeenCalledWith(
        { prompt: "tighten it", images: [] },
        DOCUMENT,
        {
          model: "haiku",
          effort: "high",
        }
      )
    );
  });

  it("names the open skill as the composer's context", () => {
    renderPanel();

    expect(screen.getByText("ux-rules")).toBeTruthy();
  });

  it("picks the model and thinking level from one dropdown", () => {
    window.localStorage.setItem("another-dev-tool.agent-model", "haiku");
    renderPanel();

    const trigger = screen.getByRole("button", {
      name: "Model: Haiku, Thinking: High",
    });
    expect(
      trigger.querySelector('[data-control-ui="provider-logo"] path')
    ).toBeTruthy();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("keeps Shift+Enter for a new line", () => {
    const { session } = renderPanel();

    fireEvent.change(composer(), { target: { value: "tighten it" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });

    expect(session.send).not.toHaveBeenCalled();
  });

  it("drafts an example request without sending it", () => {
    const { session } = renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Restructure into steps" })
    );

    expect(composer().value).not.toBe("");
    expect(session.send).not.toHaveBeenCalled();
  });

  it("shows a change prefilled for the file in the composer, unsent", () => {
    const { session } = renderPanel({ draft: "Apply this change." });

    expect(composer().value).toBe("Apply this change.");
    expect(session.send).not.toHaveBeenCalled();
  });

  it("has no composer when the agent CLI is missing", () => {
    renderPanel({ available: false });

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lets a running request be stopped", () => {
    const { session } = renderPanel({
      running: true,
      messages: [
        { key: "you-1", role: "you", text: "tighten it", images: [SCREENSHOT] },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(session.cancel).toHaveBeenCalled();
  });

  it("applies a document the agent actually changed to the editor", () => {
    const { session, onApply } = renderPanel({ proposal: PROPOSAL });

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    expect(onApply).toHaveBeenCalledWith(PROPOSAL);
    expect(session.dismissProposal).toHaveBeenCalled();
  });

  it("takes an applied change back out, and offers it again", () => {
    render(<LiveEditor />);
    const editor = () => screen.getByTestId("editor").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));
    expect(editor()).toBe(PROPOSAL);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor()).toBe(DOCUMENT);
    expect(screen.getByText("Change undone")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Apply again" }));
    expect(editor()).toBe(PROPOSAL);
  });

  it("never offers an undo that would erase edits made after applying", () => {
    render(<LiveEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));
    act(() => {
      typeInEditor(`${PROPOSAL} Typed by hand.`);
    });

    expect(screen.getByText("Applied to the editor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("dismisses a proposal without touching the editor", () => {
    const { session, onApply } = renderPanel({ proposal: PROPOSAL });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(session.dismissProposal).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("stays quiet when the agent hands back an identical document", () => {
    renderPanel({ proposal: DOCUMENT });

    expect(
      screen.queryByRole("button", { name: "Apply to editor" })
    ).toBeNull();
  });

  it("shows a failure and sends the same request again on retry", () => {
    const { session } = renderPanel({
      error: "The agent exited early.",
      messages: [
        { key: "you-1", role: "you", text: "tighten it", images: [SCREENSHOT] },
      ],
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "The agent exited early."
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(session.send).toHaveBeenCalledWith(
      { prompt: "tighten it", images: [SCREENSHOT] },
      DOCUMENT,
      {
        model: "opus",
        effort: "high",
      }
    );
  });

  it("opens the folded conversation once a request goes out", async () => {
    const { session } = renderPanel({}, { expanded: false });
    const toggle = screen.getByRole("button", { name: "Conversation" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(composer(), { target: { value: "tighten it" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await waitFor(() => expect(session.send).toHaveBeenCalled());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
