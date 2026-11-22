import { toast } from "@ctrl-ui/react/ui/toast";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import {
  onPatternsDone,
  onPatternsError,
  onPatternsProgress,
} from "@/lib/events";
import {
  patternsAnalyze,
  patternsCancel,
  patternsDismiss,
  patternsState,
  toIpcError,
} from "@/lib/ipc";
import type { PatternsProgress, PatternsState } from "@/lib/patterns-ipc-types";

export type RunProblem =
  | { type: "missing" }
  | { type: "failed"; message: string };

const STARTING: PatternsProgress = {
  stage: "reading",
  prompts: 0,
  sessions: 0,
};

const withRunning =
  (running: PatternsProgress | null) => (current: PatternsState | null) =>
    current && { ...current, running };

export function usePatterns() {
  const [state, setState] = useState<PatternsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<RunProblem | null>(null);
  const [stopping, setStopping] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await patternsState());
      setLoadError(null);
    } catch (cause) {
      setLoadError(toIpcError(cause).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const subscriptions = Promise.all([
      onPatternsProgress((progress) => setState(withRunning(progress))),
      onPatternsDone(() => {
        setStopping(false);
        reload();
      }),
      onPatternsError(({ message }) => {
        setStopping(false);
        setState(withRunning(null));
        setProblem({ type: "failed", message });
      }),
    ]);
    return () => {
      subscriptions.then((stops) => {
        for (const stop of stops) {
          stop();
        }
      });
    };
  }, [reload]);

  const analyze = useCallback(async () => {
    setProblem(null);
    setState(
      (current) =>
        current && { ...current, running: current.running ?? STARTING }
    );
    try {
      await patternsAnalyze();
    } catch (cause) {
      const error = toIpcError(cause);
      if (error.code === "analysis_busy") {
        await reload();
        return;
      }
      setState(withRunning(null));
      setProblem(
        error.code === "agent_missing"
          ? { type: "missing" }
          : { type: "failed", message: error.message }
      );
    }
  }, [reload]);

  const cancel = useCallback(async () => {
    setStopping(true);
    try {
      await patternsCancel();
    } catch (cause) {
      setStopping(false);
      toast.error("Could not stop the analysis", {
        description: toIpcError(cause).message,
      });
    }
  }, []);

  const dismiss = useCallback(async (id: number) => {
    await patternsDismiss(id);
    flushSync(() =>
      setState(
        (current) =>
          current && {
            ...current,
            patterns: current.patterns.filter((pattern) => pattern.id !== id),
          }
      )
    );
  }, []);

  return {
    state,
    loadError,
    problem,
    stopping,
    reload,
    analyze,
    cancel,
    dismiss,
  };
}
