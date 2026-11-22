import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentConversationSummary,
  AgentPart,
  AgentRunSettings,
} from "@/lib/agent-ipc-types";
import {
  onAgentDelta,
  onAgentDone,
  onAgentError,
  onAgentPart,
} from "@/lib/events";
import type {
  ExplainLevel,
  ExplainStoredMessage,
} from "@/lib/explain-ipc-types";
import {
  agentStatus,
  explainCancel,
  explainConversation,
  explainConversations,
  explainSend,
  toIpcError,
} from "@/lib/ipc";

import { append, place } from "../agent/agent-live";
import type { AgentMessage } from "../agent/use-agent-session";

export interface ExplainRequest {
  text: string;
  level: ExplainLevel;
  settings: AgentRunSettings;
}

interface View {
  project: string | null;
  conversationId: string | null;
}

interface LiveRun {
  view: View;
  runId: number | null;
  parts: AgentPart[];
  done: boolean;
}

export interface UseExplainSession {
  available: boolean;
  conversations: AgentConversationSummary[];
  conversationId: string | null;
  openConversation: (conversationId: string) => void;
  newConversation: () => void;
  messages: AgentMessage[];
  running: boolean;
  error: string | null;
  /** Absent until something was asked in this conversation. */
  retry: (() => void) | undefined;
  ask: (request: ExplainRequest) => Promise<void>;
  cancel: () => Promise<void>;
}

const BUSY_ELSEWHERE =
  "Still explaining in another conversation. Stop it there or wait for it to finish.";

const keyOf = (view: View) =>
  `${view.project ?? ""}\n${view.conversationId ?? ""}`;
const same = (a: View, b: View) =>
  a.project === b.project && a.conversationId === b.conversationId;

function fromHistory(stored: ExplainStoredMessage[]): AgentMessage[] {
  return stored.map((message) =>
    message.role === "you"
      ? {
          key: `stored-${message.id}`,
          role: "you",
          text: message.text,
          images: [],
        }
      : {
          key: `stored-${message.id}`,
          role: "agent",
          parts:
            message.parts.length > 0
              ? message.parts
              : [{ kind: "text", text: message.text }],
          meta: message.meta,
        }
  );
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

export function useExplainSession(project: string | null): UseExplainSession {
  const [available, setAvailable] = useState(true);
  const [view, setView] = useState<View>({ project, conversationId: null });
  const [lists, setLists] = useState<
    Record<string, AgentConversationSummary[]>
  >({});
  const [transcripts, setTranscripts] = useState<
    Record<string, AgentMessage[]>
  >({});
  const [live, setLive] = useState<LiveRun | null>(null);
  const [error, setError] = useState<{ view: View; message: string } | null>(
    null
  );
  const [asked, setAsked] = useState<{
    view: View;
    request: ExplainRequest;
  } | null>(null);
  const runRef = useRef<{ runId: number; view: View } | null>(null);
  const askedCount = useRef(0);

  if (view.project !== project) {
    setView({ project, conversationId: null });
  }

  const load = useCallback((loaded: View) => {
    if (loaded.conversationId === null) {
      return;
    }
    explainConversation(loaded.conversationId)
      .then((stored) => {
        setTranscripts((current) => ({
          ...current,
          [keyOf(loaded)]: fromHistory(stored),
        }));
        setLive((current) =>
          current?.done && same(current.view, loaded) ? null : current
        );
      })
      .catch((cause) =>
        setError({ view: loaded, message: toIpcError(cause).message })
      );
  }, []);

  const list = useCallback(
    (listed: string) =>
      explainConversations(listed).then((found) => {
        setLists((current) => ({ ...current, [listed]: found }));
      }),
    []
  );

  useEffect(() => {
    agentStatus().then((status) => setAvailable(status.available));
  }, []);

  useEffect(() => {
    if (project !== null) {
      list(project).catch((cause) =>
        setError({
          view: { project, conversationId: null },
          message: toIpcError(cause).message,
        })
      );
    }
  }, [project, list]);

  useEffect(() => {
    const owned = (runId: number) =>
      runRef.current?.runId === runId ? runRef.current : null;
    const settle = (runId: number) => {
      const run = owned(runId);
      if (run) {
        runRef.current = null;
        setLive((current) => current && { ...current, done: true });
      }
      return run;
    };
    const grow = (runId: number, next: (parts: AgentPart[]) => AgentPart[]) => {
      if (owned(runId)) {
        setLive(
          (current) => current && { ...current, parts: next(current.parts) }
        );
      }
    };
    const subscriptions = Promise.all([
      onAgentDelta(({ runId, index, text }) =>
        grow(runId, (parts) => append(parts, index, text))
      ),
      onAgentPart(({ runId, index, part }) =>
        grow(runId, (parts) => place(parts, index, part))
      ),
      onAgentDone(({ runId }) => {
        const run = settle(runId);
        if (run?.view.project) {
          load(run.view);
          list(run.view.project).catch(() => undefined);
        }
      }),
      onAgentError(({ runId, message }) => {
        const run = settle(runId);
        if (run) {
          setError({ view: run.view, message });
          load(run.view);
        }
      }),
    ]);
    return () => {
      subscriptions.then((stops) => {
        for (const stop of stops) {
          stop();
        }
      });
    };
  }, [list, load]);

  const inFlight = live !== null && !live.done;

  const ask = useCallback(
    async (request: ExplainRequest) => {
      const sentProject = view.project;
      if (sentProject === null) {
        return;
      }
      if (inFlight) {
        if (live && !same(live.view, view)) {
          setError({ view, message: BUSY_ELSEWHERE });
        }
        return;
      }
      const sent = view;
      askedCount.current += 1;
      const question: AgentMessage = {
        key: `you-${askedCount.current}`,
        role: "you",
        text: request.text,
        images: [],
      };
      setError(null);
      setTranscripts((current) => ({
        ...current,
        [keyOf(sent)]: [...(current[keyOf(sent)] ?? []), question],
      }));
      setLive({ view: sent, runId: null, parts: [], done: false });
      try {
        const started = await explainSend({
          project: sentProject,
          conversationId: sent.conversationId,
          text: request.text,
          level: request.level,
          settings: request.settings,
        });
        const settled = {
          project: sentProject,
          conversationId: started.conversationId,
        };
        runRef.current = { runId: started.runId, view: settled };
        setAsked({ view: settled, request });
        setLive(
          (current) =>
            current && { ...current, view: settled, runId: started.runId }
        );
        if (sent.conversationId === null) {
          setTranscripts((current) => ({
            ...withoutKey(current, keyOf(sent)),
            [keyOf(settled)]: current[keyOf(sent)] ?? [question],
          }));
          setView((showing) => (same(showing, sent) ? settled : showing));
          list(sentProject).catch(() => undefined);
        }
      } catch (cause) {
        setLive(null);
        setAsked({ view: sent, request });
        setError({ view: sent, message: toIpcError(cause).message });
      }
    },
    [inFlight, list, live, view]
  );

  const openConversation = useCallback(
    (conversationId: string) => {
      const opened = { project: view.project, conversationId };
      setView(opened);
      load(opened);
    },
    [load, view.project]
  );

  const newConversation = useCallback(() => {
    const draft = { project: view.project, conversationId: null };
    setView(draft);
    setTranscripts((current) => withoutKey(current, keyOf(draft)));
  }, [view.project]);

  const cancel = useCallback(async () => {
    await explainCancel();
  }, []);

  const liveHere = live && same(live.view, view) ? live : null;
  const answering: AgentMessage[] =
    liveHere && liveHere.parts.length > 0
      ? [{ key: "live", role: "agent", parts: liveHere.parts, meta: null }]
      : [];
  const messages = [...(transcripts[keyOf(view)] ?? []), ...answering].map(
    (message, position) => ({ ...message, key: `${keyOf(view)}#${position}` })
  );

  const askedHere = asked && same(asked.view, view) ? asked.request : null;

  return {
    available,
    conversations: view.project === null ? [] : (lists[view.project] ?? []),
    conversationId: view.conversationId,
    openConversation,
    newConversation,
    messages,
    running: liveHere !== null && !liveHere.done,
    error: error && same(error.view, view) ? error.message : null,
    retry: askedHere ? () => ask(askedHere) : undefined,
    ask,
    cancel,
  };
}
