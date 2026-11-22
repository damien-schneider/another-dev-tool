/** Mirrors patterns::sources::Agent */
export type PatternAgent =
  | "claude-code"
  | "codex"
  | "omp"
  | "mastra-code"
  | "pencil";

export type PatternKind =
  | "strengthen"
  | "automate"
  | "rule"
  | "skill"
  | "memory";

export interface PatternEvidence {
  agent: PatternAgent;
  project: string | null;
  at: number;
  text: string;
}

export interface Pattern {
  id: number;
  kind: PatternKind;
  title: string;
  statement: string;
  scope: string;
  /** Absolute path of an indexed file (matches `FileRow.path`), or null. */
  target: string | null;
  /** For a new skill (kind "skill", no target), a full SKILL.md with frontmatter. */
  change: string;
  why: string;
  evidence: PatternEvidence[];
  sessions: number;
  days: number;
  foundAt: number;
}

export interface PatternsRun {
  finishedAt: number;
  prompts: number;
  sessions: number;
  firstAt: number;
  lastAt: number;
  agents: { agent: PatternAgent; prompts: number }[];
  costUsd: number | null;
  unreadable: { agent: PatternAgent; reason: string }[];
}

export type PatternsStage = "reading" | "analyzing" | "checking";

export interface PatternsProgress {
  stage: PatternsStage;
  prompts: number;
  sessions: number;
}

export interface PatternsState {
  patterns: Pattern[];
  lastRun: PatternsRun | null;
  running: PatternsProgress | null;
}

export interface PatternsDoneEvent {
  cancelled: boolean;
}

export interface PatternsErrorEvent {
  message: string;
}
