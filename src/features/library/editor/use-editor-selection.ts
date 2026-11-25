import { useState } from "react";
import {
  type FrontmatterSplit,
  joinFrontmatter,
} from "@/lib/agent-files/frontmatter";
import { lineBreaks, type TextSelection } from "@/lib/text-selection";
import type { EditorMode } from "../use-file-content";

interface Shown {
  mode: EditorMode;
  revision: number;
  split: FrontmatterSplit | null;
}

/** A selection belongs to the editor that reported it: once another mode or revision shows, it is gone. */
export function useEditorSelection({ mode, revision, split }: Shown) {
  const editor = `${mode}:${revision}`;
  const [reported, setReported] = useState<{
    editor: string;
    selection: TextSelection;
  } | null>(null);
  const headerLines =
    mode === "rich" && split
      ? lineBreaks(joinFrontmatter({ ...split, body: "" }))
      : 0;

  return {
    selection:
      reported?.editor === editor
        ? {
            text: reported.selection.text,
            firstLine: reported.selection.firstLine + headerLines,
            lastLine: reported.selection.lastLine + headerLines,
          }
        : null,
    select: (selection: TextSelection | null) =>
      setReported(selection && { editor, selection }),
    clear: () => setReported(null),
  };
}
