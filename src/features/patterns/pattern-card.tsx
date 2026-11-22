import {
  MarkdownBlock,
  MarkdownBlockContent,
  MarkdownBlockCopy,
  MarkdownBlockHeader,
  MarkdownBlockTitle,
} from "@ctrl-ui/react/markdown-block";
import { Badge } from "@ctrl-ui/react/ui/badge";
import { Button } from "@ctrl-ui/react/ui/button";
import { Markdown } from "@ctrl-ui/react/ui/markdown";
import { toast } from "@ctrl-ui/react/ui/toast";
import { Heading, Text } from "@ctrl-ui/react/ui/typography";
import { useState } from "react";

import { displayPath } from "@/features/destinations/destination-path";
import { toIpcError } from "@/lib/ipc";
import type { Pattern } from "@/lib/patterns-ipc-types";

import { changeBody, skillDraft } from "./pattern-actions";
import { PatternEvidence } from "./pattern-evidence";
import { KINDS } from "./pattern-format";

export const patternCardId = (id: number) => `pattern-${id}`;

function suggestionTitle(pattern: Pattern, home: string | null) {
  if (pattern.target !== null) {
    const verb = pattern.kind === "strengthen" ? "Update" : "Add to";
    return `${verb} ${displayPath(pattern.target, home)}`;
  }
  if (pattern.kind === "skill") {
    const { name } = skillDraft(pattern.change);
    return name ? `New skill: ${name}` : "New skill";
  }
  if (pattern.kind === "automate") {
    return "New hook or script";
  }
  return pattern.scope === "global"
    ? "Add to your global instructions"
    : `Add to the ${pattern.scope} instructions`;
}

export function PatternCard({
  pattern,
  home,
  onOpenInEditor,
  onCreateSkill,
  onDismiss,
}: {
  pattern: Pattern;
  home: string | null;
  onOpenInEditor?: () => void;
  onCreateSkill?: () => void;
  onDismiss: () => Promise<void>;
}) {
  const titleId = patternCardId(pattern.id);
  const [dismissing, setDismissing] = useState(false);
  const kind = KINDS[pattern.kind];

  const dismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss();
    } catch (cause) {
      setDismissing(false);
      toast.error("Could not dismiss the pattern", {
        description: toIpcError(cause).message,
      });
    }
  };

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-6 py-10 transition-opacity duration-200 ease-out first:pt-4 motion-reduce:transition-none starting:opacity-0"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Badge color={kind.color} size="sm">
            {kind.label}
          </Badge>
          <Heading
            className="min-w-0"
            id={titleId}
            level={2}
            size="heading-4"
            tabIndex={-1}
          >
            {pattern.title}
          </Heading>
        </div>
        <Text as="p" tone="muted">
          {pattern.why}
        </Text>
      </div>

      <PatternEvidence pattern={pattern} />

      <div className="flex flex-col gap-3">
        <MarkdownBlock className="my-0" code={pattern.change}>
          <MarkdownBlockHeader>
            <MarkdownBlockTitle>
              {suggestionTitle(pattern, home)}
            </MarkdownBlockTitle>
            <MarkdownBlockCopy aria-label="Copy change" />
          </MarkdownBlockHeader>
          <MarkdownBlockContent maxHeight="18rem">
            <Markdown content={changeBody(pattern.change)} mode="static" />
          </MarkdownBlockContent>
        </MarkdownBlock>

        <div className="flex flex-wrap gap-2">
          {onOpenInEditor ? (
            <Button
              aria-describedby={titleId}
              disabled={dismissing}
              onClick={onOpenInEditor}
              size="sm"
              tone="primary"
              variant="solid"
            >
              Open in editor
            </Button>
          ) : null}
          {onCreateSkill ? (
            <Button
              aria-describedby={titleId}
              disabled={dismissing}
              onClick={onCreateSkill}
              size="sm"
              tone="primary"
              variant="solid"
            >
              Create skill
            </Button>
          ) : null}
          <Button
            aria-describedby={titleId}
            className="ms-auto"
            disabled={dismissing}
            onClick={dismiss}
            size="sm"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </article>
  );
}
