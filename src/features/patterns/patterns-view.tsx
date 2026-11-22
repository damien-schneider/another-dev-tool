import { Button } from "@ctrl-ui/react/ui/button";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { Spinner } from "@ctrl-ui/react/ui/spinner";
import { Text } from "@ctrl-ui/react/ui/typography";
import { Repeat2 } from "lucide-react";
import { useMemo, useRef } from "react";

import { INSTALL_COMMAND } from "@/features/agent/agent-panel";
import type { SkillDraft } from "@/features/library/new-skill-dialog";
import { useHomeDirectory } from "@/lib/home-dir";
import type { FileRow } from "@/lib/ipc-types";
import type { Pattern, PatternsState } from "@/lib/patterns-ipc-types";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  ViewLayout,
} from "@/shared/components/view-layout";

import { applyChangePrompt, skillDraft } from "./pattern-actions";
import { PatternCard, patternCardId } from "./pattern-card";
import { AGENT_NAMES, formatRun, formatStage } from "./pattern-format";
import { type RunProblem, usePatterns } from "./use-patterns";

function RunStatus({
  state,
  problem,
  stopping,
}: {
  state: PatternsState | null;
  problem: RunProblem | null;
  stopping: boolean;
}) {
  if (state === null) {
    return <Skeleton className="h-5 w-80 max-w-full" />;
  }
  if (state.running) {
    return (
      <Text as="p" className="flex items-center gap-2">
        <Spinner aria-hidden="true" />
        {stopping ? "Stopping…" : formatStage(state.running)}
      </Text>
    );
  }
  if (problem) {
    return (
      <Text as="p" tone="danger">
        {problem.type === "missing"
          ? `Claude Code isn’t installed. Install it from a terminal with ${INSTALL_COMMAND}, then try again.`
          : `The analysis stopped: ${problem.message}`}
      </Text>
    );
  }
  if (state.lastRun) {
    return (
      <>
        <Text as="p" numeric tone="muted">
          {formatRun(state.lastRun)}
        </Text>
        {state.lastRun.unreadable.map(({ agent, reason }) => (
          <Text as="p" key={agent} tone="warning">
            {`Couldn’t read ${AGENT_NAMES[agent]}: ${reason}`}
          </Text>
        ))}
      </>
    );
  }
  return (
    <Text as="p" tone="muted">
      One Claude Opus run reads your recent prompts and suggests a rule or skill
      for what you keep asking. It takes a few minutes.
    </Text>
  );
}

export function PatternsView({
  files,
  onOpenInEditor,
  onCreateSkill,
}: {
  files: readonly FileRow[];
  onOpenInEditor: (file: FileRow, prompt: string) => void;
  onCreateSkill: (draft: SkillDraft) => void;
}) {
  const home = useHomeDirectory();
  const {
    state,
    loadError,
    problem,
    stopping,
    reload,
    analyze,
    cancel,
    dismiss,
  } = usePatterns();
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files]
  );

  if (loadError !== null && state === null) {
    return (
      <ViewLayout title="Patterns">
        <ErrorState message={loadError} onRetry={reload} />
      </ViewLayout>
    );
  }

  const running = state?.running ?? null;
  const lastRun = state?.lastRun ?? null;
  const patterns = state?.patterns ?? [];

  const dismissCard = async (pattern: Pattern) => {
    const index = patterns.indexOf(pattern);
    const neighbour = patterns[index + 1] ?? patterns[index - 1];
    await dismiss(pattern.id);
    const next = neighbour
      ? document.getElementById(patternCardId(neighbour.id))
      : runButtonRef.current;
    next?.focus();
  };

  let runLabel = "Analyze";
  if (problem) {
    runLabel = "Try again";
  } else if (lastRun) {
    runLabel = "Analyze again";
  }

  return (
    <ViewLayout title="Patterns">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <output className="min-w-0">
          <RunStatus problem={problem} state={state} stopping={stopping} />
        </output>
        {running ? (
          <Button
            disabled={stopping}
            onClick={cancel}
            ref={runButtonRef}
            size="sm"
            variant="surface"
          >
            Stop
          </Button>
        ) : (
          <Button
            disabled={state === null}
            onClick={analyze}
            ref={runButtonRef}
            size="sm"
            tone={lastRun ? "neutral" : "primary"}
            variant={lastRun ? "surface" : "solid"}
          >
            {runLabel}
          </Button>
        )}
      </div>

      {state === null ? <ListSkeleton rows={3} /> : null}

      {lastRun && !running && patterns.length === 0 ? (
        <EmptyState
          description="Nothing you typed came up often enough to belong in a rule or skill."
          icon={Repeat2}
          title="No patterns"
        />
      ) : null}

      {patterns.length > 0 ? (
        <div className="divide-border flex flex-col divide-y">
          {patterns.map((pattern) => {
            const file =
              pattern.target === null
                ? undefined
                : filesByPath.get(pattern.target);
            return (
              <PatternCard
                home={home}
                key={pattern.id}
                onCreateSkill={
                  pattern.kind === "skill" && pattern.target === null
                    ? () => onCreateSkill(skillDraft(pattern.change))
                    : undefined
                }
                onDismiss={() => dismissCard(pattern)}
                onOpenInEditor={
                  file
                    ? () => onOpenInEditor(file, applyChangePrompt(pattern))
                    : undefined
                }
                pattern={pattern}
              />
            );
          })}
        </div>
      ) : null}
    </ViewLayout>
  );
}
