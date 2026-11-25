import type {
  AgentAnswerMeta,
  AgentPart,
  AgentStoredMessage,
} from "@/lib/agent-ipc-types";

import type { AgentImage } from "./agent-images";

export type AgentMessage =
  | { key: string; role: "you"; text: string; images: AgentImage[] }
  | {
      key: string;
      role: "agent";
      parts: AgentPart[];
      meta: AgentAnswerMeta | null;
    };

export function fromHistory(stored: AgentStoredMessage[]): AgentMessage[] {
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
