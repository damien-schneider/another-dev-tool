import type { BadgeColor } from "@ctrl-ui/react/ui/badge";

import type {
  PatternAgent,
  PatternKind,
  PatternsProgress,
  PatternsRun,
} from "@/lib/patterns-ipc-types";

export const AGENT_NAMES: Record<PatternAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  omp: "omp",
  "mastra-code": "Mastra Code",
  pencil: "Pencil",
};

export const KINDS: Record<PatternKind, { label: string; color: BadgeColor }> =
  {
    strengthen: { label: "Strengthen", color: "blue" },
    rule: { label: "Rule", color: "purple" },
    skill: { label: "Skill", color: "green" },
    memory: { label: "Memory", color: "orange" },
    automate: { label: "Automate", color: "pink" },
  };

const COUNT = new Intl.NumberFormat();
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const formatDay = (timestamp: number) => DAY.format(timestamp);

const plural = (count: number, one: string, many: string) =>
  `${COUNT.format(count)} ${count === 1 ? one : many}`;

export function formatStage({ stage, prompts, sessions }: PatternsProgress) {
  if (stage === "reading") {
    return "Reading your conversations…";
  }
  if (stage === "checking") {
    return "Checking the evidence…";
  }
  return `Analyzing ${plural(prompts, "prompt", "prompts")} from ${plural(sessions, "session", "sessions")}…`;
}

export function formatRun(run: PatternsRun) {
  const agents = run.agents
    .map(
      ({ agent, prompts }) => `${AGENT_NAMES[agent]} ${COUNT.format(prompts)}`
    )
    .join(", ");
  return [
    `${plural(run.prompts, "prompt", "prompts")} from ${plural(run.sessions, "session", "sessions")}`,
    DAY.formatRange(run.firstAt, run.lastAt),
    agents,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const formatReach = (sessions: number, days: number) =>
  `You said this in ${plural(sessions, "session", "sessions")} over ${plural(days, "day", "days")}`;
