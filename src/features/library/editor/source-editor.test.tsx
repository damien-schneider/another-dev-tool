import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceEditor } from "./source-editor";

describe("SourceEditor", () => {
  it("keeps a CRLF file's line endings when the source is edited", () => {
    const onChange = vi.fn();
    render(
      <SourceEditor
        label="Source"
        onChange={onChange}
        onSelectionChange={() => undefined}
        readOnly={false}
        value={"---\r\nname: demo\r\n---\r\nBody.\r\n"}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
      target: { value: "---\nname: demo\n---\nBody.\nMore.\n" },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "---\r\nname: demo\r\n---\r\nBody.\r\nMore.\r\n"
    );
  });

  it("reports the selected text with the lines it covers, until the selection collapses", () => {
    const onSelectionChange = vi.fn();
    const value = "---\nname: demo\n---\nKeep it short.\nAnd kind.\n";
    render(
      <SourceEditor
        label="Source"
        onChange={() => undefined}
        onSelectionChange={onSelectionChange}
        readOnly={false}
        value={value}
      />
    );
    const source = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Source",
    });
    const from = value.indexOf("short");
    const select = (start: number, end: number) =>
      act(() => {
        source.setSelectionRange(start, end);
        fireEvent.mouseUp(source);
      });

    act(() => source.focus());
    select(from, value.indexOf("kind.") + "kind.\n".length);
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      text: "short.\nAnd kind.",
      firstLine: 4,
      lastLine: 5,
    });

    select(from, from);
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });
});
