import { cn } from "@ctrl-ui/react/lib/cn";
import { FileCode } from "lucide-react";
import type { ReactNode } from "react";

import { useExplainSurface } from "../explain-surface";
import { type CodeRef, codeRefLabel, formatCodeRef } from "./code-ref";

export function CodeRefLink({
  codeRef,
  children,
  className,
}: {
  codeRef: CodeRef;
  /** Defaults to the file name and its lines. */
  children?: ReactNode;
  className?: string;
}) {
  const { openRef } = useExplainSurface();
  const full = formatCodeRef(codeRef);

  return (
    <button
      className={cn(
        "text-primary-text focus-visible:outline-ring inline-flex max-w-full items-baseline gap-1 rounded-sm bg-[oklch(from_var(--foreground)_l_c_h/0.06)] px-1 py-0.5 text-start font-mono text-[0.9em] underline-offset-2 hover:underline focus-visible:outline-2",
        className
      )}
      onClick={() => openRef(codeRef)}
      title={full}
      type="button"
    >
      <FileCode aria-hidden="true" className="size-3.5 shrink-0 self-center" />
      <span className="min-w-0 truncate">
        {children ?? codeRefLabel(codeRef)}
      </span>
      <span className="sr-only">{`, open ${full}`}</span>
    </button>
  );
}
