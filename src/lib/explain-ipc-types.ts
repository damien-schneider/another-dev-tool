import type { AgentAnswerMeta, AgentPart } from "./agent-ipc-types";

/** Mirrors explain::Level */
export type ExplainLevel = "gist" | "brief" | "standard" | "detailed" | "deep";

/** Mirrors db::explain_repo::RecentProject */
export interface ExplainRecentProject {
  path: string;
  updatedAt: number;
}

/** Mirrors db::explain_repo::StoredMessage */
export interface ExplainStoredMessage {
  id: number;
  role: "you" | "agent";
  text: string;
  parts: AgentPart[];
  meta: AgentAnswerMeta | null;
}

/** Mirrors explain::source::SourceFile */
export interface SourceFile {
  /** Relative to the project, with `/` separators. */
  path: string;
  text: string;
}
