import { Button } from "@ctrl-ui/react/ui/button";
import {
  Code,
  CodeActions,
  CodeContent,
  CodeCopy,
  CodeHeader,
  CodeTitle,
} from "@ctrl-ui/react/ui/code";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { Text } from "@ctrl-ui/react/ui/typography";
import { SquareArrowOutUpRight } from "lucide-react";

import { useExplainSurface } from "../explain-surface";
import { formatCodeRef } from "../source/code-ref";
import { useSourceFile } from "../source/use-source-file";
import type { ExcerptSpec } from "./block-specs";

const MAX_LINES = 60;
const SKELETON_WIDTHS = ["w-3/5", "w-4/5", "w-2/5", "w-3/4"];
const LINE_BREAK = /\r?\n/;
const FILE_EXTENSION = /\.([\w-]+)$/;

function excerptLines(text: string, spec: ExcerptSpec) {
  const lines = text.split(LINE_BREAK);
  const start = spec.ref.start ?? 1;
  const end = Math.min(
    lines.length,
    spec.ref.end ?? spec.ref.start ?? lines.length
  );
  if (start > end) {
    return null;
  }
  const shownEnd = Math.min(end, start + MAX_LINES - 1);
  return {
    code: lines.slice(start - 1, shownEnd).join("\n"),
    start,
    hidden: end - shownEnd,
  };
}

export function ExcerptBlock({ spec }: { spec: ExcerptSpec }) {
  const { project, openRef } = useExplainSurface();
  const source = useSourceFile(project, spec.ref.path);
  const title = formatCodeRef(spec.ref);
  const lang = FILE_EXTENSION.exec(spec.ref.path)?.[1]?.toLowerCase();
  const open = () => openRef(spec.ref);

  if (source.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 p-4">
        <span className="sr-only">{`Loading ${title}`}</span>
        {SKELETON_WIDTHS.map((width) => (
          <Skeleton className={`h-3.5 ${width}`} key={width} />
        ))}
      </div>
    );
  }

  const excerpt =
    source.status === "ready" ? excerptLines(source.file.text, spec) : null;

  if (excerpt === null) {
    return (
      <div className="p-4">
        <Text size="caption" tone="muted">
          {"Couldn't show "}
          <Text as="code" mono size="caption">
            {title}
          </Text>
          {source.status === "failed"
            ? `: ${source.message}`
            : ": those lines aren't in the file."}
        </Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Code chrome="embedded" overflow="scroll">
        <CodeHeader>
          <CodeTitle>{title}</CodeTitle>
          <CodeActions>
            <Button onClick={open} size="xs" variant="ghost">
              <SquareArrowOutUpRight aria-hidden="true" />
              Open
            </Button>
            <CodeCopy value={excerpt.code} />
          </CodeActions>
        </CodeHeader>
        <CodeContent
          aria-label={title}
          code={excerpt.code}
          highlightLines={spec.focus}
          lang={lang}
          showLineNumbers
          startLine={excerpt.start}
        />
      </Code>
      {excerpt.hidden > 0 ? (
        <Button
          className="mx-4 mt-2 self-start"
          onClick={open}
          size="xs"
          variant="link"
        >
          {`${excerpt.hidden} more ${excerpt.hidden === 1 ? "line" : "lines"} in the file`}
        </Button>
      ) : null}
      {spec.note ? (
        <div className="px-4 pt-2 pb-3">
          <Text size="caption" tone="muted">
            {spec.note}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
