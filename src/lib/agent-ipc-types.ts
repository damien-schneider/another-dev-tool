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

/** Mirrors acp::catalog::Readiness */
export type AgentReadiness =
  | "installed"
  | "download"
  | "package"
  | "needsNode"
  | "needsUv";

/** Mirrors acp::catalog::Listing */
export interface AgentListing {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  readiness: AgentReadiness;
  hardened: boolean;
}

/** Mirrors acp::protocol::Choice */
export interface AgentConfigChoice {
  value: string;
  name: string;
  description: string | null;
}

/** Mirrors acp::prepare::Picker */
export interface AgentPicker {
  id: string;
  name: string;
  current: string | null;
  choices: AgentConfigChoice[];
}

/** Mirrors acp::protocol::AuthMethod */
export interface AgentAuthMethod {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
}

/** Mirrors acp::prepare::Prepared */
export interface AgentPrepared {
  images: boolean;
  models: AgentPicker | null;
  efforts: AgentPicker | null;
  signIn: AgentAuthMethod[];
  needsSignIn: boolean;
}

/** Mirrors acp::prepare::SignIn */
export type AgentSignIn = "done" | "inTerminal";

/** Mirrors commands::agent::ConfigPick */
export interface AgentConfigPick {
  id: string;
  value: string;
}

/** Mirrors commands::agent::AgentChoice */
export interface AgentRun {
  id: string;
  config: AgentConfigPick[];
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

/** Mirrors db::agent_repo::PinnedSummary */
export interface AskConversationSummary extends AgentConversationSummary {
  agentId: string;
}

/** Mirrors agent::answer::AnswerMeta */
export interface AgentAnswerMeta {
  model: string | null;
  requestedModel: string;
  effort: string | null;
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
      title: string | null;
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

/** Mirrors ask::staging::Proposal */
export interface AgentProposal {
  fileId: number;
  path: string;
  before: string;
  after: string;
  hash: string;
}

/** Mirrors events::AgentDone */
export interface AgentDoneEvent {
  runId: number;
  proposals: AgentProposal[];
  cancelled: boolean;
}

/** Mirrors events::AgentError */
export interface AgentErrorEvent {
  runId: number;
  message: string;
  signIn: boolean;
}
