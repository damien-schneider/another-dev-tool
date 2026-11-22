import {
  ChatLayout,
  ChatLayoutActions,
  ChatLayoutHeader,
  ChatLayoutTitle,
  ChatThread,
  ChatThreadScrollButton,
} from "@ctrl-ui/react/chat-layout";
import {
  ChatWorkspaceCollapsible,
  ChatWorkspaceDockToggle,
  ChatWorkspaceExpandToggle,
  ChatWorkspacePanel,
  ChatWorkspaceResizeHandle,
  useChatWorkspace,
} from "@ctrl-ui/react/chat-workspace";
import { Button } from "@ctrl-ui/react/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ctrl-ui/react/ui/empty";
import { Text } from "@ctrl-ui/react/ui/typography";
import { SquareTerminal, X } from "lucide-react";
import { useRef, useState } from "react";

import type { FileRow } from "@/lib/ipc-types";
import { IconButton } from "@/shared/components/icon-button";

import { AgentComposer } from "./agent-composer";
import {
  AgentProposal,
  type AppliedChange,
  AppliedNotice,
} from "./agent-proposal";
import { AGENT_SETTINGS_SCOPE, useAgentSettings } from "./agent-settings";
import { AgentTranscript } from "./agent-transcript";
import { ConversationHistory } from "./conversation-history";
import type { AgentRequest, UseAgentSession } from "./use-agent-session";

export interface AgentPanelProps {
  file: FileRow;
  session: UseAgentSession;
  documentText: string;
  onApply: (text: string) => void;
  onClose: () => void;
}

const EXAMPLES = [
  {
    label: "Tighten the description",
    prompt:
      "Tighten the description: one or two sentences that say what this does and when to use it.",
  },
  {
    label: "Restructure into steps",
    prompt:
      "Restructure the instructions into clear, numbered steps without changing their meaning.",
  },
  {
    label: "Add a “When to use” section",
    prompt:
      "Add a short “When to use” section listing the situations this applies to.",
  },
] as const;

export const INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

export function ClaudeCodeMissing({ madeBy }: { madeBy: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <SquareTerminal />
        </EmptyMedia>
        <EmptyTitle>Claude Code isn’t installed</EmptyTitle>
        <EmptyDescription>
          {madeBy} by the Claude Code command-line tool, which wasn’t found on
          this Mac. Install it from a terminal, then restart Another Dev Tool.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Text as="code" className="select-all" mono size="label">
          {INSTALL_COMMAND}
        </Text>
      </EmptyContent>
    </Empty>
  );
}

function AgentIntro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>
          Describe the change you want. You review it as a diff before it
          touches the file.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="gap-2">
        {EXAMPLES.map((example) => (
          <Button
            key={example.label}
            onClick={() => onPick(example.prompt)}
            size="sm"
            variant="surface"
          >
            {example.label}
          </Button>
        ))}
      </EmptyContent>
    </Empty>
  );
}

function AgentConversation({
  file,
  session,
  documentText,
  onApply,
}: Omit<AgentPanelProps, "onClose">) {
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const shownConversation = `${file.id}/${session.conversationId ?? ""}`;
  const [appliedIn, setAppliedIn] = useState(shownConversation);
  if (appliedIn !== shownConversation) {
    setAppliedIn(shownConversation);
    setApplied(null);
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [settings, setSettings] = useAgentSettings(AGENT_SETTINGS_SCOPE);
  const workspace = useChatWorkspace();

  const proposed =
    session.proposal !== null && session.proposal !== documentText
      ? session.proposal
      : null;
  const lastAsked = session.messages.findLast(
    (message) => message.role === "you"
  );
  const hasTranscript = session.messages.length > 0;
  const untouched =
    !(hasTranscript || session.running) &&
    session.error === null &&
    proposed === null;

  const ask = async (request: AgentRequest) => {
    setApplied(null);
    workspace.setExpanded(true);
    await session.send(request, documentText, settings);
  };

  const fillComposer = (example: string) => {
    session.setDraft(example);
    textareaRef.current?.focus();
  };

  return (
    <ChatThread
      composer={
        <>
          <ChatThreadScrollButton />
          <AgentComposer
            file={file}
            includesFile={session.includesFile}
            onAddReference={session.addReference}
            onIncludeFileChange={session.includeFile}
            onRemoveReference={session.removeReference}
            onSend={ask}
            onSettingsChange={setSettings}
            onStop={async () => {
              await session.cancel();
            }}
            onValueChange={session.setDraft}
            references={session.references}
            running={session.running}
            settings={settings}
            textareaRef={textareaRef}
            value={session.draft}
          />
        </>
      }
    >
      <ChatWorkspaceCollapsible>
        {untouched ? <AgentIntro onPick={fillComposer} /> : null}
        <AgentTranscript
          error={session.error}
          messages={session.messages}
          onRetry={
            lastAsked === undefined
              ? undefined
              : async () => {
                  await ask({
                    prompt: lastAsked.text,
                    images: lastAsked.images,
                  });
                }
          }
          running={session.running}
        />
        {proposed === null ? null : (
          <AgentProposal
            after={proposed}
            before={documentText}
            onApply={() => {
              onApply(proposed);
              session.dismissProposal();
              setApplied({
                before: documentText,
                after: proposed,
                undone: false,
              });
            }}
            onDismiss={session.dismissProposal}
          />
        )}
        {applied && hasTranscript && !session.running ? (
          <AppliedNotice
            change={applied}
            documentText={documentText}
            onReapply={() => {
              onApply(applied.after);
              setApplied({ ...applied, undone: false });
            }}
            onUndo={() => {
              onApply(applied.before);
              setApplied({ ...applied, undone: true });
            }}
          />
        ) : null}
      </ChatWorkspaceCollapsible>
    </ChatThread>
  );
}

export function AgentPanel({
  file,
  session,
  documentText,
  onApply,
  onClose,
}: AgentPanelProps) {
  const workspace = useChatWorkspace();
  const docked = workspace.presentation === "docked";

  return (
    <ChatWorkspacePanel aria-label="Ask Claude">
      <ChatLayout chrome="embedded">
        <ChatLayoutHeader
          className={docked ? "h-(--titlebar-height) shrink-0" : "shrink-0"}
          data-tauri-drag-region={docked ? "deep" : undefined}
        >
          <ChatWorkspaceExpandToggle />
          {/* biome-ignore lint/a11y/useHeadingContent: the title's children become the heading's content */}
          <ChatLayoutTitle render={<h2 />}>Ask Claude</ChatLayoutTitle>
          <ChatLayoutActions>
            {session.available ? (
              <ConversationHistory
                heading="About this file"
                session={{
                  ...session,
                  openConversation: (id) => {
                    workspace.setExpanded(true);
                    session.openConversation(id);
                  },
                }}
              />
            ) : null}
            <ChatWorkspaceDockToggle />
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </ChatLayoutActions>
        </ChatLayoutHeader>
        {session.available ? (
          <AgentConversation
            documentText={documentText}
            file={file}
            onApply={onApply}
            session={session}
          />
        ) : (
          <ClaudeCodeMissing madeBy="Edits here are made" />
        )}
      </ChatLayout>
      <ChatWorkspaceResizeHandle />
    </ChatWorkspacePanel>
  );
}
