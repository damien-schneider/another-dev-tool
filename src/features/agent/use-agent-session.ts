import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentProposal,
  AskConversationSummary,
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
  toIpcError,
} from "@/lib/ipc";
import type { TextSelection } from "@/lib/text-selection";
import type { AgentImage } from "./agent-images";
import { append, type Live, place } from "./agent-live";
import { type AgentMessage, fromHistory } from "./agent-messages";
import {
  type AgentChoice,
  useAgentChoice,
} from "./agent-picker/use-agent-choice";
import type { AgentReference } from "./agent-references";
import { keyOf, same, shown, type Tagged, type View } from "./agent-view";
import { type AgentDrafts, useAgentDrafts } from "./use-agent-drafts";

export interface AgentRequest {
  prompt: string;
  images: AgentImage[];
  selection: TextSelection | null;
}

export interface UseAgentSession extends AgentDrafts {
  agent: AgentChoice;
  conversations: AskConversationSummary[];
  conversationId: string | null;
  openConversation: (conversationId: string) => void;
  newConversation: () => void;
  messages: AgentMessage[];
  running: boolean;
  error: string | null;
  signedOut: boolean;
  proposals: AgentProposal[];
  references: AgentReference[];
  addReference: (reference: AgentReference) => void;
  removeReference: (path: string) => void;
  includesFile: boolean;
  includeFile: (included: boolean) => void;
  send: (request: AgentRequest, document: string) => Promise<void>;
  cancel: () => Promise<void>;
  dismissProposal: (fileId: number) => void;
}

const BUSY_ELSEWHERE =
  "Still answering in another conversation. Stop it there or wait for it to finish.";

interface Failure {
  message: string;
  signIn: boolean;
}

const failure = (message: string): Failure => ({ message, signIn: false });

function withoutKey<T>(record: Record<string, T>, key: string) {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

export function useAgentSession(fileId: number | null): UseAgentSession {
  const [view, setView] = useState<View>({ conversationId: null });
  const [conversations, setConversations] = useState<AskConversationSummary[]>(
    []
  );
  const [transcripts, setTranscripts] = useState<
    Record<string, AgentMessage[]>
  >({});
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<Tagged<Failure> | null>(null);
  const [proposals, setProposals] = useState<Tagged<AgentProposal[]> | null>(
    null
  );
  const [references, setReferences] = useState<AgentReference[]>([]);
  const [includesFile, includeFile] = useState(true);
  const [aboutFile, setAboutFile] = useState(fileId);
  const runRef = useRef<{ runId: number; view: View } | null>(null);
  const askedRef = useRef(0);
  const pinned =
    conversations.find(
      (conversation) => conversation.id === view.conversationId
    )?.agentId ?? null;
  const choice = useAgentChoice(pinned);

  if (aboutFile !== fileId) {
    setAboutFile(fileId);
    setReferences([]);
    includeFile(true);
  }

  const load = useCallback((loaded: View) => {
    if (loaded.conversationId === null) {
      return;
    }
    agentConversation(loaded.conversationId)
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
        setError({ view: loaded, value: failure(toIpcError(cause).message) })
      );
  }, []);

  const list = useCallback(
    () =>
      agentConversations().then((found) => {
        setConversations(found);
        return found;
      }),
    []
  );

  useEffect(() => {
    let current = true;
    list()
      .then((found) => {
        const latest = found[0];
        if (!(current && latest)) {
          return;
        }
        const opened = { conversationId: latest.id };
        setView((showing) =>
          showing.conversationId === null ? opened : showing
        );
        load(opened);
      })
      .catch((cause) =>
        setError({
          view: { conversationId: null },
          value: failure(toIpcError(cause).message),
        })
      );
    return () => {
      current = false;
    };
  }, [list, load]);

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
      onAgentDone(({ runId, proposals: next }) => {
        const run = settle(runId);
        if (run) {
          setProposals({ view: run.view, value: next });
          load(run.view);
          list().catch(() => undefined);
        }
      }),
      onAgentError(({ runId, message, signIn }) => {
        const run = settle(runId);
        if (run) {
          setError({ view: run.view, value: { message, signIn } });
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
    async ({ prompt, images, selection }: AgentRequest, document: string) => {
      const sentFile = fileId;
      if (sentFile === null || inFlight) {
        if (inFlight && live && !same(live.view, view)) {
          setError({ view, value: failure(BUSY_ELSEWHERE) });
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
      setProposals(null);
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
          selection,
          agent: { id: choice.agentId, config: choice.config },
        });
        const settled = { conversationId: started.conversationId };
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
          list().catch(() => undefined);
        }
      } catch (cause) {
        setLive(null);
        setError({ view: sent, value: failure(toIpcError(cause).message) });
      }
    },
    [
      choice.agentId,
      choice.config,
      fileId,
      includesFile,
      inFlight,
      list,
      live,
      references,
      view,
    ]
  );

  const openConversation = useCallback(
    (conversationId: string) => {
      const opened = { conversationId };
      setView(opened);
      load(opened);
    },
    [load]
  );

  const newConversation = useCallback(() => {
    const draft = { conversationId: null };
    setView(draft);
    setTranscripts((current) => withoutKey(current, keyOf(draft)));
  }, []);

  const { choose } = choice;
  const chooseAgent = useCallback(
    (agentId: string) => {
      if (agentId === choice.agentId) {
        return;
      }
      choose(agentId);
      newConversation();
    },
    [choice.agentId, choose, newConversation]
  );

  const cancel = useCallback(async () => {
    await agentCancel();
  }, []);

  const dismissProposal = useCallback((dismissed: number) => {
    setProposals(
      (current) =>
        current && {
          ...current,
          value: current.value.filter(
            (proposal) => proposal.fileId !== dismissed
          ),
        }
    );
  }, []);

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

  const drafts = useAgentDrafts(fileId);

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

  const failed = shown(error, view);

  return {
    agent: { ...choice, choose: chooseAgent },
    conversations,
    conversationId: view.conversationId,
    openConversation,
    newConversation,
    messages,
    running: liveHere !== null && !liveHere.done,
    error: failed?.message ?? null,
    signedOut: failed?.signIn ?? false,
    proposals: shown(proposals, view) ?? [],
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
