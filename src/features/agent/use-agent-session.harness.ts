import { vi } from "vitest";

import type {
  AgentDeltaEvent,
  AgentDoneEvent,
  AgentErrorEvent,
  AgentListing,
  AgentPart,
  AgentPartEvent,
  AgentProposal,
  AgentStoredMessage,
} from "@/lib/agent-ipc-types";
import type { AgentMessage } from "./agent-messages";
import { answerText } from "./agent-steps";

export const mocks = {
  agentSend: vi.fn(),
  agentCancel: vi.fn(),
  agentCatalog: vi.fn(),
  agentPrepare: vi.fn(),
  agentSignIn: vi.fn(),
  agentConversations: vi.fn(),
  agentConversation: vi.fn(),
  handlers: {
    delta: [] as ((payload: AgentDeltaEvent) => void)[],
    part: [] as ((payload: AgentPartEvent) => void)[],
    done: [] as ((payload: AgentDoneEvent) => void)[],
    error: [] as ((payload: AgentErrorEvent) => void)[],
  },
};

const listen =
  <T>(handlers: ((payload: T) => void)[]) =>
  (handler: (payload: T) => void) => {
    handlers.push(handler);
    return Promise.resolve(() => undefined);
  };

export const eventsModule = {
  onAgentDelta: listen(mocks.handlers.delta),
  onAgentPart: listen(mocks.handlers.part),
  onAgentDone: listen(mocks.handlers.done),
  onAgentError: listen(mocks.handlers.error),
};

export const ipcModule = {
  agentSend: mocks.agentSend,
  agentCancel: mocks.agentCancel,
  agentCatalog: mocks.agentCatalog,
  agentPrepare: mocks.agentPrepare,
  agentSignIn: mocks.agentSignIn,
  agentConversations: mocks.agentConversations,
  agentConversation: mocks.agentConversation,
  toIpcError: (cause: unknown) =>
    cause instanceof Error ? cause : new Error(String(cause)),
};

export const CLAUDE: AgentListing = {
  id: "claude-acp",
  name: "Claude Agent",
  version: "1",
  description: "",
  icon: null,
  readiness: "installed",
  hardened: true,
};

export const PREPARED = {
  images: true,
  models: null,
  efforts: null,
  signIn: [],
  needsSignIn: false,
};

const fire =
  <T>(handlers: ((payload: T) => void)[]) =>
  (payload: T) => {
    for (const handler of handlers) {
      handler(payload);
    }
  };
export const emitDelta = fire(mocks.handlers.delta);
export const emitDone = fire(mocks.handlers.done);
export const emitError = fire(mocks.handlers.error);
export const emitPart = (index: number, part: AgentPart, runId = 7) =>
  fire(mocks.handlers.part)({ runId, index, part });

export const TEXT: AgentPart = { kind: "text", text: "" };
export const THINKING: AgentPart = {
  kind: "thinking",
  text: "",
  durationMs: null,
};
export const READ: AgentPart = {
  kind: "tool",
  id: "read",
  name: "Read",
  title: null,
  input: null,
  state: "running",
  output: null,
  durationMs: null,
};

export const proposed = (fileId: number, after: string): AgentProposal => ({
  fileId,
  path: `/library/${fileId}.md`,
  before: "# Before",
  after,
  hash: "h",
});

export const said = (
  id: number,
  role: "you" | "agent",
  text: string
): AgentStoredMessage => ({
  id,
  role,
  text,
  images: [],
  parts: [],
  meta: null,
});

const HISTORY: Record<string, AgentStoredMessage[]> = {
  latest: [said(1, "you", "tighten it"), said(2, "agent", "Tightened.")],
  earlier: [said(3, "you", "add a title"), said(4, "agent", "Added.")],
};

export const texts = (messages: AgentMessage[]) =>
  messages.map((message) =>
    message.role === "you" ? message.text : answerText(message.parts)
  );

export const kinds = (messages: AgentMessage[]) => {
  const last = messages.at(-1);
  return last?.role === "agent" ? last.parts.map((part) => part.kind) : [];
};

export function resetMocks() {
  for (const handlers of Object.values(mocks.handlers)) {
    handlers.length = 0;
  }
  window.localStorage.clear();
  mocks.agentSend
    .mockReset()
    .mockResolvedValue({ runId: 7, conversationId: "started" });
  mocks.agentCancel.mockReset().mockResolvedValue(null);
  mocks.agentCatalog.mockReset().mockResolvedValue([CLAUDE]);
  mocks.agentPrepare.mockReset().mockResolvedValue(PREPARED);
  mocks.agentSignIn.mockReset().mockResolvedValue("done");
  mocks.agentConversations.mockReset().mockResolvedValue([]);
  mocks.agentConversation
    .mockReset()
    .mockImplementation((id: string) => Promise.resolve(HISTORY[id] ?? []));
}
