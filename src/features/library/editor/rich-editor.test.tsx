import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSkillMentions } from "@/features/links/use-skill-mentions";
import type { FileRow } from "@/lib/ipc-types";

import type { TextSelection } from "@/lib/text-selection";

import { RichEditor } from "./rich-editor";

const SKILL: FileRow = {
  id: 9,
  rootId: 1,
  path: "/Users/me/.claude/skills/code-quality/SKILL.md",
  relPath: "code-quality/SKILL.md",
  kind: "skill",
  name: "code-quality",
  description: null,
  aliases: [],
  projectDir: null,
  repositoryDir: null,
  size: 1,
  mtimeNs: 1,
  hash: "h9",
  isSymlink: false,
  symlinkTarget: null,
  firstSeenAt: 0,
  lastSeenScanId: 1,
  deletedAt: null,
};

function Document({
  body,
  onChange = () => undefined,
  onOpen = () => undefined,
  onSelectionChange = () => undefined,
}: {
  body: string;
  onChange?: (body: string) => void;
  onOpen?: (file: FileRow) => void;
  onSelectionChange?: (selection: TextSelection | null) => void;
}) {
  const mentions = useSkillMentions({ targets: [SKILL], onOpen });
  return (
    <RichEditor
      body={body}
      extensions={mentions.extensions}
      label="Body"
      onChange={onChange}
      onSelectionChange={onSelectionChange}
      readOnly={false}
    />
  );
}

async function editorView(container: HTMLElement): Promise<EditorView> {
  return await waitFor(() => {
    const content = container.querySelector<HTMLElement>(
      ".cm-content[aria-label='Body']"
    );
    const view = content ? EditorView.findFromDOM(content) : null;
    if (!view) {
      throw new Error("the live editor is not mounted yet");
    }
    return view;
  });
}

describe("RichEditor", () => {
  it.each([
    {
      file: "a CRLF file",
      body: "# Title\r\n\r\nHello.\r\n",
      saved: "# Title\r\n\r\nHello.\r\nMore.\r\n",
    },
    {
      file: "an LF file with one stray CRLF",
      body: "# Title\n\nHello.\r\nBye.\n",
      saved: "# Title\n\nHello.\nBye.\nMore.\n",
    },
  ])(
    "hands an edit of $file back with its dominant line ending",
    async ({ body, saved }) => {
      const onChange = vi.fn();
      const { container } = render(
        <Document body={body} onChange={onChange} />
      );
      const view = await editorView(container);

      act(() =>
        view.dispatch({
          changes: { from: view.state.doc.length, insert: "More.\n" },
          userEvent: "input.type",
        })
      );

      expect(onChange).toHaveBeenLastCalledWith(saved);
    }
  );

  it("opens an indexed skill named in the text on Cmd-click", async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <Document body="Run code-quality before done." onOpen={onOpen} />
    );

    const mention = await waitFor(() => {
      const found = container.querySelector('[data-skill="code-quality"]');
      if (!found) {
        throw new Error("the skill name is not marked yet");
      }
      return found;
    });
    fireEvent.click(mention);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(mention, { metaKey: true });
    expect(onOpen).toHaveBeenCalledWith(SKILL);
  });

  it("reports the selected text with the lines it covers, until the selection collapses", async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <Document
        body={"# Rules\n\nKeep it short.\nAnd kind.\n"}
        onSelectionChange={onSelectionChange}
      />
    );
    const view = await editorView(container);
    const from = view.state.doc.line(3).from + "Keep it ".length;

    act(() =>
      view.dispatch({
        selection: { anchor: from, head: view.state.doc.line(4).to },
        userEvent: "select.pointer",
      })
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      text: "short.\nAnd kind.",
      firstLine: 3,
      lastLine: 4,
    });

    act(() => view.dispatch({ selection: { anchor: from } }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });
});
