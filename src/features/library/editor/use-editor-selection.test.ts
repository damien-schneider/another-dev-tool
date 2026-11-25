import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { splitFrontmatter } from "@/lib/agent-files/frontmatter";

import type { EditorMode } from "../use-file-content";
import { useEditorSelection } from "./use-editor-selection";

const SKILL = "---\nname: demo\ndescription: Demo.\n---\nKeep it short.\n";
const SELECTED = { text: "Keep it short.", firstLine: 1, lastLine: 1 };

function selecting(mode: EditorMode) {
  const view = renderHook(
    ({ revision }) =>
      useEditorSelection({ mode, revision, split: splitFrontmatter(SKILL) }),
    { initialProps: { revision: 1 } }
  );
  act(() => view.result.current.select(SELECTED));
  return view;
}

describe("useEditorSelection", () => {
  it("counts the visual editor's lines from the top of the file, frontmatter included", () => {
    expect(selecting("rich").result.current.selection).toEqual({
      text: "Keep it short.",
      firstLine: 5,
      lastLine: 5,
    });
  });

  it("keeps the source editor's lines, which already start at the top of the file", () => {
    expect(selecting("raw").result.current.selection).toEqual(SELECTED);
  });

  it("lets go of the selection once the editor shows another version of the file", () => {
    const view = selecting("rich");

    view.rerender({ revision: 2 });

    expect(view.result.current.selection).toBeNull();
  });
});
