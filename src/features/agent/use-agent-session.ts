import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentAnswerMeta,
  AgentConversationSummary,
  AgentPart,
  AgentRunSettings,
  AgentStoredMessage,
} from "@/lib/agent-ipc-types";
import {
  onAgentDelta,
  onAgentDone,
  onAgentError,
  onAgentPart,
} from "@/lib/events";
import {
  agentCancel,
  agentConversation,
  agentConversations,
  agentSend,
  agentStatus,
  toIpcError,
} from "@/lib/ipc";

import type { AgentImage } from "./agent-images";
import { append, type Live, place } from "./agent-live";
import type { AgentReference } from "./agent-references";
import { keyOf, same, shown, type Tagged, type View } from "./agent-view";
import { type AgentDrafts, useAgentDrafts } from "./use-agent-drafts";

export interface AgentRequest {
  prompt: string;
  images: AgentImage[];
}

export type AgentMessage =
  | { key: string; role: "you"; text: string; images: AgentImage[] }
  | {
      key: string;
      role: "agent";
      parts: AgentPart[];
      meta: AgentAnswerMeta | null;
    };

export interface UseAgentSession extends AgentDrafts {
  available: boolean;
  conversations: AgentConversationSummary[];
  conversationId: string | null;
  openConversation: (conversationId: string) => void;
  newConversation: () => void;
  messages: AgentMessage[];
  running: boolean;
  error: string | null;
  proposal: string | null;
  references: AgentReference[];
  addReference: (reference: AgentReference) => void;
  removeReference: (path: string) => void;
  includesFile: boolean;
  includeFile: (included: boolean) => void;
  send: (
    request: AgentRequest,
    document: string,
    settings: AgentRunSettings
  ) => Promise<void>;
  cancel: () => Promise<void>;
  dismissProposal: () => void;
}

const BUSY_ELSEWHERE =
  "Claude is still answering in another conversation. Stop it there or wait for it to finish.";

function fromHistory(stored: AgentStoredMessage[]): AgentMessage[] {
  return stored.map((message) =>
    message.role === "you"
      ? {
          key: `stored-${message.id}`,
          role: "you",
          text: message.text,
          images: message.images.map((image, index) => ({
            ...image,
            id: `${message.id}-${index}`,
          })),
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

export function useAgentSession(fileId: number | null): UseAgentSession {
  const [available, setAvailable] = useState(false);
  const [view, setView] = useState<View>({ fileId, conversationId: null });
  const [lists, setLists] = useState<
    Record<number, AgentConversationSummary[]>
  >({});
  const [transcripts, setTranscripts] = useState<
    Record<string, AgentMessage[]>
  >({});
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<Tagged<string> | null>(null);
  const [proposal, setProposal] = useState<Tagged<string> | null>(null);
  const [references, setReferences] = useState<AgentReference[]>([]);
  const [includesFile, includeFile] = useState(true);
  const runRef = useRef<{ runId: number; view: View } | null>(null);
  const askedRef = useRef(0);

  if (view.fileId !== fileId) {
    const latest = fileId === null ? undefined : lists[fileId]?.[0];
    setView({ fileId, conversationId: latest?.id ?? null });
    setReferences([]);
    includeFile(true);
  }

  const load = useCallback((loaded: View) => {
    if (loaded.fileId === null || loaded.conversationId === null) {
      return;
    }
    agentConversation(loaded.fileId, loaded.conversationId)
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
        setError({ view: loaded, value: toIpcError(cause).message })
      );
  }, []);

  const list = useCallback(
    (listed: number) =>
      agentConversations(listed).then((found) => {
        setLists((current) => ({ ...current, [listed]: found }));
        return found;
      }),
    []
  );

  useEffect(() => {
    agentStatus().then((status) => setAvailable(status.available));
  }, []);

  useEffect(() => {
    if (fileId === null) {
      return;
    }
    let current = true;
    list(fileId)
      .then((found) => {
        const latest = found[0];
        if (!(current && latest)) {
          return;
        }
        const opened = { fileId, conversationId: latest.id };
        setView((showing) =>
          showing.fileId === fileId && showing.conversationId === null
            ? opened
            : showing
        );
        load(opened);
      })
      .catch((cause) =>
        setError({
          view: { fileId, conversationId: null },
          value: toIpcError(cause).message,
        })
      );
    return () => {
      current = false;
    };
  }, [fileId, list, load]);

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
    const subscriptions = Promise.all([
      onAgentDelta(({ runId, index, text }) => {
        if (owned(runId)) {
          setLive(
            (current) =>
              current && {
                ...current,
                parts: append(current.parts, index, text),
              }
          );
        }
      }),
      onAgentPart(({ runId, index, part }) => {
        if (owned(runId)) {
          setLive(
            (current) =>
              current && {
                ...current,
                parts: place(current.parts, index, part),
              }
          );
        }
      }),
      onAgentDone(({ runId, proposal: next }) => {
        const run = settle(runId);
        if (run) {
          setProposal(next === null ? null : { view: run.view, value: next });
          load(run.view);
          if (run.view.fileId !== null) {
            list(run.view.fileId).catch(() => undefined);
          }
        }
      }),
      onAgentError(({ runId, message }) => {
        const run = settle(runId);
        if (run) {
          setError({ view: run.view, value: message });
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

  const send = useCallback(
    async (
      { prompt, images }: AgentRequest,
      document: string,
      settings: AgentRunSettings
    ) => {
      const sentFile = view.fileId;
      if (sentFile === null || inFlight) {
        if (inFlight && live && !same(live.view, view)) {
          setError({ view, value: BUSY_ELSEWHERE });
        }
        return;
      }
      const sent = view;
      askedRef.current += 1;
      const asked: AgentMessage = {
        key: `you-${askedRef.current}`,
        role: "you",
        text: prompt,
        images,
      };
      setError(null);
      setProposal(null);
      setTranscripts((current) => ({
        ...current,
        [keyOf(sent)]: [...(current[keyOf(sent)] ?? []), asked],
      }));
      setLive({
        view: sent,
        runId: null,
        parts: [],
        done: false,
      });
      try {
        const started = await agentSend({
          fileId: sentFile,
          conversationId: sent.conversationId,
          content: includesFile ? document : null,
          prompt,
          images,
          references: references.map((reference) => reference.path),
          settings,
        });
        const settled = {
          fileId: sentFile,
          conversationId: started.conversationId,
        };
        runRef.current = { runId: started.runId, view: settled };
        setLive(
          (current) =>
            current && { ...current, view: settled, runId: started.runId }
        );
        if (sent.conversationId === null) {
          setTranscripts((current) => ({
            ...withoutKey(current, keyOf(sent)),
            [keyOf(settled)]: current[keyOf(sent)] ?? [asked],
          }));
          setView((showing) => (same(showing, sent) ? settled : showing));
          list(sentFile).catch(() => undefined);
        }
      } catch (cause) {
        setLive(null);
        setError({ view: sent, value: toIpcError(cause).message });
      }
    },
    [includesFile, inFlight, list, live, references, view]
  );

  const openConversation = useCallback(
    (conversationId: string) => {
      const opened = { fileId: view.fileId, conversationId };
      setView(opened);
      load(opened);
    },
    [load, view.fileId]
  );

  const newConversation = useCallback(() => {
    const draft = { fileId: view.fileId, conversationId: null };
    setView(draft);
    setTranscripts((current) => withoutKey(current, keyOf(draft)));
  }, [view.fileId]);

  const cancel = useCallback(async () => {
    await agentCancel();
  }, []);

  const dismissProposal = useCallback(() => setProposal(null), []);

  const addReference = useCallback((reference: AgentReference) => {
    setReferences((current) =>
      current.some((listed) => listed.path === reference.path)
        ? current
        : [...current, reference]
    );
  }, []);

  const removeReference = useCallback((path: string) => {
    setReferences((current) =>
      current.filter((reference) => reference.path !== path)
    );
  }, []);

  const drafts = useAgentDrafts(view.fileId);

  const liveHere = live && same(live.view, view) ? live : null;
  const messages: AgentMessage[] = [
    ...(transcripts[keyOf(view)] ?? []),
    ...(liveHere && liveHere.parts.length > 0
      ? [
          {
            key: `live-${liveHere.runId}`,
            role: "agent" as const,
            parts: liveHere.parts,
            meta: null,
          },
        ]
      : []),
  ].map((message, position) => ({
    ...message,
    key: `${keyOf(view)}#${position}`,
  }));

  return {
    available,
    conversations: view.fileId === null ? [] : (lists[view.fileId] ?? []),
    conversationId: view.conversationId,
    openConversation,
    newConversation,
    messages,
    running: liveHere !== null && !liveHere.done,
    error: shown(error, view),
    proposal: shown(proposal, view),
    references,
    addReference,
    removeReference,
    includesFile,
    includeFile,
    send,
    cancel,
    dismissProposal,
    ...drafts,
  };
}
