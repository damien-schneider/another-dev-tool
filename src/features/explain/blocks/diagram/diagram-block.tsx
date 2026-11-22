import { Button } from "@ctrl-ui/react/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ctrl-ui/react/ui/dialog";
import {
  Flow,
  FlowControls,
  FlowEdge,
  FlowEdgeLabel,
  FlowEdgeLabelChip,
  FlowHandle,
  type FlowHandleProps,
  FlowNode,
  FlowNodeBody,
  FlowNodeHeader,
  FlowPanel,
} from "@ctrl-ui/react/ui/flow";
import { Text } from "@ctrl-ui/react/ui/typography";
import {
  type EdgeProps,
  type EdgeTypes,
  getBezierPath,
  type NodeProps,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  Box,
  Cloud,
  Database,
  LogIn,
  type LucideIcon,
  Maximize2,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { useExplainSurface } from "../../explain-surface";
import { codeRefLabel, formatCodeRef } from "../../source/code-ref";
import {
  type DiagramNodeKind,
  type DiagramSpec,
  keyedByContent,
} from "../block-specs";
import {
  type DiagramClusterNode,
  type DiagramFlowEdge,
  type DiagramFlowNode,
  type DiagramItemNode,
  type DiagramLayout,
  inlineHeight,
  readableLayout,
} from "./diagram-layout";

const KIND_ICONS: Record<DiagramNodeKind, LucideIcon> = {
  entry: LogIn,
  store: Database,
  external: Cloud,
  step: Box,
};

const KIND_NAMES: Record<DiagramNodeKind, string> = {
  entry: "entry point",
  store: "data store",
  external: "external service",
  step: "step",
};

const FIT_VIEW_OPTIONS = { padding: 0.12, maxZoom: 1 };
const PRO_OPTIONS = { hideAttribution: true };
const HIDDEN_HANDLE: FlowHandleProps["style"] = {
  "--cui-flow-handle-size": "1px",
  "--cui-flow-handle-background": "transparent",
  "--cui-flow-handle-border-width": "0px",
};

function DiagramItem({ data }: NodeProps<DiagramItemNode>) {
  const { openRef } = useExplainSurface();
  const Icon = KIND_ICONS[data.kind];
  const { codeRef } = data;

  return (
    <FlowNode className="relative size-full overflow-hidden">
      <FlowHandle
        isConnectable={false}
        position={data.targetPosition}
        style={HIDDEN_HANDLE}
        type="target"
      />
      <FlowNodeHeader className="items-start gap-2">
        <Icon
          aria-hidden="true"
          className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
        />
        <span className="line-clamp-2 min-w-0">{data.label}</span>
      </FlowNodeHeader>
      {data.detail ? (
        <FlowNodeBody>
          <Text className="line-clamp-3" size="caption" tone="muted">
            {data.detail}
          </Text>
        </FlowNodeBody>
      ) : null}
      {codeRef ? (
        <>
          <div aria-hidden="true" className="px-3 pt-1">
            <Text className="truncate" mono size="micro" tone="primary">
              {codeRefLabel(codeRef)}
            </Text>
          </div>
          <button
            aria-label={`${data.label}, open ${formatCodeRef(codeRef)}`}
            className="nodrag nopan focus-visible:outline-ring absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2"
            onClick={() => openRef(codeRef)}
            title={formatCodeRef(codeRef)}
            type="button"
          />
        </>
      ) : null}
      <FlowHandle
        isConnectable={false}
        position={data.sourcePosition}
        style={HIDDEN_HANDLE}
        type="source"
      />
    </FlowNode>
  );
}

function DiagramCluster({ data }: NodeProps<DiagramClusterNode>) {
  return (
    <div className="rounded-panel border-border size-full border border-dashed bg-[oklch(from_var(--foreground)_l_c_h/0.03)]">
      <div className="px-3 pt-1.5">
        <Text className="truncate" size="caption" tone="muted" weight="medium">
          {data.label}
        </Text>
      </div>
    </div>
  );
}

function DiagramEdgePath({
  id,
  data,
  markerEnd,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<DiagramFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <FlowEdge
        dashed={data?.dashed}
        id={id}
        markerEnd={markerEnd}
        path={path}
      />
      {data?.label ? (
        <FlowEdgeLabel x={labelX} y={labelY}>
          <FlowEdgeLabelChip>{data.label}</FlowEdgeLabelChip>
        </FlowEdgeLabel>
      ) : null}
    </>
  );
}

const NODE_TYPES: NodeTypes = { item: DiagramItem, cluster: DiagramCluster };
const EDGE_TYPES: EdgeTypes = { diagram: DiagramEdgePath };

function DiagramCanvas({
  layout,
  label,
  children,
}: {
  layout: DiagramLayout;
  label: string;
  children?: ReactNode;
}) {
  return (
    <ReactFlowProvider>
      <Flow<DiagramFlowNode, DiagramFlowEdge>
        aria-label={label}
        edges={layout.edges}
        edgesFocusable={false}
        edgeTypes={EDGE_TYPES}
        elementsSelectable={false}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        nodes={layout.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        nodeTypes={NODE_TYPES}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={PRO_OPTIONS}
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
      >
        <FlowControls fitViewOptions={FIT_VIEW_OPTIONS} />
        {children}
      </Flow>
    </ReactFlowProvider>
  );
}

function DiagramDescription({ spec }: { spec: DiagramSpec }) {
  const labels = new Map(spec.nodes.map((node) => [node.id, node.label]));
  return (
    <div className="sr-only">
      <p>{`Diagram with ${spec.nodes.length} parts.`}</p>
      <ul>
        {spec.nodes.map((node) => (
          <li key={node.id}>
            {[
              node.label,
              KIND_NAMES[node.kind],
              node.group ? `in ${node.group}` : null,
              node.detail,
              node.ref ? formatCodeRef(node.ref) : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </li>
        ))}
      </ul>
      {spec.edges.length > 0 ? (
        <>
          <p>Connections:</p>
          <ul>
            {keyedByContent(
              spec.edges,
              (edge) => `${edge.from}->${edge.to}:${edge.label ?? ""}`
            ).map(({ key, item: edge }) => (
              <li key={key}>
                {`${labels.get(edge.from) ?? edge.from} → ${labels.get(edge.to) ?? edge.to}${edge.label ? ` (${edge.label})` : ""}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function DiagramBlock({ spec }: { spec: DiagramSpec }) {
  const layout = useMemo(() => readableLayout(spec), [spec]);
  const label = spec.title ?? "Diagram";
  const height = inlineHeight(layout);

  return (
    <Dialog>
      <div className="w-full" style={{ height }}>
        <DiagramCanvas label={label} layout={layout}>
          <FlowPanel position="top-right">
            <DialogTrigger
              render={
                <Button size="sm" variant="surface">
                  <Maximize2 aria-hidden="true" />
                  Expand
                </Button>
              }
            />
          </FlowPanel>
        </DiagramCanvas>
      </div>
      <DiagramDescription spec={spec} />
      <DialogContent style={{ "--cui-popup-dialog-max-inline-size": "72rem" }}>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="rounded-panel border-border h-[70vh] w-full overflow-hidden border">
            <DiagramCanvas label={label} layout={layout} />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
