import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ctrl-ui/react/ui/accordion";
import { ScrollArea } from "@ctrl-ui/react/ui/scroll-area";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { Heading, Text } from "@ctrl-ui/react/ui/typography";
import { EyeOff, GitBranch, History, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";

import {
  formatDateTime,
  formatRelativeTime,
  useMinuteClock,
} from "@/features/prompts/relative-time";
import { fileCommitChange, fileHistory, fileWorkingChange } from "@/lib/ipc";
import type {
  CommitChange,
  FileCommit,
  FileHistory,
  WorkingState,
} from "@/lib/ipc-types";
import { DiffView } from "@/shared/components/diff-view";
import { IconButton } from "@/shared/components/icon-button";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/shared/components/view-layout";

import { useLoad } from "./use-load";

function ChangeDiff({ load }: { load: () => Promise<CommitChange> }) {
  const { state } = useLoad(load);

  if (state.status === "loading") {
    return <Skeleton className="h-24" />;
  }
  if (state.status === "error") {
    return (
      <Text as="p" role="alert" size="caption" tone="danger">
        {state.error.message}
      </Text>
    );
  }
  return (
    <DiffView
      after={state.value.after}
      before={state.value.before}
      className="max-h-96"
    />
  );
}

function CommitDiff({
  commit,
  fileId,
}: {
  commit: FileCommit;
  fileId: number;
}) {
  const { hash, path, previousPath } = commit;
  const load = useCallback(
    () => fileCommitChange(fileId, { hash, path, previousPath }),
    [fileId, hash, path, previousPath]
  );
  return <ChangeDiff load={load} />;
}

function WorkingDiff({ fileId }: { fileId: number }) {
  const load = useCallback(() => fileWorkingChange(fileId), [fileId]);
  return <ChangeDiff load={load} />;
}

function ignoredReason({
  source,
  line,
  pattern,
}: Extract<WorkingState, { state: "ignored" }>) {
  return `Excluded by ${pattern} in ${source}, line ${line}. Git records none of its changes.`;
}

function HistoryList({
  history: { commits, working },
  fileId,
  savedHash,
}: {
  history: FileHistory;
  fileId: number;
  savedHash: string | null;
}) {
  const now = useMinuteClock();
  const workingLabel = {
    modified: "Uncommitted changes",
    untracked: "Not committed yet",
    clean: null,
    ignored: null,
  }[working.state];
  return (
    <div className="flex flex-col gap-2">
      {working.state === "ignored" ? (
        <Text as="p" size="caption" tone="muted">
          {ignoredReason(working)}
        </Text>
      ) : null}
      <Accordion>
        {workingLabel ? (
          <AccordionItem value="working">
            <AccordionTrigger>{workingLabel}</AccordionTrigger>
            <AccordionPanel>
              <WorkingDiff fileId={fileId} key={savedHash} />
            </AccordionPanel>
          </AccordionItem>
        ) : null}
        {commits.map((commit) => (
          <AccordionItem key={commit.hash} value={commit.hash}>
            <AccordionTrigger>
              <span className="flex min-w-0 flex-col gap-0.5 text-left">
                <span className="line-clamp-2">{commit.subject}</span>
                <Text as="span" numeric size="caption" tone="muted">
                  {commit.author} ·{" "}
                  <time
                    dateTime={new Date(commit.timeMs).toISOString()}
                    title={formatDateTime(commit.timeMs)}
                  >
                    {formatRelativeTime(commit.timeMs, now)}
                  </time>{" "}
                  ·{" "}
                  <Text as="span" mono size="caption">
                    {commit.shortHash}
                  </Text>
                </Text>
              </span>
            </AccordionTrigger>
            <AccordionPanel>
              <CommitDiff commit={commit} fileId={fileId} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

export function HistoryPanel({
  fileId,
  savedHash,
  onClose,
}: {
  fileId: number;
  savedHash: string | null;
  onClose: () => void;
}) {
  const headingId = useId();
  const load = useCallback(() => fileHistory(fileId), [fileId]);
  const { state, reload } = useLoad(load);
  const loadedHash = useRef(savedHash);

  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  useEffect(() => {
    if (loadedHash.current !== savedHash) {
      loadedHash.current = savedHash;
      reload();
    }
  }, [savedHash, reload]);

  let body: ReactNode;
  if (state.status === "loading") {
    body = <ListSkeleton />;
  } else if (state.status === "error" && state.error.code === "not_found") {
    body = (
      <EmptyState
        description={state.error.message}
        icon={GitBranch}
        title="No history"
      />
    );
  } else if (state.status === "error") {
    body = <ErrorState message={state.error.message} onRetry={reload} />;
  } else if (
    state.value.commits.length === 0 &&
    state.value.working.state === "ignored"
  ) {
    body = (
      <EmptyState
        description={ignoredReason(state.value.working)}
        icon={EyeOff}
        title="Ignored by git"
      />
    );
  } else if (
    state.value.commits.length === 0 &&
    state.value.working.state === "clean"
  ) {
    body = (
      <EmptyState
        description="Its history starts with the first commit that includes it."
        icon={History}
        title="No commits yet"
      />
    );
  } else {
    body = (
      <HistoryList
        fileId={fileId}
        history={state.value}
        savedHash={savedHash}
      />
    );
  }

  return (
    <aside aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col">
      <header
        className="flex h-(--titlebar-height) shrink-0 items-center gap-2 border-b px-4"
        data-tauri-drag-region="deep"
      >
        <Heading
          className="min-w-0 flex-1"
          id={headingId}
          level={2}
          size="label"
        >
          History
        </Heading>
        <IconButton label="Close" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
        {body}
      </ScrollArea>
    </aside>
  );
}
