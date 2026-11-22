import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import { Graph, layout } from "@dagrejs/dagre";
import { type Edge, MarkerType, type Node, Position } from "@xyflow/react";

import { type CodeRef, codeRefLabel } from "../../source/code-ref";
import type { DiagramNodeKind, DiagramSpec } from "../block-specs";

export interface DiagramItemData extends Record<string, unknown> {
  label: string;
  detail: string | null;
  codeRef: CodeRef | null;
  kind: DiagramNodeKind;
  targetPosition: Position;
  sourcePosition: Position;
}

export interface DiagramClusterData extends Record<string, unknown> {
  label: string;
}

export type DiagramItemNode = Node<DiagramItemData, "item">;
export type DiagramClusterNode = Node<DiagramClusterData, "cluster">;
export type DiagramFlowNode = DiagramItemNode | DiagramClusterNode;

export type DiagramFlowEdge = Edge<
  { label: string | null; dashed: boolean },
  "diagram"
>;

export interface DiagramLayout {
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
  width: number;
  height: number;
}

const CHAR_WIDTH = 7.5;
const DETAIL_CHAR_WIDTH = 6.5;
const MONO_CHAR_WIDTH = 6.8;
const MIN_NODE_WIDTH = 150;
const MAX_NODE_WIDTH = 250;
const HEADER_CHROME = 52;
const BODY_INSET = 24;
const CLUSTER_LABEL_SPACE = 28;
const CLUSTER_ID_PREFIX = "cluster:";
const READABLE_SCALE = 0.8;
const INLINE_WIDTH = 680;
const MIN_INLINE_HEIGHT = 180;
const MAX_INLINE_HEIGHT = 640;
const CANVAS_PADDING = 48;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function estimateNodeSize(
  label: string,
  detail: string | null,
  codeRef: CodeRef | null
) {
  const wanted = Math.max(
    label.length * CHAR_WIDTH + HEADER_CHROME,
    detail === null ? 0 : (detail.length * DETAIL_CHAR_WIDTH) / 2 + BODY_INSET,
    codeRef === null
      ? 0
      : codeRefLabel(codeRef).length * MONO_CHAR_WIDTH + BODY_INSET
  );
  const width = Math.round(
    Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, wanted))
  );
  const labelLines = Math.min(
    2,
    Math.ceil((label.length * CHAR_WIDTH) / (width - HEADER_CHROME))
  );
  const detailLines =
    detail === null
      ? 0
      : Math.min(
          3,
          Math.ceil((detail.length * DETAIL_CHAR_WIDTH) / (width - BODY_INSET))
        );
  const height =
    30 +
    labelLines * 20 +
    (detailLines > 0 ? 6 + detailLines * 16 : 0) +
    (codeRef === null ? 0 : 22);
  return { width, height };
}

function centeredBox(label: NodeLabel): Box {
  const x = label.x ?? 0;
  const y = label.y ?? 0;
  return {
    x: x - label.width / 2,
    y: y - label.height / 2,
    width: label.width,
    height: label.height,
  };
}

export function layoutDiagram(spec: DiagramSpec): DiagramLayout {
  const horizontal = spec.direction === "right";
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({
    compound: true,
    multigraph: true,
  });
  graph.setGraph({
    rankdir: horizontal ? "LR" : "TB",
    nodesep: 32,
    ranksep: 40,
    edgesep: 16,
    marginx: 8,
    marginy: 8,
  });

  const groups = [
    ...new Set(spec.nodes.flatMap((node) => (node.group ? [node.group] : []))),
  ];
  for (const group of groups) {
    graph.setNode(`${CLUSTER_ID_PREFIX}${group}`, { width: 0, height: 0 });
  }
  for (const node of spec.nodes) {
    graph.setNode(node.id, estimateNodeSize(node.label, node.detail, node.ref));
    if (node.group) {
      graph.setParent(node.id, `${CLUSTER_ID_PREFIX}${node.group}`);
    }
  }
  spec.edges.forEach((edge, index) => {
    graph.setEdge(
      edge.from,
      edge.to,
      edge.label === null
        ? { minlen: 1 }
        : {
            minlen: 1,
            width: edge.label.length * DETAIL_CHAR_WIDTH + 20,
            height: 24,
            labelpos: "c",
          },
      `e${index}`
    );
  });

  layout(graph);

  const clusterBoxes = new Map<string, Box>();
  for (const group of groups) {
    const box = centeredBox(graph.node(`${CLUSTER_ID_PREFIX}${group}`));
    clusterBoxes.set(group, {
      x: box.x,
      y: box.y - CLUSTER_LABEL_SPACE,
      width: box.width,
      height: box.height + CLUSTER_LABEL_SPACE,
    });
  }
  const itemBoxes = new Map(
    spec.nodes.map((node) => [node.id, centeredBox(graph.node(node.id))])
  );

  const allBoxes = [...clusterBoxes.values(), ...itemBoxes.values()];
  const minX = Math.min(...allBoxes.map((box) => box.x));
  const minY = Math.min(...allBoxes.map((box) => box.y));
  const maxX = Math.max(...allBoxes.map((box) => box.x + box.width));
  const maxY = Math.max(...allBoxes.map((box) => box.y + box.height));

  const clusterNodes = groups.flatMap((group): DiagramClusterNode[] => {
    const box = clusterBoxes.get(group);
    return box
      ? [
          {
            id: `${CLUSTER_ID_PREFIX}${group}`,
            type: "cluster",
            position: { x: box.x - minX, y: box.y - minY },
            width: box.width,
            height: box.height,
            data: { label: group },
            selectable: false,
            focusable: false,
          },
        ]
      : [];
  });

  const itemNodes = spec.nodes.flatMap((node): DiagramItemNode[] => {
    const box = itemBoxes.get(node.id);
    if (!box) {
      return [];
    }
    const parent = node.group ? clusterBoxes.get(node.group) : undefined;
    const origin = parent ?? { x: minX, y: minY };
    return [
      {
        id: node.id,
        type: "item",
        position: { x: box.x - origin.x, y: box.y - origin.y },
        width: box.width,
        height: box.height,
        ...(parent && node.group
          ? { parentId: `${CLUSTER_ID_PREFIX}${node.group}` }
          : {}),
        data: {
          label: node.label,
          detail: node.detail,
          codeRef: node.ref,
          kind: node.kind,
          targetPosition: horizontal ? Position.Left : Position.Top,
          sourcePosition: horizontal ? Position.Right : Position.Bottom,
        },
        selectable: false,
        focusable: false,
      },
    ];
  });

  const edges = spec.edges.map(
    (edge, index): DiagramFlowEdge => ({
      id: `e${index}`,
      type: "diagram",
      source: edge.from,
      target: edge.to,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      zIndex: 1,
      focusable: false,
      selectable: false,
      data: { label: edge.label, dashed: edge.dashed },
    })
  );

  return {
    nodes: [...clusterNodes, ...itemNodes],
    edges,
    width: maxX - minX,
    height: maxY - minY,
  };
}

const inlineScale = (drawn: DiagramLayout) =>
  Math.min(
    1,
    INLINE_WIDTH / (drawn.width + CANVAS_PADDING),
    MAX_INLINE_HEIGHT / (drawn.height + CANVAS_PADDING)
  );

export function inlineHeight(drawn: DiagramLayout) {
  return Math.round(
    Math.max(
      MIN_INLINE_HEIGHT,
      (drawn.height + CANVAS_PADDING) * inlineScale(drawn)
    )
  );
}

export function readableLayout(spec: DiagramSpec): DiagramLayout {
  const requested = layoutDiagram(spec);
  if (inlineScale(requested) >= READABLE_SCALE) {
    return requested;
  }
  const turned = layoutDiagram({
    ...spec,
    direction: spec.direction === "right" ? "down" : "right",
  });
  return inlineScale(turned) > inlineScale(requested) ? turned : requested;
}
