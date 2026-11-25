import { CodeDiff } from "@ctrl-ui/react/ui/code-diff";
import { Text } from "@ctrl-ui/react/ui/typography";

export interface DiffViewProps {
  before: string;
  after: string;
  name: string;
  maxHeight: string;
}

export function DiffView({ before, after, name, maxHeight }: DiffViewProps) {
  if (before === after) {
    return (
      <Text as="p" tone="muted">
        No changes.
      </Text>
    );
  }

  return (
    <CodeDiff
      maxHeight={maxHeight}
      name={name}
      newText={after}
      oldText={before}
      overflow="wrap"
    />
  );
}
