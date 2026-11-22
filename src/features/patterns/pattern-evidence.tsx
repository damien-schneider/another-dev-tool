import {
  ChatMessage,
  ChatMessageBody,
  ChatMessageContent,
  ChatMessageFooter,
  ChatMessageRow,
} from "@ctrl-ui/react/chat-message";
import { Button } from "@ctrl-ui/react/ui/button";
import { Heading } from "@ctrl-ui/react/ui/typography";
import { useId, useState } from "react";

import { folderName } from "@/features/destinations/destination-path";
import type { Pattern } from "@/lib/patterns-ipc-types";

import { AGENT_NAMES, formatDay, formatReach } from "./pattern-format";

const VISIBLE_QUOTES = 3;

export function PatternEvidence({ pattern }: { pattern: Pattern }) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { evidence } = pattern;
  const shown = expanded ? evidence : evidence.slice(0, VISIBLE_QUOTES);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <Heading id={headingId} level={3} size="label" tone="muted">
        {formatReach(pattern.sessions, pattern.days)}
      </Heading>
      <ul className="flex flex-col" id={listId}>
        {shown.map((quote) => (
          <li key={`${quote.at}-${quote.agent}-${quote.text}`}>
            <ChatMessage density="compact" from="user">
              <ChatMessageRow>
                <ChatMessageBody>
                  <ChatMessageContent>
                    <span className="line-clamp-4 break-words whitespace-pre-wrap">
                      {quote.text}
                    </span>
                  </ChatMessageContent>
                  <ChatMessageFooter>
                    <span>
                      <time dateTime={new Date(quote.at).toISOString()}>
                        {formatDay(quote.at)}
                      </time>
                      {` · ${AGENT_NAMES[quote.agent]}`}
                      {quote.project === null
                        ? null
                        : ` · ${folderName(quote.project)}`}
                    </span>
                  </ChatMessageFooter>
                </ChatMessageBody>
              </ChatMessageRow>
            </ChatMessage>
          </li>
        ))}
      </ul>
      {evidence.length > VISIBLE_QUOTES ? (
        <Button
          aria-controls={listId}
          aria-expanded={expanded}
          className="self-end"
          onClick={() => setExpanded((current) => !current)}
          size="xs"
          variant="link"
        >
          {expanded ? "Show less" : `Show all ${evidence.length}`}
        </Button>
      ) : null}
    </section>
  );
}
