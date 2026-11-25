import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ctrl-ui/react/ui/dropdown-menu";
import { Text } from "@ctrl-ui/react/ui/typography";
import { History, SquarePen } from "lucide-react";

import {
  formatRelativeTime,
  useMinuteClock,
} from "@/features/prompts/relative-time";
import type { AgentConversationSummary } from "@/lib/agent-ipc-types";
import { IconButton } from "@/shared/components/icon-button";

export function ConversationHistory({
  heading,
  session,
}: {
  heading: string;
  session: {
    conversations: readonly AgentConversationSummary[];
    conversationId: string | null;
    openConversation: (conversationId: string) => void;
    newConversation: () => void;
  };
}) {
  const now = useMinuteClock();
  const { conversations, conversationId } = session;

  return (
    <>
      <IconButton
        disabled={conversationId === null}
        label="New conversation"
        onClick={session.newConversation}
      >
        <SquarePen />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Conversations"
          disabled={conversations.length === 0}
          iconOnly
          size="sm"
          variant="ghost"
        >
          <History />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup
            onValueChange={(next: string) => session.openConversation(next)}
            value={conversationId ?? ""}
          >
            <DropdownMenuLabel>{heading}</DropdownMenuLabel>
            {conversations.map((conversation) => (
              <DropdownMenuRadioItem
                key={conversation.id}
                value={conversation.id}
              >
                <span className="min-w-0 flex-1 truncate">
                  {conversation.title}
                </span>
                <Text className="shrink-0" size="caption" tone="muted">
                  {formatRelativeTime(conversation.updatedAt, now)}
                </Text>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
