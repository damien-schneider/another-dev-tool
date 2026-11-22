/** Mirrors agent::cli::AgentStatus */
export interface AgentStatus {
  available: boolean;
  path: string | null;
  version: string | null;
}

/** Mirrors agent::settings::Model */
export type AgentModel = "fable" | "opus" | "sonnet" | "haiku";

/** Mirrors agent::settings::Effort */
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Mirrors agent::message::PromptImage and commands::agent_history::SentImage */
export interface AgentPromptImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  width: number;
  height: number;
  base64: string;
}

/** Mirrors agent::settings::RunSettings */
export interface AgentRunSettings {
  model: AgentModel;
  effort: AgentEffort;
}

/** Mirrors commands::agent::AgentStarted */
export interface AgentStarted {
  runId: number;
  conversationId: string;
}

/** Mirrors db::agent_repo::ConversationSummary */
export interface AgentConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

/** Mirrors agent::answer::AnswerMeta */
export interface AgentAnswerMeta {
  model: string | null;
  requestedModel: AgentModel;
  effort: AgentEffort;
  durationMs: number | null;
}

/** Mirrors commands::agent_history::StoredMessage */
export interface AgentStoredMessage {
  id: number;
  role: "you" | "agent";
  text: string;
  images: AgentPromptImage[];
  parts: AgentPart[];
  meta: AgentAnswerMeta | null;
}

/** Mirrors events::AgentDelta */
export interface AgentDeltaEvent {
  runId: number;
  index: number;
  text: string;
}

/** Mirrors agent::answer::ToolState */
export type AgentToolState = "running" | "done" | "error";

/** Mirrors agent::answer::Part */
export type AgentPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string; durationMs: number | null }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      state: AgentToolState;
      output: string | null;
      durationMs: number | null;
    };

/** Mirrors events::AgentPart */
export interface AgentPartEvent {
  runId: number;
  index: number;
  part: AgentPart;
}

/** Mirrors events::AgentDone */
export interface AgentDoneEvent {
  runId: number;
  proposal: string | null;
  cancelled: boolean;
}

/** Mirrors events::AgentError */
export interface AgentErrorEvent {
  runId: number;
  message: string;
}
