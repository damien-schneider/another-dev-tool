import { ChatWorkspace } from "@ctrl-ui/react/chat-workspace";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import type { FileRow } from "@/lib/ipc-types";

import type { AgentImage } from "./agent-images";
import { AgentPanel } from "./agent-panel";
import type { UseAgentSession } from "./use-agent-session";

export const SCREENSHOT: AgentImage = {
  id: "screenshot-1",
  name: "CleanShot 2026-11-20.png",
  mediaType: "image/png",
  base64: "iVBORw0KGgo=",
  width: 1568,
  height: 980,
};

export const DOCUMENT = "# Rules\n\nKeep it short.";
export const PROPOSAL = `${DOCUMENT}\n\nAnd kind.`;
export const FILE: FileRow = {
  id: 1,
  rootId: 1,
  path: "/skills/ux-rules/SKILL.md",
  relPath: "ux-rules/SKILL.md",
  kind: "skill",
  name: "ux-rules",
  projectDir: null,
  repositoryDir: null,
  size: DOCUMENT.length,
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

function DraftingPanel({
  session,
  onApply,
  onClose,
}: {
  session: UseAgentSession;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(session.draft);
  return (
    <AgentPanel
      documentText={DOCUMENT}
      file={FILE}
      onApply={onApply}
      onClose={onClose}
      session={{ ...session, draft, setDraft }}
    />
  );
}

export function renderPanel(
  overrides: Partial<UseAgentSession> = {},
  { expanded = true } = {}
) {
  const session: UseAgentSession = {
    available: true,
    conversations: [],
    conversationId: null,
    openConversation: vi.fn(),
    newConversation: vi.fn(),
    messages: [],
    running: false,
    error: null,
    proposal: null,
    references: [],
    addReference: vi.fn(),
    removeReference: vi.fn(),
    includesFile: true,
    includeFile: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    dismissProposal: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
    prefill: vi.fn(),
    ...overrides,
  };
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <ChatWorkspace defaultExpanded={expanded}>
      <DraftingPanel onApply={onApply} onClose={onClose} session={session} />
    </ChatWorkspace>
  );
  return { session, onApply, onClose };
}

export const composer = () => screen.getByRole<HTMLTextAreaElement>("textbox");
