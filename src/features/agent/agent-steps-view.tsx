import {
  Activity,
  ActivityContent,
  ActivityDetail,
  ActivityDetailContent,
  ActivityDetailLabel,
  ActivityIcon,
  ActivityRow,
  ActivityTitle,
  ActivityTrigger,
} from "@ctrl-ui/react/activity";

import { type AgentStep, groupTitle, stepLabel } from "./agent-steps";

const stateOf = (step: AgentStep, live: boolean) => {
  if (step.kind === "thinking") {
    return live && step.durationMs === null ? "running" : "success";
  }
  if (step.state === "error") {
    return "error";
  }
  return step.state === "running" && live ? "running" : "success";
};

const shown = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

function StepDetail({ step }: { step: AgentStep }) {
  if (step.kind === "thinking") {
    return step.text.trim() ? (
      <ActivityDetail>
        <ActivityDetailContent>{step.text.trim()}</ActivityDetailContent>
      </ActivityDetail>
    ) : null;
  }
  return (
    <>
      {step.input === null ? null : (
        <ActivityDetail>
          <ActivityDetailLabel>Input</ActivityDetailLabel>
          <ActivityDetailContent format="code">
            {shown(step.input)}
          </ActivityDetailContent>
        </ActivityDetail>
      )}
      {step.output === null ? null : (
        <ActivityDetail>
          <ActivityDetailLabel>Output</ActivityDetailLabel>
          <ActivityDetailContent
            format="code"
            tone={step.state === "error" ? "danger" : "neutral"}
          >
            {step.output}
          </ActivityDetailContent>
        </ActivityDetail>
      )}
    </>
  );
}

const hasDetail = (step: AgentStep) =>
  step.kind === "thinking"
    ? step.text.trim().length > 0
    : step.input !== null || step.output !== null;

function Step({ step, live }: { step: AgentStep; live: boolean }) {
  const kind = step.kind === "thinking" ? "reasoning" : "tool";
  const state = stateOf(step, live);
  const title = stepLabel(
    step.kind === "thinking" && state === "running"
      ? { ...step, durationMs: null }
      : step
  );
  if (!hasDetail(step)) {
    return (
      <Activity kind={kind} state={state}>
        <ActivityRow>
          <ActivityIcon />
          <ActivityTitle>{title}</ActivityTitle>
        </ActivityRow>
      </Activity>
    );
  }
  return (
    <Activity kind={kind} state={state}>
      <ActivityTrigger>
        <ActivityIcon />
        <ActivityTitle>{title}</ActivityTitle>
      </ActivityTrigger>
      <ActivityContent>
        <StepDetail step={step} />
      </ActivityContent>
    </Activity>
  );
}

export function AgentSteps({
  steps,
  live,
}: {
  steps: AgentStep[];
  live: boolean;
}) {
  const [only] = steps;
  if (only && steps.length === 1) {
    return <Step live={live} step={only} />;
  }
  const current = steps.at(-1);
  const title =
    live && current
      ? stepLabel(
          current.kind === "thinking"
            ? { ...current, durationMs: null }
            : current
        )
      : groupTitle(steps);
  return (
    <Activity kind="tool" state={live ? "running" : "success"}>
      <ActivityTrigger>
        <ActivityIcon />
        <ActivityTitle>{title}</ActivityTitle>
      </ActivityTrigger>
      <ActivityContent>
        {steps.map((step, index) => (
          <Step
            key={step.kind === "tool" ? step.id : `thinking-${index}`}
            live={live}
            step={step}
          />
        ))}
      </ActivityContent>
    </Activity>
  );
}
