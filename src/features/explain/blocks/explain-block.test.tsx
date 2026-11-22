import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExplainSurfaceContext } from "../explain-surface";
import { ExplainBlock } from "./explain-block";

const mocks = vi.hoisted(() => ({
  explainReadSource: vi.fn(),
  openRef: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  explainReadSource: mocks.explainReadSource,
  toIpcError: (cause: unknown) =>
    cause instanceof Error ? cause : new Error(String(cause)),
}));

const OPEN_PARSER = /open src\/parser\.ts:3-8/i;

function Surface({ children }: { children: ReactNode }) {
  return (
    <ExplainSurfaceContext value={{ project: "/p", openRef: mocks.openRef }}>
      {children}
    </ExplainSurfaceContext>
  );
}

function codeLines(container: HTMLElement, selector = '[data-slot="line"]') {
  return [...container.querySelectorAll(selector)].map(
    (line) => line.querySelector("code")?.textContent ?? ""
  );
}

describe("ExplainBlock", () => {
  beforeEach(() => {
    mocks.explainReadSource.mockReset();
    mocks.openRef.mockReset();
  });

  it("shows a calm placeholder while the block is still streaming", () => {
    render(
      <Surface>
        <ExplainBlock kind="diagram" source='{"nodes": [{"id": "a"' streaming />
      </Surface>
    );

    expect(screen.getByRole("status")).toHaveTextContent("Drawing a diagram…");
  });

  it("falls back to the raw source when a finished block can't be read", () => {
    const source = '{"nodes": [{"id": "a"';
    const { container } = render(
      <Surface>
        <ExplainBlock kind="diagram" source={source} streaming={false} />
      </Surface>
    );

    expect(screen.queryByText("Drawing a diagram…")).not.toBeInTheDocument();
    expect(container).toHaveTextContent(source);
  });

  it("renders steps with links that open their code", () => {
    render(
      <Surface>
        <ExplainBlock
          kind="steps"
          source={JSON.stringify({
            title: "How a request is parsed",
            steps: [
              { title: "Read the body", detail: "Buffers the stream" },
              { title: "Tokenize", ref: "src/parser.ts:3-8" },
            ],
          })}
          streaming={false}
        />
      </Surface>
    );

    expect(screen.getByText("How a request is parsed")).toBeInTheDocument();
    expect(screen.getByText("Read the body")).toBeInTheDocument();
    expect(screen.getByText("Buffers the stream")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: OPEN_PARSER }));

    expect(mocks.openRef).toHaveBeenCalledWith({
      path: "src/parser.ts",
      start: 3,
      end: 8,
    });
  });

  it("shows the referenced lines from disk and highlights the focus", async () => {
    const text = Array.from(
      { length: 30 },
      (_, index) => `const line${index + 1} = ${index + 1};`
    ).join("\n");
    mocks.explainReadSource.mockResolvedValue({ path: "src/loop.ts", text });

    const { container } = render(
      <Surface>
        <ExplainBlock
          kind="excerpt"
          source='{"ref": "src/loop.ts:10-14", "focus": "12-13"}'
          streaming={false}
        />
      </Surface>
    );

    await waitFor(() =>
      expect(codeLines(container)).toEqual([
        "const line10 = 10;",
        "const line11 = 11;",
        "const line12 = 12;",
        "const line13 = 13;",
        "const line14 = 14;",
      ])
    );
    expect(
      codeLines(container, '[data-slot="line"][data-highlighted="true"]')
    ).toEqual(["const line12 = 12;", "const line13 = 13;"]);
    expect(mocks.explainReadSource).toHaveBeenCalledWith("/p", "src/loop.ts");
  });
});
