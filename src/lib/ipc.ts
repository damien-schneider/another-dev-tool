import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConversationSummary,
  AgentListing,
  AgentPrepared,
  AgentPromptImage,
  AgentRun,
  AgentRunSettings,
  AgentSignIn,
  AgentStarted,
  AgentStatus,
  AgentStoredMessage,
  AskConversationSummary,
} from "./agent-ipc-types";
import type {
  ExplainLevel,
  ExplainRecentProject,
  ExplainStoredMessage,
  SourceFile,
} from "./explain-ipc-types";
import type {
  AppErrorCode,
  AppErrorPayload,
  ApplyResult,
  Backup,
  CaptureAccessStatus,
  CommitChange,
  DestinationFolder,
  DiffResult,
  DuplicateGroup,
  FavoriteProject,
  FileCommit,
  FileContent,
  FileHistory,
  FileLinks,
  FileRow,
  FolderEntry,
  InstallResult,
  ListFilesArgs,
  PromptHistoryEntry,
  Root,
  SyncGroupView,
  SyncPreview,
  SyncStrategy,
  TrashResult,
  WatcherStatus,
  WriteResult,
} from "./ipc-types";
import type { PatternsState } from "./patterns-ipc-types";
import type { TextSelection } from "./text-selection";

export class IpcError extends Error {
  readonly code: AppErrorCode;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "IpcError";
    this.code = payload.code;
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof IpcError) {
    return error;
  }
  if (isAppErrorPayload(error)) {
    return new IpcError(error);
  }
  return new IpcError({ code: "internal", message: String(error) });
}

async function call<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toIpcError(error);
  }
}

export const listRoots = () => call<Root[]>("list_roots");

export const addRoot = (path: string) => call<Root>("add_root", { path });

export const setRootEnabled = (id: number, enabled: boolean) =>
  call<null>("set_root_enabled", { id, enabled });

export const removeRoot = (id: number) => call<null>("remove_root", { id });

export const listPromptHistory = () =>
  call<PromptHistoryEntry[]>("list_prompt_history");

export const createPrompt = (
  content: string,
  destinationPath: string | null,
  images: PendingPromptImage[]
) =>
  call<PromptHistoryEntry>("create_prompt", {
    content,
    destinationPath,
    images,
  });
export interface PendingPromptImage {
  rgba: number[];
  width: number;
  height: number;
}

export const readPromptAttachment = (attachmentId: number) =>
  call<number[]>("read_prompt_attachment", { attachmentId });

export const deletePrompt = (promptId: number) =>
  call<null>("delete_prompt", { promptId });

export const captureAccessStatus = () =>
  call<CaptureAccessStatus>("capture_access_status");

export const requestCaptureAccess = () =>
  call<CaptureAccessStatus>("request_capture_access");

export const listFavoriteProjects = () =>
  call<FavoriteProject[]>("list_favorite_projects");

export const setProjectFavorite = (path: string, favorite: boolean) =>
  call<null>("set_project_favorite", { path, favorite });

export const listDestinationFolders = () =>
  call<DestinationFolder[]>("list_destination_folders");

export const resolveDestinationFolder = (path: string) =>
  call<DestinationFolder>("resolve_destination_folder", { path });

export const startScan = (rootIds?: number[]) =>
  call<number>("start_scan", { rootIds: rootIds ?? null });

export const cancelScan = () => call<number | null>("cancel_scan");

export const listFiles = (args?: ListFilesArgs) =>
  call<FileRow[]>("list_files", { args: args ?? null });

export const readFile = (fileId: number) =>
  call<FileContent>("read_file", { fileId });

export const writeFile = (
  fileId: number,
  content: string,
  expectedHash: string
) => call<WriteResult>("write_file", { fileId, content, expectedHash });

export const trashFile = (fileId: number) =>
  call<TrashResult>("trash_file", { fileId });

export const listFileLinks = (fileId: number) =>
  call<FileLinks>("list_file_links", { fileId });

export const listFolder = (path: string) =>
  call<FolderEntry[]>("list_folder", { path });

export const fileHistory = (fileId: number) =>
  call<FileHistory>("file_history", { fileId });

export const fileCommitChange = (
  fileId: number,
  commit: Pick<FileCommit, "hash" | "path" | "previousPath">
) =>
  call<CommitChange>("file_commit_change", {
    fileId,
    hash: commit.hash,
    path: commit.path,
    previousPath: commit.previousPath,
  });

export const fileWorkingChange = (fileId: number) =>
  call<CommitChange>("file_working_change", { fileId });

export const agentStatus = () => call<AgentStatus>("agent_status");

export const agentCatalog = () => call<AgentListing[]>("agent_catalog");

export const agentPrepare = (agentId: string) =>
  call<AgentPrepared>("agent_prepare", { agentId });

export const agentSignIn = (agentId: string, methodId: string) =>
  call<AgentSignIn>("agent_sign_in", { agentId, methodId });

export const agentSend = (request: {
  fileId: number;
  conversationId: string | null;
  content: string | null;
  prompt: string;
  images: AgentPromptImage[];
  references: string[];
  selection: TextSelection | null;
  agent: AgentRun;
}) =>
  call<AgentStarted>("agent_send", {
    fileId: request.fileId,
    conversationId: request.conversationId,
    content: request.content,
    prompt: {
      text: request.prompt,
      images: request.images.map(
        ({ name, mediaType, width, height, base64 }) => ({
          name,
          mediaType,
          width,
          height,
          base64,
        })
      ),
      references: request.references,
      selection: request.selection,
    },
    agent: request.agent,
  });

export const agentConversations = () =>
  call<AskConversationSummary[]>("agent_conversations");

export const agentConversation = (conversationId: string) =>
  call<AgentStoredMessage[]>("agent_conversation", { conversationId });

export const agentCancel = () => call<null>("agent_cancel");

export const explainSend = (request: {
  project: string;
  conversationId: string | null;
  text: string;
  level: ExplainLevel;
  settings: AgentRunSettings;
}) => call<AgentStarted>("explain_send", request);

export const explainCancel = () => call<null>("explain_cancel");

export const explainConversations = (project: string) =>
  call<AgentConversationSummary[]>("explain_conversations", { project });

export const explainConversation = (conversationId: string) =>
  call<ExplainStoredMessage[]>("explain_conversation", { conversationId });

export const explainRecentProjects = () =>
  call<ExplainRecentProject[]>("explain_recent_projects");

export const explainReadSource = (project: string, path: string) =>
  call<SourceFile>("explain_read_source", { project, path });

export const listDuplicates = () => call<DuplicateGroup[]>("list_duplicates");

export const patternsState = () => call<PatternsState>("patterns_state");

export const patternsAnalyze = () => call<null>("patterns_analyze");

export const patternsCancel = () => call<null>("patterns_cancel");

export const patternsDismiss = (id: number) =>
  call<null>("patterns_dismiss", { id });

export const getWatcherStatus = () => call<WatcherStatus>("get_watcher_status");

export const setWatcherEnabled = (enabled: boolean) =>
  call<WatcherStatus>("set_watcher_enabled", { enabled });

export const listSyncGroups = () => call<SyncGroupView[]>("list_sync_groups");

export const createSyncGroup = (args: {
  name: string;
  canonicalFileId: number;
  memberFileIds?: number[];
  strategy?: SyncStrategy;
}) => call<number>("create_sync_group", { ...args });

export const setCanonical = (groupId: number, fileId: number) =>
  call<null>("set_canonical", { groupId, fileId });

export const addMembers = (
  groupId: number,
  fileIds: number[],
  strategy: SyncStrategy
) => call<null>("add_members", { groupId, fileIds, strategy });

export const removeMember = (groupId: number, fileId: number) =>
  call<null>("remove_member", { groupId, fileId });

export const deleteSyncGroup = (groupId: number) =>
  call<null>("delete_sync_group", { groupId });

export const previewSync = (groupId: number) =>
  call<SyncPreview>("preview_sync", { groupId });

export const applySync = (groupId: number, token: string) =>
  call<ApplyResult>("apply_sync", { groupId, token });

export const listBackups = (fileId?: number) =>
  call<Backup[]>("list_backups", { fileId: fileId ?? null });

export const restoreBackup = (backupId: number) =>
  call<number>("restore_backup", { backupId });

export const diffFiles = (leftFileId: number, rightFileId: number) =>
  call<DiffResult>("diff_files", { leftFileId, rightFileId });

export const installFiles = (
  entries: { path: string; content: string }[],
  overwrite: boolean
) => call<InstallResult>("install_files", { entries, overwrite });
