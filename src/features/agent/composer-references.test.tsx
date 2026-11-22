import { ChatWorkspace } from "@ctrl-ui/react/chat-workspace";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileRow } from "@/lib/ipc-types";

import { AgentPanel } from "./agent-panel";
import { type AgentReference, writeReference } from "./agent-references";

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

function Panel({ initial = [] }: { initial?: AgentReference[] }) {
  const [references, setReferences] = useState(initial);
  const [includesFile, includeFile] = useState(true);
  return (
    <ChatWorkspace>
      <AgentPanel
        documentText="# Break"
        file={FILE}
        onApply={vi.fn()}
        onClose={vi.fn()}
        session={{
          available: true,
          conversations: [],
          conversationId: null,
          openConversation: vi.fn(),
          newConversation: vi.fn(),
          messages: [],
          running: false,
          error: null,
          proposal: null,
          references,
          addReference: (reference) =>
            setReferences((current) => [...current, reference]),
          removeReference: (path) =>
            setReferences((current) =>
              current.filter((reference) => reference.path !== path)
            ),
          includesFile,
          includeFile,
          send: vi.fn().mockResolvedValue(undefined),
          cancel: vi.fn().mockResolvedValue(undefined),
          dismissProposal: vi.fn(),
          draft: "",
          setDraft: vi.fn(),
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
    expect(screen.getByRole("textbox", { name: "Ask Claude" })).toBeTruthy();
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
});
