import { Code, CodeContent } from "@ctrl-ui/react/ui/code";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { Text } from "@ctrl-ui/react/ui/typography";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileCode, FolderSearch, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton } from "@/shared/components/icon-button";

import { type CodeRef, formatCodeRef, refLines } from "./code-ref";
import { useSourceFile } from "./use-source-file";

const WINDOW_LINES = 1000;
const LINES_ABOVE_TARGET = 250;
const LINE_BREAK = /\r?\n/;
const FILE_EXTENSION = /\.([\w-]+)$/;
const SKELETON_WIDTHS = ["w-3/5", "w-4/5", "w-2/5", "w-3/4", "w-1/2"];

function sourceWindow(text: string, codeRef: CodeRef) {
  const lines = text.split(LINE_BREAK);
  const target = codeRef.start ?? 1;
  const first =
    lines.length <= WINDOW_LINES
      ? 1
      : Math.max(
          1,
          Math.min(target - LINES_ABOVE_TARGET, lines.length - WINDOW_LINES + 1)
        );
  const last = Math.min(lines.length, first + WINDOW_LINES - 1);
  return {
    code: lines.slice(first - 1, last).join("\n"),
    first,
    last,
    total: lines.length,
    missing: target > lines.length,
  };
}

function SourceBody({
  project,
  codeRef,
}: {
  project: string;
  codeRef: CodeRef;
}) {
  const source = useSourceFile(project, codeRef.path);
  const viewportRef = useRef<HTMLDivElement>(null);
  const ready = source.status === "ready";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!(ready && viewport)) {
      return;
    }
    const target = viewport.querySelector('[data-highlighted="true"]');
    if (target) {
      target.scrollIntoView({ block: "center" });
    } else {
      viewport.scrollTop = 0;
    }
  }, [ready, codeRef]);

  if (source.status === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-2 p-4">
        <span className="sr-only">{`Loading ${codeRef.path}`}</span>
        {SKELETON_WIDTHS.map((width) => (
          <Skeleton className={`h-3.5 ${width}`} key={width} />
        ))}
      </div>
    );
  }
  if (source.status === "failed") {
    return (
      <div className="p-4" role="alert">
        <Text size="caption" tone="muted">
          {`Couldn't open ${codeRef.path}: ${source.message}`}
        </Text>
      </div>
    );
  }

  const shown = sourceWindow(source.file.text, codeRef);
  const clipped = shown.first > 1 || shown.last < shown.total;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {shown.missing || clipped ? (
        <div className="border-border border-b px-4 py-2">
          <Text size="caption" tone="muted">
            {shown.missing
              ? `The file has ${shown.total} lines now, so line ${codeRef.start} is gone. It may have changed since the answer.`
              : `Showing lines ${shown.first}–${shown.last} of ${shown.total}.`}
          </Text>
        </div>
      ) : null}
      <Code
        chrome="embedded"
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
      >
        <CodeContent
          aria-label={codeRef.path}
          code={shown.code}
          fileName={source.file.path}
          highlightLines={refLines(codeRef)}
          lang={FILE_EXTENSION.exec(codeRef.path)?.[1]?.toLowerCase()}
          maxHeight="none"
          ref={viewportRef}
          showLineNumbers
          startLine={shown.first}
        />
      </Code>
    </div>
  );
}

export function SourcePane({
  project,
  codeRef,
  onClose,
}: {
  project: string;
  codeRef: CodeRef;
  onClose: () => void;
}) {
  const segments = codeRef.path.split("/");
  const name = segments.at(-1) ?? codeRef.path;
  const lines = formatCodeRef(codeRef).slice(codeRef.path.length + 1);

  return (
    <aside
      aria-label={`Source: ${formatCodeRef(codeRef)}`}
      className="border-border flex h-full min-h-0 w-[min(46rem,48%)] shrink-0 flex-col border-l"
    >
      <div
        className="border-border flex h-(--titlebar-height) shrink-0 items-center gap-2 border-b ps-4 pe-2"
        data-tauri-drag-region="deep"
      >
        <FileCode
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <Text
          className="max-w-60 shrink-0 truncate"
          size="label"
          weight="medium"
        >
          {name}
        </Text>
        {lines ? (
          <Text className="shrink-0" mono size="caption" tone="muted">
            {lines}
          </Text>
        ) : null}
        <Text
          className="min-w-0 flex-1 truncate"
          mono
          size="caption"
          tone="muted"
        >
          {segments.slice(0, -1).join("/")}
        </Text>
        <IconButton
          label="Reveal in Finder"
          onClick={() => {
            revealItemInDir(`${project}/${codeRef.path}`).catch(
              () => undefined
            );
          }}
        >
          <FolderSearch />
        </IconButton>
        <IconButton label="Close source" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <SourceBody codeRef={codeRef} project={project} />
    </aside>
  );
}
