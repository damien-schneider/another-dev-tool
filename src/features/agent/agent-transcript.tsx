import {
  ActionBar,
  ActionBarCopy,
  ActionBarMeta,
} from "@ctrl-ui/react/action-bar";
import {
  Activity,
  ActivityIcon,
  ActivityRow,
  ActivityTitle,
} from "@ctrl-ui/react/activity";
import { ChatTurn } from "@ctrl-ui/react/chat-layout";
import {
  ChatMessage,
  ChatMessageBody,
  ChatMessageContent,
  ChatMessageRow,
} from "@ctrl-ui/react/chat-message";
import {
  InlineAttachment,
  InlineAttachmentMedia,
} from "@ctrl-ui/react/inline-attachment";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@ctrl-ui/react/ui/alert";
import { Button } from "@ctrl-ui/react/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@ctrl-ui/react/ui/dialog";
import { Markdown, type MarkdownProps } from "@ctrl-ui/react/ui/markdown";
import { type ReactNode, useState } from "react";

import { type AgentImage, imageSource } from "./agent-images";
import { answerText, metaLabel, segments } from "./agent-steps";
import { AgentSteps } from "./agent-steps-view";
import type { AgentMessage } from "./use-agent-session";

type Asked = Extract<AgentMessage, { role: "you" }>;
type Answered = Extract<AgentMessage, { role: "agent" }>;

type Turn =
  | { key: string; from: "user"; asked: Asked }
  | { key: string; from: "assistant"; answers: Answered[] };

function groupTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (message.role === "you") {
      turns.push({ key: message.key, from: "user", asked: message });
    } else if (last?.from === "assistant") {
      last.answers.push(message);
    } else {
      turns.push({ key: message.key, from: "assistant", answers: [message] });
    }
  }
  return turns;
}

function LiveActivity({ label }: { label: string }) {
  return (
    <Activity state="running">
      <ActivityRow>
        <ActivityIcon />
        <ActivityTitle>{label}</ActivityTitle>
      </ActivityRow>
    </Activity>
  );
}

function SentImage({ image }: { image: AgentImage }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <InlineAttachment
        aspect={image.width / image.height}
        name={image.name}
        onClick={() => setOpen(true)}
      >
        <InlineAttachmentMedia alt="" src={imageSource(image)} />
      </InlineAttachment>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{image.name}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <img alt="" src={imageSource(image)} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UserTurn({ asked }: { asked: Asked }) {
  return (
    <ChatTurn from="user">
      {asked.images.map((image) => (
        <SentImage image={image} key={image.id} />
      ))}
      <ChatMessage authorLabel="You" density="compact" from="user">
        <ChatMessageRow>
          <ChatMessageBody>
            <ChatMessageContent>{asked.text}</ChatMessageContent>
          </ChatMessageBody>
        </ChatMessageRow>
      </ChatMessage>
    </ChatTurn>
  );
}

export type TranscriptMarkdown = Record<
  "static" | "streaming",
  MarkdownProps["components"]
>;

function AgentTurn({
  answers,
  live,
  markdown,
  actions,
}: {
  answers: Answered[];
  live: boolean;
  markdown: TranscriptMarkdown | undefined;
  actions: ReactNode;
}) {
  const lastKey = answers.at(-1)?.key;
  const text = answerText(answers.flatMap((answer) => answer.parts));
  const meta = answers.findLast((answer) => answer.meta !== null)?.meta;

  return (
    <ChatTurn from="assistant">
      {answers.map((answer) => {
        const current = live && answer.key === lastKey;
        const found = segments(answer.parts);
        return found.map((segment, position) => {
          const growing = current && position === found.length - 1;
          const key = `${answer.key}-${segment.start}`;
          if (segment.kind === "steps") {
            return (
              <AgentSteps key={key} live={growing} steps={segment.steps} />
            );
          }
          return (
            <ChatMessage
              authorLabel="Claude"
              density="compact"
              from="assistant"
              key={key}
              state={growing ? "streaming" : "idle"}
            >
              <ChatMessageRow>
                <ChatMessageBody className="max-w-full flex-1">
                  <ChatMessageContent>
                    <Markdown
                      components={markdown?.[growing ? "streaming" : "static"]}
                      content={segment.text}
                      mode={growing ? "streaming" : "static"}
                    />
                  </ChatMessageContent>
                </ChatMessageBody>
              </ChatMessageRow>
            </ChatMessage>
          );
        });
      })}
      {live || !text ? null : (
        <ActionBar copyValue={text} label="Answer actions">
          <ActionBarCopy />
          {actions}
          {meta ? <ActionBarMeta>{metaLabel(meta)}</ActionBarMeta> : null}
        </ActionBar>
      )}
    </ChatTurn>
  );
}

export interface AgentTranscriptProps {
  messages: AgentMessage[];
  running: boolean;
  error: string | null;
  /** Absent when there is no request to send again. */
  onRetry?: () => void;
  /** Element renderers for answers; each object must stay stable between renders. */
  markdown?: TranscriptMarkdown;
  answerActions?: ReactNode;
}

export function AgentTranscript({
  messages,
  running,
  error,
  onRetry,
  markdown,
  answerActions,
}: AgentTranscriptProps) {
  const turns = groupTurns(messages);
  const lastTurn = turns.at(-1);
  const replying = running && lastTurn?.from === "assistant";

  return (
    <>
      {turns.map((turn) => {
        if (turn.from === "user") {
          return <UserTurn asked={turn.asked} key={turn.key} />;
        }
        return (
          <AgentTurn
            actions={turn === lastTurn ? answerActions : null}
            answers={turn.answers}
            key={turn.key}
            live={replying && turn === lastTurn}
            markdown={markdown}
          />
        );
      })}
      {running && !replying ? (
        <ChatTurn from="assistant">
          <LiveActivity label="Thinking" />
        </ChatTurn>
      ) : null}
      {error === null ? null : (
        <Alert tone="danger">
          <AlertTitle>The request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {onRetry ? (
            <AlertAction>
              <Button onClick={onRetry} size="sm" variant="surface">
                Try again
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      )}
    </>
  );
}
