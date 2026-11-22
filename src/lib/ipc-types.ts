import type { FileKind } from "@/lib/agent-files/scan-targets";

export type { FileKind } from "@/lib/agent-files/scan-targets";

/** Mirrors src-tauri/src/error.rs */
export type AppErrorCode =
  | "not_found"
  | "invalid_path"
  | "invalid_input"
  | "outside_roots"
  | "conflict"
  | "scan_busy"
  | "agent_busy"
  | "agent_missing"
  | "analysis_busy"
  | "io"
  | "db"
  | "internal";

export interface AppErrorPayload {
  code: AppErrorCode;
  message: string;
}

/** Mirrors db::roots_repo::Root */
export interface Root {
  id: number;
  path: string;
  enabled: boolean;
  addedAt: number;
}

/** Mirrors db::favorite_projects_repo::FavoriteProject */
export interface FavoriteProject {
  path: string;
  createdAt: number;
}

/** Mirrors commands::destinations::DestinationFolder */
export interface DestinationFolder {
  path: string;
  favorite: boolean;
  lastUsedAt: number | null;
  fileCount: number;
  available: boolean;
}

export interface PromptAttachment {
  id: number;
  promptId: number;
  path: string;
  mimeType: string;
  width: number;
  height: number;
}

/** Mirrors db::prompts_repo::PromptHistoryEntry */
export interface PromptHistoryEntry {
  id: number;
  content: string;
  destinationPath: string | null;
  createdAt: number;
  attachments: PromptAttachment[];
}

export interface CaptureAccessStatus {
  supported: boolean;
  granted: boolean;
}

export interface CaptureErrorEvent {
  message: string;
}

export interface CaptureShortcutProgress {
  completedTaps: 1 | 2;
}

/** Mirrors db::files_repo::FileRow */
export interface FileRow {
  id: number;
  rootId: number;
  path: string;
  relPath: string;
  kind: FileKind;
  /** The name other files reference this one by; null for CLAUDE.md-style files */
  name: string | null;
  projectDir: string | null;
  /** The repository `projectDir` checks out when it is a linked git worktree */
  repositoryDir: string | null;
  size: number;
  mtimeNs: number;
  hash: string;
  isSymlink: boolean;
  symlinkTarget: string | null;
  /** YAML frontmatter `description`; null when absent or unreadable */
  description: string | null;
  /** Other absolute paths (symlinks) that reach this same file */
  aliases: string[];
  firstSeenAt: number;
  lastSeenScanId: number | null;
  deletedAt: number | null;
}

/** Mirrors db::links_repo::FileLinks */
export interface FileLinks {
  outgoing: FileRow[];
  incoming: FileRow[];
}

/** Mirrors fsops::FolderEntry */
export interface FolderEntry {
  name: string;
  /** Reached through the listed folder, never resolved through its symlinks */
  path: string;
  isDir: boolean;
  isSymlink: boolean;
}

/** Mirrors db::files_repo::DuplicateGroup */
export interface DuplicateGroup {
  hash: string;
  files: FileRow[];
}

/** Mirrors managed_by::ManagedBy */
export type ManagedBy =
  | { tool: "npxSkills"; source: string }
  | { tool: "claude" }
  | { tool: "codex" };

/** Mirrors commands::files::FileContent */
export interface FileContent {
  fileId: number;
  path: string;
  content: string;
  hash: string;
  mtimeMs: number;
  isSymlink: boolean;
  symlinkTarget: string | null;
  managedBy: ManagedBy | null;
}

/** Mirrors git::history::FileCommit */
export interface FileCommit {
  hash: string;
  shortHash: string;
  author: string;
  timeMs: number;
  subject: string;
  /** Where the file sits after this commit; `null` when the commit deletes it. */
  path: string | null;
  /** Where the file sat before this commit; `null` when the commit adds it. */
  previousPath: string | null;
}

/** Mirrors git::CommitChange; a missing side is empty. */
export interface CommitChange {
  before: string;
  after: string;
}

/** Mirrors git::working::WorkingState */
export type WorkingState =
  | { state: "clean" }
  | { state: "modified" }
  | { state: "untracked" }
  | { state: "ignored"; source: string; line: number; pattern: string };

/** Mirrors git::history::FileHistory */
export interface FileHistory {
  commits: FileCommit[];
  working: WorkingState;
}

/** Mirrors commands::files::WriteResult */
export interface WriteResult {
  fileId: number;
  hash: string;
  mtimeMs: number;
  size: number;
}

/** Mirrors trash::TrashResult */
export interface TrashResult {
  /** What went to the OS trash: a skill's whole directory, the lone file otherwise */
  trashed: string;
  /** Symlinks that pointed into it and were removed */
  removedLinks: string[];
}

/** Mirrors commands::files::ListFilesArgs */
export interface ListFilesArgs {
  kinds?: FileKind[];
  rootId?: number;
  search?: string;
  includeDeleted?: boolean;
}

/** Mirrors commands::watcher::WatcherStatus */
export interface WatcherStatus {
  enabled: boolean;
  running: boolean;
}

/** Mirrors scanner::ScanStats */
export interface ScanStats {
  seen: number;
  hashed: number;
  added: number;
  changed: number;
  removed: number;
}

export interface ScanProgressEvent extends ScanStats {
  scanId: number;
}

export interface ScanDoneEvent extends ScanStats {
  scanId: number;
  cancelled: boolean;
}

export interface ScanErrorEvent {
  scanId: number;
  code: AppErrorCode;
  message: string;
}

export interface IndexUpdatedEvent {
  fileIds: number[];
}

/** Mirrors db::groups_repo::Strategy */
export type SyncStrategy = "copy" | "symlink";

/** Mirrors sync::apply::MemberStatus */
export type MemberStatus = "in-sync" | "drifted" | "missing" | "symlinked";

/** Mirrors sync::apply::SyncAction */
export type SyncAction = "skip" | "copy" | "symlink" | "create";

/** Mirrors sync::guards::SyncWarning */
export type SyncWarning =
  | "git-tracked"
  | "windows-symlink"
  | "cloud-folder"
  | "existing-symlink";

/** Mirrors sync::diff::DiffResult */
export interface DiffLine {
  op: "equal" | "added" | "removed";
  text: string;
  leftNumber: number | null;
  rightNumber: number | null;
}

export interface DiffResult {
  identical: boolean;
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Mirrors commands::sync::SyncGroupView */
export interface SyncGroupView {
  id: number;
  name: string;
  canonicalFileId: number | null;
  createdAt: number;
  canonical: FileRow | null;
  members: SyncMemberView[];
}

export interface SyncMemberView {
  file: FileRow;
  strategy: SyncStrategy;
  baselineHash: string | null;
  status: MemberStatus;
}

/** Mirrors sync::apply::MemberPlan */
export interface MemberPlan {
  fileId: number;
  path: string;
  relPath: string;
  strategy: SyncStrategy;
  status: MemberStatus;
  action: SyncAction;
  warnings: SyncWarning[];
  diff: DiffResult | null;
}

/** Mirrors sync::apply::SyncPreview */
export interface SyncPreview {
  groupId: number;
  groupName: string;
  canonicalFileId: number;
  canonicalPath: string;
  token: string;
  members: MemberPlan[];
}

/** Mirrors sync::apply::ApplyResult */
export interface ApplyResult {
  updatedFileIds: number[];
  backupIds: number[];
  skipped: number;
}

/** Mirrors db::backups_repo::Backup */
export interface Backup {
  id: number;
  fileId: number | null;
  originalPath: string;
  backupPath: string;
  hash: string;
  createdAt: number;
}

/** Mirrors commands::install::InstallResult */
export interface InstallResult {
  written: string[];
  skipped: string[];
  fileIds: number[];
}
