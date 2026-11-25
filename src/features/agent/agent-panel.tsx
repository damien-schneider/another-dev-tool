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
} from "@ctrl-ui/react/ui/empty";
import { Text } from "@ctrl-ui/react/ui/typography";
import { X } from "lucide-react";
import { useRef, useState } from "react";

import type { FileRow } from "@/lib/ipc-types";
import type { TextSelection } from "@/lib/text-selection";
import { IconButton } from "@/shared/components/icon-button";

import { AgentComposer } from "./agent-composer";
import { SignInNotice, StartFailedNotice } from "./agent-picker/agent-notices";
import { AgentPicker } from "./agent-picker/agent-picker";
import type { AgentChoice } from "./agent-picker/use-agent-choice";
import {
  AgentProposal,
  type AppliedChange,
  AppliedNotice,
  FileSuggestion,
  suggestionName,
} from "./agent-proposal";
import { AgentTranscript } from "./agent-transcript";
import { ConversationHistory } from "./conversation-history";
import type { AgentRequest, UseAgentSession } from "./use-agent-session";

export interface AgentPanelProps {
  file: FileRow;
  session: UseAgentSession;
  documentText: string;
  onApply: (text: string) => void;
  onClose: () => void;
  selection: TextSelection | null;
  onRemoveSelection: () => void;
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

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

function containmentCaveat(agent: AgentChoice): string | null {
  if (agent.listing?.hardened !== false) {
    return null;
  }
  const kept = agent.listings
    .filter((listing) => listing.hardened)
    .map((listing) => listing.name);
  return `Only ${LIST.format(kept)} ${kept.length === 1 ? "is" : "are"} fully kept to this file. ${agent.name} is held back only when it asks for permission.`;
}

function AgentIntro({
  onPick,
  caveat,
}: {
  onPick: (prompt: string) => void;
  caveat: string | null;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>
          Describe the change you want. You review it as a diff before it
          touches the file.
        </EmptyDescription>
        {caveat === null ? null : (
          <Text as="p" size="caption" tone="muted">
            {caveat}
          </Text>
        )}
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
  selection,
  onRemoveSelection,
}: Omit<AgentPanelProps, "onClose">) {
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const shownConversation = `${file.id}/${session.conversationId ?? ""}`;
  const [appliedIn, setAppliedIn] = useState(shownConversation);
  if (appliedIn !== shownConversation) {
    setAppliedIn(shownConversation);
    setApplied(null);
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workspace = useChatWorkspace();
  const { agent } = session;
  const prepared =
    agent.preparing.state === "ready" ? agent.preparing.prepared : null;

  const proposed =
    session.proposals.find(
      (proposal) =>
        proposal.fileId === file.id && proposal.after !== documentText
    )?.after ?? null;
  const elsewhere = session.proposals.filter(
    (proposal) => proposal.fileId !== file.id
  );
  const lastAsked = session.messages.findLast(
    (message) => message.role === "you"
  );
  const hasTranscript = session.messages.length > 0;
  const untouched =
    !(hasTranscript || session.running) &&
    session.error === null &&
    proposed === null &&
    elsewhere.length === 0;

  const ask = async (request: AgentRequest) => {
    setApplied(null);
    workspace.setExpanded(true);
    await session.send(request, documentText);
  };

  const askAgain =
    lastAsked === undefined
      ? undefined
      : async () => {
          await ask({
            prompt: lastAsked.text,
            images: lastAsked.images,
            selection,
          });
        };

  const signedIn = () => {
    agent.refresh();
    if (session.signedOut) {
      askAgain?.();
    }
  };

  const fillComposer = (example: string) => {
    session.setDraft(example);
    textareaRef.current?.focus();
  };

  return (
    <ChatThread
      composer={
        <>
          <ChatThreadScrollButton busy={session.running} />
          <AgentComposer
            agent={agent}
            file={file}
            includesFile={session.includesFile}
            onAddReference={session.addReference}
            onIncludeFileChange={session.includeFile}
            onRemoveReference={session.removeReference}
            onRemoveSelection={onRemoveSelection}
            onSend={ask}
            onStop={async () => {
              await session.cancel();
            }}
            onValueChange={session.setDraft}
            references={session.references}
            running={session.running}
            selection={selection}
            textareaRef={textareaRef}
            value={session.draft}
          />
        </>
      }
    >
      <ChatWorkspaceCollapsible>
        {untouched ? (
          <AgentIntro caveat={containmentCaveat(agent)} onPick={fillComposer} />
        ) : null}
        <AgentTranscript
          error={session.signedOut ? null : session.error}
          messages={session.messages}
          onRetry={askAgain}
          running={session.running}
        />
        {agent.preparing.state === "failed" ? (
          <StartFailedNotice
            message={agent.preparing.message}
            name={agent.name}
            onRetry={agent.refresh}
          />
        ) : null}
        {session.signedOut || prepared?.needsSignIn ? (
          <SignInNotice
            key={agent.agentId}
            methods={prepared?.signIn ?? []}
            name={agent.name}
            onSignedIn={signedIn}
            signIn={agent.signIn}
          />
        ) : null}
        {proposed === null ? null : (
          <AgentProposal
            after={proposed}
            applyLabel="Apply to editor"
            before={documentText}
            name={suggestionName(file.path)}
            note="Applying updates the editor. The file changes on save."
            onApply={() => {
              onApply(proposed);
              session.dismissProposal(file.id);
              setApplied({
                before: documentText,
                after: proposed,
                undone: false,
              });
            }}
            onDismiss={() => session.dismissProposal(file.id)}
          />
        )}
        {elsewhere.map((proposal) => (
          <FileSuggestion
            key={proposal.fileId}
            onDone={() => session.dismissProposal(proposal.fileId)}
            proposal={proposal}
          />
        ))}
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
  selection,
  onRemoveSelection,
}: AgentPanelProps) {
  const workspace = useChatWorkspace();
  const docked = workspace.presentation === "docked";

  return (
    <ChatWorkspacePanel aria-label="Ask">
      <ChatLayout chrome="embedded">
        <ChatLayoutHeader
          className={docked ? "h-(--titlebar-height) shrink-0" : "shrink-0"}
          data-tauri-drag-region={docked ? "deep" : undefined}
        >
          <ChatWorkspaceExpandToggle />
          <ChatLayoutTitle className="flex items-center gap-1" render={<div />}>
            <h2>Ask</h2>
            <AgentPicker choice={session.agent} />
          </ChatLayoutTitle>
          <ChatLayoutActions>
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
            <ChatWorkspaceDockToggle />
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </ChatLayoutActions>
        </ChatLayoutHeader>
        <AgentConversation
          documentText={documentText}
          file={file}
          onApply={onApply}
          onRemoveSelection={onRemoveSelection}
          selection={selection}
          session={session}
        />
      </ChatLayout>
      <ChatWorkspaceResizeHandle />
    </ChatWorkspacePanel>
  );
}
