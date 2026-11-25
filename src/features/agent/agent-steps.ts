import { modelIdentity } from "@ctrl-ui/react/lib/model-name";

import type { AgentAnswerMeta, AgentPart } from "@/lib/agent-ipc-types";

import { EFFORTS, MODELS } from "./agent-settings";

export type AgentStep = Exclude<AgentPart, { kind: "text" }>;

export type AnswerSegment =
  | { kind: "steps"; start: number; steps: AgentStep[] }
  | { kind: "text"; start: number; text: string };

interface ToolVerbs {
  doing: string;
  done: string;
  target?: (input: unknown) => string | null;
}

const field = (input: unknown, key: string): string | null => {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" && value.length > 0 ? value : null;
};

const fileName = (key: string) => (input: unknown) =>
  field(input, key)?.split("/").findLast(Boolean) ?? null;

const quoted = (input: unknown) => {
  const pattern = field(input, "pattern");
  return pattern === null ? null : `“${pattern}”`;
};

const SKILL_NAMESPACE = /^[\w-]+:/;
const COMMAND_PREVIEW = 60;

const command = (input: unknown) => {
  const line = field(input, "command")?.split("\n")[0]?.trim() ?? null;
  return line !== null && line.length > COMMAND_PREVIEW
    ? `${line.slice(0, COMMAND_PREVIEW).trimEnd()}…`
    : line;
};

const TOOLS: Record<string, ToolVerbs> = {
  Read: { doing: "Reading", done: "Read", target: fileName("file_path") },
  Write: { doing: "Writing", done: "Wrote", target: fileName("file_path") },
  Edit: { doing: "Editing", done: "Edited", target: fileName("file_path") },
  MultiEdit: {
    doing: "Editing",
    done: "Edited",
    target: fileName("file_path"),
  },
  Grep: { doing: "Searching for", done: "Searched for", target: quoted },
  Glob: {
    doing: "Finding",
    done: "Found",
    target: (input) => field(input, "pattern"),
  },
  LS: { doing: "Listing", done: "Listed", target: fileName("path") },
  TodoWrite: { doing: "Updating the plan", done: "Updated the plan" },
  Skill: {
    doing: "Loading playbook",
    done: "Loaded playbook",
    target: (input) =>
      field(input, "skill")?.replace(SKILL_NAMESPACE, "") ?? null,
  },
  Bash: { doing: "Running", done: "Ran", target: command },
};

export function formatDuration(ms: number) {
  if (ms < 1000) {
    return "<1s";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const rest = seconds % 60;
  const minutes = `${Math.floor(seconds / 60)}m`;
  return rest === 0 ? minutes : `${minutes} ${rest}s`;
}

export function stepLabel(step: AgentStep) {
  if (step.kind === "thinking") {
    if (step.durationMs === null) {
      return "Thinking";
    }
    return `Thought for ${formatDuration(step.durationMs)}`;
  }
  const running = step.state === "running";
  const verbs = TOOLS[step.name];
  if (!verbs) {
    const title = step.title?.split("\n")[0]?.trim();
    return title || `${running ? "Using" : "Used"} ${step.name}`;
  }
  const verb = running ? verbs.doing : verbs.done;
  const target = verbs.target?.(step.input) ?? null;
  return target === null ? verb : `${verb} ${target}`;
}

export function groupTitle(steps: AgentStep[]) {
  const [only] = steps;
  if (only && steps.length === 1) {
    return stepLabel(only);
  }
  const timed = steps.flatMap((step) =>
    step.durationMs === null ? [] : [step.durationMs]
  );
  if (timed.length === 0) {
    return `${steps.length} steps`;
  }
  return `Worked for ${formatDuration(timed.reduce((sum, ms) => sum + ms, 0))}`;
}

export function segments(parts: AgentPart[]): AnswerSegment[] {
  const found: AnswerSegment[] = [];
  parts.forEach((part, index) => {
    if (part.kind === "text") {
      if (part.text.length > 0) {
        found.push({ kind: "text", start: index, text: part.text });
      }
      return;
    }
    const last = found.at(-1);
    if (last?.kind === "steps") {
      last.steps.push(part);
    } else {
      found.push({ kind: "steps", start: index, steps: [part] });
    }
  });
  return found;
}

export function answerText(parts: AgentPart[]) {
  return parts
    .flatMap((part) =>
      part.kind === "text" && part.text.trim() ? [part.text.trim()] : []
    )
    .join("\n\n");
}

export function metaLabel(meta: AgentAnswerMeta) {
  const model =
    meta.model === null
      ? (MODELS.find((option) => option.value === meta.requestedModel)?.label ??
        meta.requestedModel)
      : modelIdentity(meta.model).name;
  const effort =
    meta.effort === null
      ? null
      : (EFFORTS.find((option) => option.value === meta.effort)?.label ??
        meta.effort);
  const time =
    meta.durationMs === null ? null : formatDuration(meta.durationMs);
  return [model, effort, time].filter(Boolean).join(" · ");
}
