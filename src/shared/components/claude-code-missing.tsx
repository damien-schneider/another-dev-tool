import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ctrl-ui/react/ui/empty";
import { Text } from "@ctrl-ui/react/ui/typography";
import { SquareTerminal } from "lucide-react";

export const INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

export function ClaudeCodeMissing({ madeBy }: { madeBy: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <SquareTerminal />
        </EmptyMedia>
        <EmptyTitle>Claude Code isn’t installed</EmptyTitle>
        <EmptyDescription>
          {madeBy} by the Claude Code command-line tool, which wasn’t found on
          this Mac. Install it from a terminal, then restart Another Dev Tool.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Text as="code" className="select-all" mono size="label">
          {INSTALL_COMMAND}
        </Text>
      </EmptyContent>
    </Empty>
  );
}
