import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownEditorBubbleMenu } from "@ctrl-ui/react/markdown-editor/bubble-menu";
import { useMarkdownEditor } from "@ctrl-ui/react/markdown-editor/context";
import { MarkdownEditorSuggestions } from "@ctrl-ui/react/markdown-editor/suggestions";
import {
  MarkdownEditor,
  MarkdownEditorContent,
} from "@ctrl-ui/react/markdown-editor-live";

import { restoreLineEndings } from "@/lib/agent-files/line-endings";
import { isDocumentUrlAllowed } from "@/lib/document-url-policy";
import { type TextSelection, textSelection } from "@/lib/text-selection";

// The page scrolls, not the editor: it grows with its content and draws no frame of its own.
const EDITOR_STYLE = {
  "--cui-markdown-editor-background": "transparent",
  "--cui-markdown-editor-border-width": "0px",
  "--cui-markdown-editor-radius": "0px",
  "--cui-markdown-editor-max-height": "100%",
  "--cui-markdown-editor-min-height": "40dvh",
} as const;

/** Table cells are editors nested in the document's own; their selection reaches it in document positions. */
function reportSelection(
  onSelectionChange: (selection: TextSelection | null) => void
) {
  return EditorView.updateListener.of(({ docChanged, selectionSet, view }) => {
    if (
      !(docChanged || selectionSet) ||
      view.dom.parentElement?.closest(".cm-editor")
    ) {
      return;
    }
    const { from, to } = view.state.selection.main;
    onSelectionChange(
      textSelection(view.state.sliceDoc(0, from), view.state.sliceDoc(from, to))
    );
  });
}

function RichEditorContent({ label }: { label: string }) {
  const { engine } = useMarkdownEditor();
  // Until the editor exists the library shows the raw text in a disabled box; hiding it avoids a flash of source.
  return (
    <MarkdownEditorContent
      className={engine ? undefined : "invisible"}
      label={label}
      placeholder="Write the instructions. Type / for headings, lists and code."
    />
  );
}

/** Uncontrolled: give it a new `key` to show another document. It keeps the `onSelectionChange` it mounted with. */
export function RichEditor({
  body,
  extensions,
  label,
  onChange,
  onSelectionChange,
  readOnly,
}: {
  body: string;
  extensions: Extension;
  label: string;
  onChange: (body: string) => void;
  onSelectionChange: (selection: TextSelection | null) => void;
  readOnly: boolean;
}) {
  return (
    <MarkdownEditor
      className="document-editor"
      defaultValue={body}
      extensions={[extensions, reportSelection(onSelectionChange)]}
      isUrlAllowed={isDocumentUrlAllowed}
      onValueChange={(markdown) => onChange(restoreLineEndings(markdown, body))}
      readOnly={readOnly}
      style={EDITOR_STYLE}
    >
      <RichEditorContent label={label} />
      <MarkdownEditorBubbleMenu />
      <MarkdownEditorSuggestions />
    </MarkdownEditor>
  );
}
