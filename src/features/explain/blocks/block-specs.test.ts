import { describe, expect, it } from "vitest";

import explainerPrompt from "../../../../src-tauri/src/explain/prompts/system.md?raw";
import { blockKind, parseBlock } from "./block-specs";

const FENCE = /```(\w+)\n([\s\S]*?)\n```/g;

describe("the explainer's system prompt", () => {
  it("teaches every visual block, each in a form the app renders", () => {
    const examples = [...explainerPrompt.matchAll(FENCE)].map(
      ([, language, body = ""]) => ({ kind: blockKind(language), body })
    );

    expect(examples.map(({ kind }) => kind)).toEqual([
      "diagram",
      "steps",
      "excerpt",
      "files",
      "chart",
      "stats",
    ]);
    for (const { kind, body } of examples) {
      expect(kind && parseBlock(kind, body)).not.toBeNull();
    }
  });
});

describe("blockKind", () => {
  it("recognises block languages whatever their case", () => {
    expect(blockKind("diagram")).toBe("diagram");
    expect(blockKind(" Chart ")).toBe("chart");
  });

  it("leaves ordinary code languages alone", () => {
    expect(blockKind("ts")).toBeNull();
    expect(blockKind(undefined)).toBeNull();
  });
});

describe("parseBlock", () => {
  it("reads a complete diagram", () => {
    const block = parseBlock(
      "diagram",
      JSON.stringify({
        title: "Request flow",
        direction: "right",
        nodes: [
          { id: "ui", label: "UI", kind: "entry", ref: "src/app.tsx:4-9" },
          { id: "db", label: "SQLite", kind: "store", group: "Backend" },
        ],
        edges: [{ from: "ui", to: "db", label: "query", dashed: true }],
      })
    );

    expect(block).toEqual({
      kind: "diagram",
      spec: {
        title: "Request flow",
        direction: "right",
        nodes: [
          {
            id: "ui",
            label: "UI",
            detail: null,
            ref: { path: "src/app.tsx", start: 4, end: 9 },
            group: null,
            kind: "entry",
          },
          {
            id: "db",
            label: "SQLite",
            detail: null,
            ref: null,
            group: "Backend",
            kind: "store",
          },
        ],
        edges: [{ from: "ui", to: "db", label: "query", dashed: true }],
      },
    });
  });

  it("waits while the JSON is still arriving", () => {
    expect(parseBlock("steps", '{"steps": [{"title": "Boot"')).toBeNull();
    expect(parseBlock("diagram", "")).toBeNull();
  });

  it("gives up when nothing in the block can be drawn", () => {
    expect(parseBlock("diagram", '{"nodes": [], "edges": []}')).toBeNull();
    expect(
      parseBlock(
        "chart",
        '{"type": "bar", "x": "day", "series": [], "data": []}'
      )
    ).toBeNull();
    expect(parseBlock("stats", "[1, 2, 3]")).toBeNull();
  });

  it("drops edges that point at unknown nodes and labels nodes by id", () => {
    const block = parseBlock(
      "diagram",
      JSON.stringify({
        nodes: [{ id: "a" }, { id: "b", label: "B" }, { label: "no id" }],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "ghost" },
        ],
      })
    );

    expect(block?.kind).toBe("diagram");
    if (block?.kind !== "diagram") {
      return;
    }
    expect(block.spec.nodes.map((node) => node.label)).toEqual(["a", "B"]);
    expect(block.spec.edges).toEqual([
      { from: "a", to: "b", label: null, dashed: false },
    ]);
  });

  it("coerces numeric strings in chart rows and skips rows without the x key", () => {
    const block = parseBlock(
      "chart",
      JSON.stringify({
        type: "line",
        x: "month",
        series: [{ key: "users", label: "Users" }, { key: "ghost" }],
        data: [
          { month: "Jan", users: "1,200" },
          { month: "Feb", users: 1500 },
          { users: 99 },
        ],
      })
    );

    expect(block?.kind).toBe("chart");
    if (block?.kind !== "chart") {
      return;
    }
    expect(block.spec.series).toEqual([{ key: "users", label: "Users" }]);
    expect(
      block.spec.rows.map((row) => [row.x, row.values.get("users")])
    ).toEqual([
      ["Jan", 1200],
      ["Feb", 1500],
    ]);
  });

  it("keeps only files whose ref points at a file", () => {
    const block = parseBlock(
      "files",
      JSON.stringify({
        files: [
          { ref: "src/main.ts", role: "Entry", change: "added" },
          { ref: "not a path at all", role: "Nope" },
          { ref: "src/db.rs:10-20", role: "Storage", change: "rewritten" },
        ],
      })
    );

    expect(block?.kind).toBe("files");
    if (block?.kind !== "files") {
      return;
    }
    expect(block.spec.files).toEqual([
      {
        ref: { path: "src/main.ts", start: null, end: null },
        role: "Entry",
        change: "added",
      },
      {
        ref: { path: "src/db.rs", start: 10, end: 20 },
        role: "Storage",
        change: null,
      },
    ]);
  });

  it("turns an excerpt focus range into the lines to highlight", () => {
    const block = parseBlock(
      "excerpt",
      '{"ref": "src/a.ts:10-20", "focus": "14-16", "note": "The loop"}'
    );

    expect(block).toEqual({
      kind: "excerpt",
      spec: {
        ref: { path: "src/a.ts", start: 10, end: 20 },
        focus: [14, 15, 16],
        note: "The loop",
      },
    });
  });
});
