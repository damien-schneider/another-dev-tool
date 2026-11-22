import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SourceEditor } from "./source-editor";

describe("SourceEditor", () => {
  it("keeps a CRLF file's line endings when the source is edited", () => {
    const onChange = vi.fn();
    render(
      <SourceEditor
        label="Source"
        onChange={onChange}
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
});
