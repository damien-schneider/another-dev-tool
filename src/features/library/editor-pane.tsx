import {
  ChatWorkspace,
  ChatWorkspaceMain,
} from "@ctrl-ui/react/chat-workspace";
import { Button } from "@ctrl-ui/react/ui/button";
import { Kbd } from "@ctrl-ui/react/ui/kbd";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@ctrl-ui/react/ui/resizable";
import { Spinner } from "@ctrl-ui/react/ui/spinner";
import { Text } from "@ctrl-ui/react/ui/typography";
import { FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentPanel } from "@/features/agent/agent-panel";
import type { UseAgentSession } from "@/features/agent/use-agent-session";
import { HistoryPanel } from "@/features/history/history-panel";
import { MentionPreview } from "@/features/links/mention-preview";
import { useFileLinks } from "@/features/links/use-file-links";
import { useSkillMentions } from "@/features/links/use-skill-mentions";
import { scanSummary } from "@/features/scan/scan-status";
import type { UseScan } from "@/features/scan/use-scan";
import type { FileRow } from "@/lib/ipc-types";
import { EmptyState } from "@/shared/components/view-layout";
import { DocumentBody } from "./editor/document-body";
import {
  ConflictDialog,
  ReviewChangesDialog,
  TrashDialog,
} from "./editor/editor-dialogs";
import { EditorHeader } from "./editor/editor-header";
import { EditorNotices } from "./editor/editor-notices";
import { useEditorSelection } from "./editor/use-editor-selection";
import { fileTitle } from "./library-model";
import type { UseFileContent } from "./use-file-content";
import type { UseSidePanel } from "./use-side-panel";

export interface EditorPaneProps {
  agent: UseAgentSession;
  editor: UseFileContent;
  favorite: boolean;
  file: FileRow | null;
  /** False while the library holds nothing to open, which changes what the empty pane suggests. */
  hasFiles: boolean;
  /** Called once the open file no longer exists, after it went to the Trash. */
  onClose: () => void;
  onNewSkill: () => void;
  /** Re-reads every library folder from disk; its outcome shows while nothing is open. */
  scan: UseScan;
  onOpenFile: (file: FileRow) => void;
  openedThroughLink: string | null;
  onShowOriginal: () => void;
  onToggleFavorite: (path: string) => Promise<void>;
  sidePanel: UseSidePanel;
}

const SIDE_PANEL_WIDTH_STORAGE_KEY = "another-dev-tool.agent-panel-width";
const SIDE_PANEL_DEFAULT_WIDTH = 384;
const AGENT_DOCKED_STORAGE_KEY = "another-dev-tool.agent-docked";
const AGENT_DOCKED_WIDTH_STORAGE_KEY = "another-dev-tool.agent-docked-width";

function readStoredWidth(key: string) {
  return Number(window.localStorage.getItem(key)) || SIDE_PANEL_DEFAULT_WIDTH;
}

function NothingOpen({
  hasFiles,
  onNewSkill,
  scan,
}: {
  hasFiles: boolean;
  onNewSkill: () => void;
  scan: UseScan;
}) {
  const failed = !scan.running && scan.error !== null;
  const scannedOnce = scan.running || scan.lastResult !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="h-(--titlebar-height) shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 items-center justify-center pb-(--titlebar-height)">
        <EmptyState
          action={
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  disabled={scan.running}
                  onClick={() => {
                    scan.start();
                  }}
                  size="sm"
                  variant="surface"
                >
                  {scan.running ? (
                    <Spinner />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  {scan.running ? "Scanning…" : "Scan folders"}
                </Button>
                <Button onClick={onNewSkill} size="sm" variant="surface">
                  New skill
                  <Kbd>⌘N</Kbd>
                </Button>
              </div>
              {failed ? (
                <Text as="p" role="alert" size="caption" tone="danger">
                  {scan.error}
                </Text>
              ) : null}
              {!failed && scannedOnce ? (
                <Text
                  aria-live="polite"
                  as="p"
                  numeric
                  size="caption"
                  tone="muted"
                >
                  {scanSummary(scan)}
                </Text>
              ) : null}
            </div>
          }
          description={
            hasFiles
              ? "Pick a file in the library, or press ⌘K to search everything."
              : "Scan your folders for skills, or write your first one."
          }
          icon={FileText}
          title={hasFiles ? "Nothing open" : "No files yet"}
        />
      </div>
    </div>
  );
}

export function EditorPane({
  agent,
  editor,
  favorite,
  file,
  hasFiles,
  onClose,
  onNewSkill,
  scan,
  onOpenFile,
  openedThroughLink,
  onShowOriginal,
  onToggleFavorite,
  sidePanel,
}: EditorPaneProps) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [sidePanelWidth] = useState(() =>
    readStoredWidth(SIDE_PANEL_WIDTH_STORAGE_KEY)
  );
  const [agentDocked] = useState(
    () => window.localStorage.getItem(AGENT_DOCKED_STORAGE_KEY) === "true"
  );
  const [agentWidth] = useState(() =>
    readStoredWidth(AGENT_DOCKED_WIDTH_STORAGE_KEY)
  );
  const links = useFileLinks(file?.id ?? null);
  const mentions = useSkillMentions({
    targets: links.outgoing,
    onOpen: onOpenFile,
  });
  const editorSelection = useEditorSelection({
    mode: editor.mode,
    revision: editor.revision,
    split: editor.buffer?.split ?? null,
  });

  // Closing or reloading the window is the one way to lose edits without being asked.
  useEffect(() => {
    if (!editor.dirty) {
      return;
    }
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventAccidentalClose);
    return () => {
      window.removeEventListener("beforeunload", preventAccidentalClose);
    };
  }, [editor.dirty]);

  if (!file) {
    return (
      <NothingOpen hasFiles={hasFiles} onNewSkill={onNewSkill} scan={scan} />
    );
  }

  return (
    <>
      <ResizablePanelGroup variant="nested">
        <ResizablePanel className="flex" id="document" minSize="20rem">
          <ChatWorkspace
            className="min-w-0 flex-1"
            defaultDocked={agentDocked}
            defaultExpanded={false}
            defaultPanelWidth={agentWidth}
            onDockedChange={(docked) =>
              window.localStorage.setItem(
                AGENT_DOCKED_STORAGE_KEY,
                String(docked)
              )
            }
            onPanelWidthChange={(width) =>
              window.localStorage.setItem(
                AGENT_DOCKED_WIDTH_STORAGE_KEY,
                String(width)
              )
            }
          >
            <ChatWorkspaceMain className="flex">
              <section
                aria-label={fileTitle(file)}
                className="flex min-w-0 flex-1 flex-col"
              >
                <EditorHeader
                  editor={editor}
                  favorite={favorite}
                  file={file}
                  onReview={() => setReviewOpen(true)}
                  onToggleFavorite={onToggleFavorite}
                  onToggleSidePanel={sidePanel.toggle}
                  onTrash={() => setTrashOpen(true)}
                  sidePanel={sidePanel.panel}
                />
                <EditorNotices
                  editor={editor}
                  onShowOriginal={onShowOriginal}
                  openedThroughLink={openedThroughLink}
                />
                <DocumentBody
                  editor={editor}
                  file={file}
                  links={links}
                  mentions={mentions}
                  onOpenFile={onOpenFile}
                  onSelectionChange={editorSelection.select}
                />
                <MentionPreview mentions={mentions} />
              </section>
            </ChatWorkspaceMain>
            {sidePanel.panel === "agent" ? (
              <AgentPanel
                documentText={editor.documentText}
                file={file}
                onApply={(text) => {
                  editor.editAnyway();
                  editor.replaceDocument(text);
                }}
                onClose={() => sidePanel.toggle("agent")}
                onRemoveSelection={editorSelection.clear}
                selection={editorSelection.selection}
                session={agent}
              />
            ) : null}
          </ChatWorkspace>
        </ResizablePanel>
        {sidePanel.panel === "history" ? (
          <>
            <ResizableHandle
              aria-label="Resize History panel"
              variant="hover"
            />
            <ResizablePanel
              className="flex"
              defaultSize={sidePanelWidth}
              groupResizeBehavior="preserve-pixel-size"
              id="side"
              maxSize="40rem"
              minSize="18rem"
              onResize={(size) =>
                window.localStorage.setItem(
                  SIDE_PANEL_WIDTH_STORAGE_KEY,
                  String(Math.round(size.inPixels))
                )
              }
            >
              <HistoryPanel
                fileId={file.id}
                onClose={() => sidePanel.toggle("history")}
                savedHash={editor.buffer?.content.hash ?? null}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      <ReviewChangesDialog
        editor={editor}
        onOpenChange={setReviewOpen}
        open={reviewOpen}
      />
      <ConflictDialog editor={editor} file={file} />
      <TrashDialog
        dirty={editor.dirty}
        file={file}
        onOpenChange={setTrashOpen}
        onTrashed={onClose}
        open={trashOpen}
      />
    </>
  );
}
