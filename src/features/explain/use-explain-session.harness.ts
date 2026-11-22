import { vi } from "vitest";

import type {
  AgentDeltaEvent,
  AgentDoneEvent,
  AgentErrorEvent,
  AgentPartEvent,
} from "@/lib/agent-ipc-types";
import type { ExplainStoredMessage } from "@/lib/explain-ipc-types";

export const PROJECT = "/work/shop";
export const RUN_ID = 7;
export const SETTINGS = { model: "opus", effort: "medium" } as const;

export const mocks = {
  explainSend: vi.fn(),
  explainCancel: vi.fn(),
  explainConversations: vi.fn(),
  explainConversation: vi.fn(),
  explainRecentProjects: vi.fn(),
  explainReadSource: vi.fn(),
  agentStatus: vi.fn(),
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
  explainSend: mocks.explainSend,
  explainCancel: mocks.explainCancel,
  explainConversations: mocks.explainConversations,
  explainConversation: mocks.explainConversation,
  explainRecentProjects: mocks.explainRecentProjects,
  explainReadSource: mocks.explainReadSource,
  agentStatus: mocks.agentStatus,
  toIpcError: (cause: unknown) =>
    cause instanceof Error ? cause : new Error(String(cause)),
};

const fire =
  <T>(handlers: ((payload: T) => void)[]) =>
  (payload: T) => {
    for (const handler of handlers) {
      handler(payload);
    }
  };

export const emitTextPart = (runId = RUN_ID) =>
  fire(mocks.handlers.part)({
    runId,
    index: 0,
    part: { kind: "text", text: "" },
  });
export const emitDelta = (text: string, runId = RUN_ID) =>
  fire(mocks.handlers.delta)({ runId, index: 0, text });
export const emitDone = (runId = RUN_ID) =>
  fire(mocks.handlers.done)({ runId, proposal: null, cancelled: false });
export const emitError = (message: string, runId = RUN_ID) =>
  fire(mocks.handlers.error)({ runId, message });

export const said = (
  id: number,
  role: "you" | "agent",
  text: string
): ExplainStoredMessage => ({ id, role, text, parts: [], meta: null });

export function resetMocks(saved: ExplainStoredMessage[] = []) {
  for (const handlers of Object.values(mocks.handlers)) {
    handlers.length = 0;
  }
  mocks.explainSend
    .mockReset()
    .mockResolvedValue({ runId: RUN_ID, conversationId: "started" });
  mocks.explainCancel.mockReset().mockResolvedValue(null);
  mocks.explainConversations.mockReset().mockResolvedValue([]);
  mocks.explainConversation.mockReset().mockResolvedValue(saved);
  mocks.explainRecentProjects.mockReset().mockResolvedValue([]);
  mocks.explainReadSource.mockReset().mockResolvedValue({
    path: "src/cart.ts",
    text: "export const total = 1;",
  });
  mocks.agentStatus
    .mockReset()
    .mockResolvedValue({ available: true, path: "/bin/claude", version: "1" });
}
