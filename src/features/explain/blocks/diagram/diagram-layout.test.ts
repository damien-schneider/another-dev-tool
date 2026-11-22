import { describe, expect, it } from "vitest";

import type { DiagramNodeSpec, DiagramSpec } from "../block-specs";
import {
  type DiagramFlowNode,
  layoutDiagram,
  readableLayout,
} from "./diagram-layout";

function node(id: string, group: string | null = null): DiagramNodeSpec {
  return {
    id,
    label: `The ${id} module`,
    detail: "Does a fair amount of work for the rest of the app",
    ref: null,
    group,
    kind: "step",
  };
}

function diagram(overrides: Partial<DiagramSpec>): DiagramSpec {
  return {
    title: null,
    direction: "down",
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function absoluteBoxes(nodes: DiagramFlowNode[]) {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  return new Map(
    nodes.map((entry) => {
      const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
      return [
        entry.id,
        {
          x: entry.position.x + (parent?.position.x ?? 0),
          y: entry.position.y + (parent?.position.y ?? 0),
          width: entry.width ?? 0,
          height: entry.height ?? 0,
        },
      ];
    })
  );
}

const edge = (from: string, to: string) => ({
  from,
  to,
  label: null,
  dashed: false,
});

describe("layoutDiagram", () => {
  it("keeps every node clear of the others", () => {
    const spec = diagram({
      nodes: ["a", "b", "c", "d", "e"].map((id) => node(id)),
      edges: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "e")],
    });

    const boxes = [...absoluteBoxes(layoutDiagram(spec).nodes).values()];

    for (const [index, box] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        const apart =
          box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("places grouped nodes inside their group container", () => {
    const spec = diagram({
      nodes: [node("ui"), node("api", "Server"), node("db", "Server")],
      edges: [edge("ui", "api"), edge("api", "db")],
    });

    const { nodes } = layoutDiagram(spec);
    const group = nodes.find((entry) => entry.type === "cluster");

    expect(group?.data.label).toBe("Server");
    for (const id of ["api", "db"]) {
      const child = nodes.find((entry) => entry.id === id);
      expect(child?.parentId).toBe(group?.id);
      expect(child?.position.x).toBeGreaterThanOrEqual(0);
      expect(child?.position.y).toBeGreaterThanOrEqual(0);
      expect(
        (child?.position.x ?? 0) + (child?.width ?? 0)
      ).toBeLessThanOrEqual(group?.width ?? 0);
      expect(
        (child?.position.y ?? 0) + (child?.height ?? 0)
      ).toBeLessThanOrEqual(group?.height ?? 0);
    }
    expect(nodes.find((entry) => entry.id === "ui")?.parentId).toBeUndefined();
  });

  it("flows left to right when the direction is right", () => {
    const spec = diagram({
      direction: "right",
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c")],
    });

    const layout = layoutDiagram(spec);
    const boxes = absoluteBoxes(layout.nodes);
    const xs = ["a", "b", "c"].map((id) => boxes.get(id)?.x ?? Number.NaN);

    expect(xs[0]).toBeLessThan(xs[1] ?? Number.NaN);
    expect(xs[1]).toBeLessThan(xs[2] ?? Number.NaN);
    expect(layout.width).toBeGreaterThan(layout.height);
  });

  it("grows a node to fit its citation", () => {
    const plain = { ...node("a"), detail: null };
    const cited = {
      ...plain,
      ref: {
        path: "src/features/explain/blocks/diagram/diagram-layout.ts",
        start: 120,
        end: 140,
      },
    };

    const [plainBox] = layoutDiagram(diagram({ nodes: [plain] })).nodes;
    const [citedBox] = layoutDiagram(diagram({ nodes: [cited] })).nodes;

    expect(citedBox?.width).toBeGreaterThan(plainBox?.width ?? Number.NaN);
    expect(citedBox?.height).toBeGreaterThan(plainBox?.height ?? Number.NaN);
  });
});

describe("readableLayout", () => {
  const chain = (ids: string[]) =>
    diagram({
      direction: "right",
      nodes: ids.map((id) => node(id)),
      edges: ids.slice(1).map((id, index) => edge(ids[index] ?? "", id)),
    });
  const positions = (spec: DiagramSpec, axis: "x" | "y") => {
    const boxes = absoluteBoxes(readableLayout(spec).nodes);
    return spec.nodes.map((entry) => boxes.get(entry.id)?.[axis] ?? Number.NaN);
  };
  const increasing = (values: number[]) =>
    values.every(
      (value, index) => index === 0 || value > (values[index - 1] ?? value)
    );

  it("keeps a short flow in the direction it was asked for", () => {
    expect(increasing(positions(chain(["a", "b", "c"]), "x"))).toBe(true);
  });

  it("draws a long left-to-right chain top-down when that shows it larger", () => {
    const spec = chain(["a", "b", "c", "d", "e", "f"]);

    expect(increasing(positions(spec, "y"))).toBe(true);
  });
});
