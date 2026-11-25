import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentConfigPick,
  AgentListing,
  AgentPicker,
  AgentPrepared,
  AgentSignIn,
} from "@/lib/agent-ipc-types";
import { agentCatalog, agentPrepare, agentSignIn, toIpcError } from "@/lib/ipc";

export const DEFAULT_AGENT = "claude-acp";
export const AGENT_KEY = "another-dev-tool.agent-id";

export const pickKey = (agentId: string, optionId: string) =>
  `another-dev-tool.agent-pick.${agentId}.${optionId}`;

export type Preparing =
  | { state: "starting" }
  | { state: "ready"; prepared: AgentPrepared }
  | { state: "failed"; message: string };

const STARTING: Preparing = { state: "starting" };

export interface AgentChoice {
  listings: AgentListing[];
  catalogError: string | null;
  agentId: string;
  listing: AgentListing | undefined;
  name: string;
  preparing: Preparing;
  model: string | null;
  effort: string | null;
  config: AgentConfigPick[];
  choose: (agentId: string) => void;
  pick: (optionId: string, value: string) => void;
  refresh: () => void;
  signIn: (methodId: string) => Promise<AgentSignIn>;
}

function withoutAgent(
  record: Record<string, Preparing>,
  agentId: string
): Record<string, Preparing> {
  const { [agentId]: _dropped, ...rest } = record;
  return rest;
}

export function useAgentChoice(pinned: string | null): AgentChoice {
  const [listings, setListings] = useState<AgentListing[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(
    () => window.localStorage.getItem(AGENT_KEY) ?? DEFAULT_AGENT
  );
  const [prepared, setPrepared] = useState<Record<string, Preparing>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const agentId = pinned ?? chosen;
  const preparing = prepared[agentId] ?? STARTING;

  useEffect(() => {
    agentCatalog().then(setListings, (cause) =>
      setCatalogError(toIpcError(cause).message)
    );
  }, []);

  useEffect(() => {
    if (prepared[agentId] || asked.current.has(agentId)) {
      return;
    }
    asked.current.add(agentId);
    agentPrepare(agentId)
      .then(
        (ready): Preparing => ({ state: "ready", prepared: ready }),
        (cause): Preparing => ({
          state: "failed",
          message: toIpcError(cause).message,
        })
      )
      .then((settled) => {
        asked.current.delete(agentId);
        setPrepared((current) => ({ ...current, [agentId]: settled }));
      });
  }, [agentId, prepared]);

  const stored = (picker: AgentPicker | null) => {
    if (picker === null) {
      return null;
    }
    const key = pickKey(agentId, picker.id);
    const value = picks[key] ?? window.localStorage.getItem(key);
    return picker.choices.some((choice) => choice.value === value)
      ? value
      : null;
  };
  const offered = preparing.state === "ready" ? preparing.prepared : null;
  const pickers = [offered?.models ?? null, offered?.efforts ?? null];
  const [model = null, effort = null] = pickers.map(
    (picker) => stored(picker) ?? picker?.current ?? null
  );
  const config = pickers.flatMap((picker) => {
    const value = stored(picker);
    return picker && value ? [{ id: picker.id, value }] : [];
  });

  const choose = useCallback((next: string) => {
    window.localStorage.setItem(AGENT_KEY, next);
    setChosen(next);
  }, []);

  const pick = useCallback(
    (optionId: string, value: string) => {
      const key = pickKey(agentId, optionId);
      window.localStorage.setItem(key, value);
      setPicks((current) => ({ ...current, [key]: value }));
    },
    [agentId]
  );

  const refresh = useCallback(
    () => setPrepared((current) => withoutAgent(current, agentId)),
    [agentId]
  );

  const signIn = useCallback(
    (methodId: string) => agentSignIn(agentId, methodId),
    [agentId]
  );

  const listing = listings.find((entry) => entry.id === agentId);
  return {
    listings,
    catalogError,
    agentId,
    listing,
    name: listing?.name ?? "the agent",
    preparing,
    model,
    effort,
    config,
    choose,
    pick,
    refresh,
    signIn,
  };
}
