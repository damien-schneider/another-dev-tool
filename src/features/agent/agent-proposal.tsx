import {
  Activity,
  ActivityIcon,
  ActivityRow,
  ActivityTitle,
} from "@ctrl-ui/react/activity";
import { Button } from "@ctrl-ui/react/ui/button";
import { Text } from "@ctrl-ui/react/ui/typography";
import { useState } from "react";

import type { AgentProposal as AgentProposalData } from "@/lib/agent-ipc-types";
import { toIpcError, writeFile } from "@/lib/ipc";
import { DiffView } from "@/shared/components/diff-view";

export const suggestionName = (path: string) =>
  path.split("/").slice(-2).join("/");

export interface AgentProposalProps {
  name: string;
  before: string;
  after: string;
  note: string;
  applyLabel: string;
  onApply: () => void;
  onDismiss: () => void;
  error?: string | null;
  pending?: boolean;
}

export function AgentProposal({
  name,
  before,
  after,
  note,
  applyLabel,
  onApply,
  onDismiss,
  error = null,
  pending = false,
}: AgentProposalProps) {
  return (
    <section
      aria-label={`Suggested edit to ${name}`}
      className="flex flex-col gap-2"
    >
      <DiffView after={after} before={before} maxHeight="16rem" name={name} />
      {error === null ? null : (
        <Text as="p" role="alert" size="caption" tone="danger">
          {error}
        </Text>
      )}
      <div className="flex items-center justify-between gap-3">
        <Text as="p" size="caption" tone="muted">
          {note}
        </Text>
        <div className="flex shrink-0 gap-2">
          <Button onClick={onDismiss} size="sm" variant="ghost">
            Dismiss
          </Button>
          <Button
            disabled={pending}
            onClick={onApply}
            size="sm"
            tone="primary"
            variant="solid"
          >
            {applyLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

const CHANGED_ON_DISK =
  "This file changed since the suggestion was made, so it was left as it is. Dismiss it, or ask again.";

export function FileSuggestion({
  proposal,
  onDone,
}: {
  proposal: AgentProposalData;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await writeFile(proposal.fileId, proposal.after, proposal.hash);
      onDone();
    } catch (cause) {
      const failed = toIpcError(cause);
      setError(failed.code === "conflict" ? CHANGED_ON_DISK : failed.message);
      setPending(false);
    }
  };

  return (
    <AgentProposal
      after={proposal.after}
      applyLabel="Save to file"
      before={proposal.before}
      error={error}
      name={suggestionName(proposal.path)}
      note="Saving writes the file now."
      onApply={save}
      onDismiss={onDone}
      pending={pending}
    />
  );
}

/** A proposal that went into the editor, kept so it can be taken back out. */
export interface AppliedChange {
  before: string;
  after: string;
  undone: boolean;
}

export interface AppliedNoticeProps {
  change: AppliedChange;
  documentText: string;
  onUndo: () => void;
  onReapply: () => void;
}

/**
 * Undo only shows while the editor still holds exactly what was applied: once the
 * user types, swapping the document back would throw their own edits away.
 */
export function AppliedNotice({
  change,
  documentText,
  onUndo,
  onReapply,
}: AppliedNoticeProps) {
  const expected = change.undone ? change.before : change.after;
  const untouched = documentText === expected;

  return (
    <div className="flex items-center justify-between gap-2">
      <Activity state="success">
        <ActivityRow>
          <ActivityIcon />
          <ActivityTitle>
            {change.undone ? "Change undone" : "Applied to the editor"}
          </ActivityTitle>
        </ActivityRow>
      </Activity>
      {untouched ? (
        <Button
          onClick={change.undone ? onReapply : onUndo}
          size="sm"
          variant="ghost"
        >
          {change.undone ? "Apply again" : "Undo"}
        </Button>
      ) : null}
    </div>
  );
}
