import { type CodeRef, parseCodeRef } from "../source/code-ref";

export type BlockKind =
  | "diagram"
  | "chart"
  | "files"
  | "steps"
  | "excerpt"
  | "stats";

const BLOCK_KINDS: readonly BlockKind[] = [
  "diagram",
  "chart",
  "files",
  "steps",
  "excerpt",
  "stats",
];

const TRAILING_PERCENT = /%$/;
const FOCUS_RANGE = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

export type DiagramNodeKind = "entry" | "store" | "external" | "step";

export interface DiagramNodeSpec {
  id: string;
  label: string;
  detail: string | null;
  ref: CodeRef | null;
  group: string | null;
  kind: DiagramNodeKind;
}

export interface DiagramEdgeSpec {
  from: string;
  to: string;
  label: string | null;
  dashed: boolean;
}

export interface DiagramSpec {
  title: string | null;
  direction: "down" | "right";
  nodes: DiagramNodeSpec[];
  edges: DiagramEdgeSpec[];
}

export type ChartType = "bar" | "line" | "area" | "donut";

export interface ChartSeriesSpec {
  key: string;
  label: string;
}

export interface ChartRowSpec {
  x: string;
  values: Map<string, number>;
}

export interface ChartSpec {
  title: string | null;
  caption: string | null;
  type: ChartType;
  x: string;
  series: ChartSeriesSpec[];
  rows: ChartRowSpec[];
  horizontal: boolean;
  stacked: boolean;
  unit: string | null;
}

export type FileChange = "added" | "modified" | "deleted" | "renamed";

export interface FileSpec {
  ref: CodeRef;
  role: string;
  change: FileChange | null;
}

export interface FilesSpec {
  title: string | null;
  files: FileSpec[];
}

export interface StepSpec {
  title: string;
  detail: string | null;
  ref: CodeRef | null;
}

export interface StepsSpec {
  title: string | null;
  steps: StepSpec[];
}

export interface ExcerptSpec {
  ref: CodeRef;
  focus: number[];
  note: string | null;
}

export interface StatSpec {
  label: string;
  value: string | number;
  hint: string | null;
}

export interface StatsSpec {
  title: string | null;
  items: StatSpec[];
}

export type ParsedBlock =
  | { kind: "diagram"; spec: DiagramSpec }
  | { kind: "chart"; spec: ChartSpec }
  | { kind: "files"; spec: FilesSpec }
  | { kind: "steps"; spec: StepsSpec }
  | { kind: "excerpt"; spec: ExcerptSpec }
  | { kind: "stats"; spec: StatsSpec };

export function blockKind(language: string | undefined): BlockKind | null {
  const name = language?.trim().toLowerCase();
  return BLOCK_KINDS.find((kind) => kind === name) ?? null;
}

export function keyedByContent<T>(
  items: readonly T[],
  content: (item: T) => string
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = content(item);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { key: count === 1 ? base : `${base}#${count}`, item };
  });
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(input: object, key: string): string | null {
  const value: unknown = Reflect.get(input, key);
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function flag(input: object, key: string): boolean {
  return Reflect.get(input, key) === true;
}

function records(input: object, key: string): object[] {
  const value: unknown = Reflect.get(input, key);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function oneOf<T extends string>(
  value: string | null,
  options: readonly T[]
): T | null {
  return options.find((option) => option === value?.toLowerCase()) ?? null;
}

function ref(input: object, key: string): CodeRef | null {
  const value = text(input, key);
  return value === null ? null : parseCodeRef(value);
}

function number(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value
    .trim()
    .replaceAll(",", "")
    .replace(TRAILING_PERCENT, "");
  if (cleaned === "") {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDiagram(input: object): DiagramSpec | null {
  const seen = new Set<string>();
  const nodes: DiagramNodeSpec[] = [];
  for (const node of records(input, "nodes")) {
    const id = text(node, "id");
    if (id === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    nodes.push({
      id,
      label: text(node, "label") ?? id,
      detail: text(node, "detail"),
      ref: ref(node, "ref"),
      group: text(node, "group"),
      kind:
        oneOf(text(node, "kind"), ["entry", "store", "external", "step"]) ??
        "step",
    });
  }
  if (nodes.length === 0) {
    return null;
  }
  const edges: DiagramEdgeSpec[] = [];
  for (const edge of records(input, "edges")) {
    const from = text(edge, "from") ?? text(edge, "source");
    const to = text(edge, "to") ?? text(edge, "target");
    if (from === null || to === null || !seen.has(from) || !seen.has(to)) {
      continue;
    }
    edges.push({
      from,
      to,
      label: text(edge, "label"),
      dashed: flag(edge, "dashed"),
    });
  }
  return {
    title: text(input, "title"),
    direction: oneOf(text(input, "direction"), ["down", "right"]) ?? "down",
    nodes,
    edges,
  };
}

function parseChart(input: object): ChartSpec | null {
  const x = text(input, "x");
  if (x === null) {
    return null;
  }
  const series: ChartSeriesSpec[] = [];
  for (const entry of records(input, "series")) {
    const key = text(entry, "key");
    if (key !== null && key !== x && !series.some((s) => s.key === key)) {
      series.push({ key, label: text(entry, "label") ?? key });
    }
  }
  const rows: ChartRowSpec[] = [];
  for (const row of records(input, "data")) {
    const label = text(row, x);
    if (label === null) {
      continue;
    }
    const values = new Map<string, number>();
    for (const { key } of series) {
      const value = number(Reflect.get(row, key));
      if (value !== null) {
        values.set(key, value);
      }
    }
    rows.push({ x: label, values });
  }
  const plotted = series.filter(({ key }) =>
    rows.some((row) => row.values.has(key))
  );
  if (plotted.length === 0 || rows.length === 0) {
    return null;
  }
  return {
    title: text(input, "title"),
    caption: text(input, "caption"),
    type: oneOf(text(input, "type"), ["bar", "line", "area", "donut"]) ?? "bar",
    x,
    series: plotted,
    rows,
    horizontal: flag(input, "horizontal"),
    stacked: flag(input, "stacked"),
    unit: text(input, "unit"),
  };
}

function parseFiles(input: object): FilesSpec | null {
  const files: FileSpec[] = [];
  for (const entry of records(input, "files")) {
    const fileRef = ref(entry, "ref") ?? ref(entry, "path");
    if (fileRef === null) {
      continue;
    }
    files.push({
      ref: fileRef,
      role: text(entry, "role") ?? "",
      change: oneOf(text(entry, "change"), [
        "added",
        "modified",
        "deleted",
        "renamed",
      ]),
    });
  }
  return files.length === 0 ? null : { title: text(input, "title"), files };
}

function parseSteps(input: object): StepsSpec | null {
  const steps: StepSpec[] = [];
  for (const entry of records(input, "steps")) {
    const title = text(entry, "title");
    if (title !== null) {
      steps.push({
        title,
        detail: text(entry, "detail"),
        ref: ref(entry, "ref"),
      });
    }
  }
  return steps.length === 0 ? null : { title: text(input, "title"), steps };
}

function focusLines(value: string | null): number[] {
  const match = value === null ? null : FOCUS_RANGE.exec(value);
  if (!match) {
    return [];
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (start < 1 || end < start || end - start > 500) {
    return [];
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseExcerpt(input: object): ExcerptSpec | null {
  const excerptRef = ref(input, "ref");
  if (excerptRef === null) {
    return null;
  }
  return {
    ref: excerptRef,
    focus: focusLines(text(input, "focus")),
    note: text(input, "note"),
  };
}

function parseStats(input: object): StatsSpec | null {
  const items: StatSpec[] = [];
  for (const entry of records(input, "items")) {
    const label = text(entry, "label");
    const raw: unknown = Reflect.get(entry, "value");
    const value =
      typeof raw === "number" && Number.isFinite(raw)
        ? raw
        : text(entry, "value");
    if (label !== null && value !== null) {
      items.push({ label, value, hint: text(entry, "hint") });
    }
  }
  return items.length === 0 ? null : { title: text(input, "title"), items };
}

function json(source: string): object | null {
  try {
    const value: unknown = JSON.parse(source);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function block<K extends BlockKind, S>(kind: K, spec: S | null) {
  return spec === null ? null : { kind, spec };
}

export function parseBlock(
  kind: BlockKind,
  source: string
): ParsedBlock | null {
  const input = json(source);
  if (input === null) {
    return null;
  }
  switch (kind) {
    case "diagram":
      return block(kind, parseDiagram(input));
    case "chart":
      return block(kind, parseChart(input));
    case "files":
      return block(kind, parseFiles(input));
    case "steps":
      return block(kind, parseSteps(input));
    case "excerpt":
      return block(kind, parseExcerpt(input));
    case "stats":
      return block(kind, parseStats(input));
    default:
      return null;
  }
}
