import { ChatWorkspace } from "@ctrl-ui/react/chat-workspace";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileRow } from "@/lib/ipc-types";
import type { TextSelection } from "@/lib/text-selection";

import { AgentPanel } from "./agent-panel";
import { agentChoice } from "./agent-panel.fixtures";
import { type AgentReference, writeReference } from "./agent-references";
import type { UseAgentSession } from "./use-agent-session";

const FILE: FileRow = {
  id: 1,
  rootId: 1,
  path: "/skills/interface/break/SKILL.md",
  relPath: "interface/break/SKILL.md",
  kind: "skill",
  name: "break",
  projectDir: null,
  repositoryDir: null,
  size: 1,
  mtimeNs: 0,
  hash: "",
  isSymlink: false,
  symlinkTarget: null,
  description: null,
  aliases: [],
  firstSeenAt: 0,
  lastSeenScanId: null,
  deletedAt: null,
};

const INTERFACE: AgentReference = {
  path: "/skills/interface",
  label: "interface",
  kind: "folder",
};

const CRAFT: AgentReference = {
  path: "/skills/craft/SKILL.md",
  label: "craft",
  kind: "skill",
};

const SELECTION: TextSelection = {
  text: "Never claude-in-chrome\nunless I name it.",
  firstLine: 2,
  lastLine: 3,
};

function draggedRow(reference: AgentReference) {
  const data = new Map<string, string>();
  const types: string[] = [];
  const transfer: Pick<
    DataTransfer,
    "types" | "effectAllowed" | "setData" | "getData"
  > = {
    types,
    effectAllowed: "none",
    setData: (type, value) => {
      data.set(type, value);
      types.push(type);
    },
    getData: (type) => data.get(type) ?? "",
  };
  writeReference(transfer, reference);
  return transfer;
}

const CHIP = /^(Remove|Add) (break|interface)$/;

function chips() {
  return screen
    .getAllByRole("button", { name: CHIP })
    .map((chip) => chip.getAttribute("aria-label"));
}

function Panel({
  initial = [],
  selected = null,
  send = vi.fn().mockResolvedValue(undefined),
}: {
  initial?: AgentReference[];
  selected?: TextSelection | null;
  send?: UseAgentSession["send"];
}) {
  const [references, setReferences] = useState(initial);
  const [includesFile, includeFile] = useState(true);
  const [selection, setSelection] = useState(selected);
  const [draft, setDraft] = useState("");
  return (
    <ChatWorkspace>
      <AgentPanel
        documentText="# Break"
        file={FILE}
        onApply={vi.fn()}
        onClose={vi.fn()}
        onRemoveSelection={() => setSelection(null)}
        selection={selection}
        session={{
          agent: agentChoice(),
          conversations: [],
          conversationId: null,
          openConversation: vi.fn(),
          newConversation: vi.fn(),
          messages: [],
          running: false,
          error: null,
          signedOut: false,
          proposals: [],
          references,
          addReference: (reference) =>
            setReferences((current) => [...current, reference]),
          removeReference: (path) =>
            setReferences((current) =>
              current.filter((reference) => reference.path !== path)
            ),
          includesFile,
          includeFile,
          send,
          cancel: vi.fn().mockResolvedValue(undefined),
          dismissProposal: vi.fn(),
          draft,
          setDraft,
          prefill: vi.fn(),
        }}
      />
    </ChatWorkspace>
  );
}

describe("composer references", () => {
  it.each([INTERFACE, CRAFT])(
    "takes a library $kind dropped on the composer as a reference, until removed",
    (reference) => {
      render(<Panel />);
      const composer = screen.getByRole("textbox");
      const dataTransfer = draggedRow(reference);

      fireEvent.dragEnter(composer, { dataTransfer });
      fireEvent.dragOver(composer, { dataTransfer });
      fireEvent.drop(composer, { dataTransfer });

      const remove = `Remove ${reference.label}`;
      const chip = screen.getByRole("button", { name: remove });
      expect(chip.title).toBe(reference.path);
      fireEvent.click(chip);
      expect(screen.queryByRole("button", { name: remove })).toBeNull();
    }
  );

  it("keeps the composer open while it carries a reference or leaves the file out", () => {
    render(<Panel />);
    const form = () => screen.getByRole("textbox").closest("form");
    expect(form()?.hasAttribute("data-draft")).toBe(false);

    const dataTransfer = draggedRow(INTERFACE);
    fireEvent.dragEnter(screen.getByRole("textbox"), { dataTransfer });
    fireEvent.drop(screen.getByRole("textbox"), { dataTransfer });
    expect(form()?.hasAttribute("data-draft")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));

    fireEvent.click(screen.getByRole("button", { name: "Remove interface" }));
    expect(form()?.hasAttribute("data-draft")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));
    expect(form()?.hasAttribute("data-draft")).toBe(true);
  });

  it("lets the open file be taken out of the request and offers it back", () => {
    render(<Panel />);

    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));

    expect(screen.queryByRole("button", { name: "Remove break" })).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Ask Claude Agent" })
    ).toBeTruthy();
    const offer = screen.getByRole("button", { name: "Add break" });
    expect(offer.dataset.variant).toBe("ghost");

    fireEvent.click(offer);

    expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Ask for a change to this file" })
    ).toBeTruthy();
  });

  it("moves the removed open file after the references, keeping focus on it", () => {
    render(<Panel initial={[INTERFACE]} />);
    expect(chips()).toEqual(["Remove break", "Remove interface"]);

    screen.getByRole("button", { name: "Remove break" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));

    expect(chips()).toEqual(["Remove interface", "Add break"]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add break" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Add break" }));

    expect(chips()).toEqual(["Remove break", "Remove interface"]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove break" })
    );
  });

  it("sends the selected lines with the request, until their chip is removed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Panel selected={SELECTION} send={send} />);
    const composer = screen.getByRole("textbox");
    const chip = screen.getByRole("button", { name: "Remove Lines 2–3" });
    expect(chip.title).toBe(SELECTION.text);
    expect(composer.closest("form")?.hasAttribute("data-draft")).toBe(true);

    fireEvent.change(composer, { target: { value: "tighten it" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        { prompt: "tighten it", images: [], selection: SELECTION },
        "# Break"
      )
    );

    fireEvent.click(chip);
    expect(
      screen.queryByRole("button", { name: "Remove Lines 2–3" })
    ).toBeNull();
    fireEvent.change(composer, { target: { value: "and kinder" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        { prompt: "and kinder", images: [], selection: null },
        "# Break"
      )
    );
  });

  it("names a one-line selection by its line", () => {
    render(<Panel selected={{ ...SELECTION, lastLine: 2 }} />);

    expect(screen.getByRole("button", { name: "Remove Line 2" })).toBeTruthy();
  });
});
