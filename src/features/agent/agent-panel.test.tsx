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

import type { AgentListing } from "@/lib/agent-ipc-types";

import { AgentPanel } from "./agent-panel";
import {
  agentChoice,
  composer,
  DOCUMENT,
  FILE,
  PREPARED,
  PROPOSAL,
  renderPanel,
  SCREENSHOT,
  suggested,
} from "./agent-panel.fixtures";

const CODEX_OPTION = /Codex/;

let typeInEditor: (text: string) => void = () => undefined;

function LiveEditor() {
  const [document, setDocument] = useState(DOCUMENT);
  const [proposals, setProposals] = useState([suggested(PROPOSAL)]);
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
          onRemoveSelection={vi.fn()}
          selection={null}
          session={{
            agent: agentChoice(),
            conversations: [],
            conversationId: null,
            openConversation: vi.fn(),
            newConversation: vi.fn(),
            messages: [
              { key: "you-1", role: "you", text: "be kind", images: [] },
            ],
            running: false,
            error: null,
            signedOut: false,
            proposals,
            references: [],
            addReference: vi.fn(),
            removeReference: vi.fn(),
            includesFile: true,
            includeFile: vi.fn(),
            send: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue(undefined),
            dismissProposal: () => setProposals([]),
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
        { prompt: "tighten it", images: [], selection: null },
        DOCUMENT
      )
    );
  });

  it("names the open skill as the composer's context", () => {
    renderPanel();

    expect(screen.getByText("ux-rules")).toBeTruthy();
  });

  it("picks the agent's model and thinking level from one dropdown", () => {
    renderPanel({ agent: agentChoice({ model: "sonnet" }) });

    expect(
      screen.getByRole("button", { name: "Model: Sonnet, Effort: High" })
    ).toBeTruthy();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("switches to the agent picked from the header list", async () => {
    const claude = agentChoice().listings;
    const agent = agentChoice({
      listings: [
        ...claude,
        {
          id: "codex-acp",
          name: "Codex",
          version: "1",
          description: "",
          icon: null,
          readiness: "download",
          hardened: true,
        },
      ],
    });
    renderPanel({ agent });

    fireEvent.click(
      screen.getByRole("button", { name: "Agent: Claude Agent" })
    );
    fireEvent.click(await screen.findByRole("option", { name: CODEX_OPTION }));

    expect(agent.choose).toHaveBeenCalledWith("codex-acp");
  });

  it("names the agents kept to the file when the chosen one is not", () => {
    const gemini: AgentListing = {
      id: "gemini",
      name: "Gemini CLI",
      version: "1",
      description: "",
      icon: null,
      readiness: "installed",
      hardened: false,
    };
    renderPanel({
      agent: agentChoice({
        listings: [...agentChoice().listings, gemini],
        agentId: gemini.id,
        listing: gemini,
        name: gemini.name,
      }),
    });

    expect(
      screen.getByText(
        "Only Claude Agent is fully kept to this file. Gemini CLI is held back only when it asks for permission."
      )
    ).toBeTruthy();
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

  it("walks through signing in from the Terminal, then checks the agent again", async () => {
    const agent = agentChoice({
      preparing: {
        state: "ready",
        prepared: {
          ...PREPARED,
          needsSignIn: true,
          signIn: [
            {
              id: "claude-ai-login",
              name: "Claude account",
              description: null,
              type: "terminal",
            },
          ],
        },
      },
      signIn: vi.fn().mockResolvedValue("inTerminal"),
    });
    renderPanel({ agent });

    fireEvent.click(screen.getByRole("button", { name: "Claude account" }));

    const proceed = await screen.findByRole("button", { name: "Continue" });
    expect(agent.signIn).toHaveBeenCalledWith("claude-ai-login");
    expect(agent.refresh).not.toHaveBeenCalled();
    fireEvent.click(proceed);
    expect(agent.refresh).toHaveBeenCalled();
  });

  it("sends the refused request again once signed in", async () => {
    const agent = agentChoice({
      preparing: {
        state: "ready",
        prepared: {
          ...PREPARED,
          signIn: [
            {
              id: "chat-gpt",
              name: "ChatGPT account",
              description: null,
              type: "agent",
            },
          ],
        },
      },
    });
    const { session } = renderPanel({
      agent,
      signedOut: true,
      error: "Sign in to use Codex.",
      messages: [{ key: "you-1", role: "you", text: "tighten it", images: [] }],
    });

    fireEvent.click(screen.getByRole("button", { name: "ChatGPT account" }));

    await waitFor(() =>
      expect(session.send).toHaveBeenCalledWith(
        { prompt: "tighten it", images: [], selection: null },
        DOCUMENT
      )
    );
    expect(agent.refresh).toHaveBeenCalled();
  });

  it("offers to start an agent again after it failed to start", () => {
    const agent = agentChoice({
      preparing: { state: "failed", message: "npx not found" },
    });
    renderPanel({ agent });

    expect(screen.getByText("npx not found")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(agent.refresh).toHaveBeenCalled();
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
    const { session, onApply } = renderPanel({
      proposals: [suggested(PROPOSAL)],
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply to editor" }));

    expect(onApply).toHaveBeenCalledWith(PROPOSAL);
    expect(session.dismissProposal).toHaveBeenCalledWith(FILE.id);
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
    const { session, onApply } = renderPanel({
      proposals: [suggested(PROPOSAL)],
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(session.dismissProposal).toHaveBeenCalledWith(FILE.id);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("stays quiet when the agent hands back an identical document", () => {
    renderPanel({ proposals: [suggested(DOCUMENT)] });

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
      { prompt: "tighten it", images: [SCREENSHOT], selection: null },
      DOCUMENT
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
