import { cn } from "@ctrl-ui/react/lib/cn";
import { MarkdownCode } from "@ctrl-ui/react/ui/markdown-components";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { Text } from "@ctrl-ui/react/ui/typography";
import { type ReactNode, useMemo } from "react";

import { type BlockKind, type ParsedBlock, parseBlock } from "./block-specs";
import { ChartBlock } from "./chart-block";
import { DiagramBlock } from "./diagram/diagram-block";
import { ExcerptBlock } from "./excerpt-block";
import { FilesBlock } from "./files-block";
import { StatsBlock } from "./stats-block";
import { StepsBlock } from "./steps-block";

const PENDING_LABELS: Record<BlockKind, string> = {
  diagram: "Drawing a diagram…",
  chart: "Plotting a chart…",
  files: "Gathering files…",
  steps: "Laying out the steps…",
  excerpt: "Pulling up the code…",
  stats: "Counting…",
};

function BlockFrame({
  title,
  flush = false,
  children,
}: {
  title?: string | null;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className="rounded-panel border-border my-3 flex min-w-0 flex-col overflow-hidden border">
      {title ? (
        <figcaption className="px-4 pt-3">
          <Text size="label" weight="medium">
            {title}
          </Text>
        </figcaption>
      ) : null}
      <div
        className={cn(
          "min-w-0",
          flush ? title && "pt-2" : cn("px-4 pb-4", title ? "pt-2" : "pt-4")
        )}
      >
        {children}
      </div>
    </figure>
  );
}

function RenderedBlock({ block }: { block: ParsedBlock }) {
  switch (block.kind) {
    case "diagram":
      return (
        <BlockFrame flush title={block.spec.title}>
          <DiagramBlock spec={block.spec} />
        </BlockFrame>
      );
    case "chart":
      return (
        <BlockFrame title={block.spec.title}>
          <ChartBlock spec={block.spec} />
        </BlockFrame>
      );
    case "files":
      return (
        <BlockFrame title={block.spec.title}>
          <FilesBlock spec={block.spec} />
        </BlockFrame>
      );
    case "steps":
      return (
        <BlockFrame title={block.spec.title}>
          <StepsBlock spec={block.spec} />
        </BlockFrame>
      );
    case "excerpt":
      return (
        <BlockFrame flush>
          <ExcerptBlock spec={block.spec} />
        </BlockFrame>
      );
    case "stats":
      return (
        <BlockFrame title={block.spec.title}>
          <StatsBlock spec={block.spec} />
        </BlockFrame>
      );
    default:
      return null;
  }
}

export function ExplainBlock({
  kind,
  source,
  streaming,
}: {
  kind: BlockKind;
  source: string;
  streaming: boolean;
}) {
  const block = useMemo(() => parseBlock(kind, source), [kind, source]);

  if (block !== null) {
    return <RenderedBlock block={block} />;
  }
  if (streaming) {
    return (
      <BlockFrame>
        <div className="flex flex-col gap-2" role="status">
          <Skeleton className="h-24 w-full" shape="panel" />
          <Text size="caption" tone="muted">
            {PENDING_LABELS[kind]}
          </Text>
        </div>
      </BlockFrame>
    );
  }
  return <MarkdownCode className="language-json">{source}</MarkdownCode>;
}
