/** Rust mirror: `FileKind` in src-tauri/src/scanner/targets.rs */
export type FileKind =
  | "agents-md"
  | "claude-md"
  | "gemini-md"
  | "cursor-rule"
  | "skill"
  | "claude-agent";

const TARGET_LABELS: Record<FileKind, string> = {
  skill: "Skill",
  "claude-agent": "Claude agent",
  "cursor-rule": "Cursor rule",
  "agents-md": "AGENTS.md",
  "claude-md": "CLAUDE.md",
  "gemini-md": "GEMINI.md",
};

export function targetLabel(kind: FileKind): string {
  return TARGET_LABELS[kind] ?? kind;
}

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === "string" && Object.hasOwn(TARGET_LABELS, value);
}
