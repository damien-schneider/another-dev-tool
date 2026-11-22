import type { AgentPart } from "@/lib/agent-ipc-types";

import type { View } from "./agent-view";

export interface Live {
  view: View;
  runId: number | null;
  parts: AgentPart[];
  done: boolean;
}

export function place(parts: AgentPart[], index: number, part: AgentPart) {
  const next = [...parts];
  next[index] = part;
  return next;
}

export function append(parts: AgentPart[], index: number, text: string) {
  const part = parts[index];
  if (!part || part.kind === "tool") {
    return parts;
  }
  return place(parts, index, { ...part, text: part.text + text });
}
