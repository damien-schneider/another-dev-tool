import { MarkdownCode } from "@ctrl-ui/react/ui/markdown-components";
import {
  MarkdownA,
  type MarkdownCodeProps,
  MarkdownInlineCode,
} from "@ctrl-ui/react/ui/markdown-elements";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ComponentProps, ReactNode } from "react";

import type { TranscriptMarkdown } from "@/features/agent/agent-transcript";

import { blockKind } from "./blocks/block-specs";
import { ExplainBlock } from "./blocks/explain-block";
import { parseCodeRef } from "./source/code-ref";
import { CodeRefLink } from "./source/code-ref-link";

const LANGUAGE_PATTERN = /language-([\w+#-]+)/;
const EXTERNAL_PATTERN = /^(?:https?|mailto):/i;

const textOf = (children: ReactNode) =>
  Array.isArray(children) ? children.join("") : String(children ?? "");

function ExplainInlineCode(props: MarkdownCodeProps) {
  const codeRef = parseCodeRef(textOf(props.children));
  return codeRef ? (
    <CodeRefLink codeRef={codeRef} />
  ) : (
    <MarkdownInlineCode {...props} />
  );
}

function ExplainCode({
  streaming,
  ...props
}: MarkdownCodeProps & { streaming: boolean }) {
  const text = textOf(props.children);
  const kind = blockKind(LANGUAGE_PATTERN.exec(props.className ?? "")?.[1]);
  if (kind) {
    return <ExplainBlock kind={kind} source={text} streaming={streaming} />;
  }
  if (!(props.className || text.includes("\n"))) {
    return <ExplainInlineCode {...props} />;
  }
  return <MarkdownCode {...props} />;
}

function ExplainLink({
  href = "",
  children,
  ...props
}: ComponentProps<typeof MarkdownA>) {
  const external = EXTERNAL_PATTERN.test(href);
  const codeRef = external ? null : parseCodeRef(href);
  if (codeRef) {
    return <CodeRefLink codeRef={codeRef}>{children}</CodeRefLink>;
  }
  return (
    <MarkdownA
      {...props}
      href={href || undefined}
      onClick={(event) => {
        if (href.startsWith("#")) {
          return;
        }
        event.preventDefault();
        if (external) {
          openUrl(href).catch(() => undefined);
        }
      }}
    >
      {children}
    </MarkdownA>
  );
}

export const EXPLAIN_MARKDOWN: TranscriptMarkdown = {
  static: {
    code: (props: MarkdownCodeProps) => (
      <ExplainCode {...props} streaming={false} />
    ),
    inlineCode: ExplainInlineCode,
    a: ExplainLink,
  },
  streaming: {
    code: (props: MarkdownCodeProps) => <ExplainCode {...props} streaming />,
    inlineCode: ExplainInlineCode,
    a: ExplainLink,
  },
};
