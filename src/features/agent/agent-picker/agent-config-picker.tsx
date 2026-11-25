import { ModelSwitcher } from "@ctrl-ui/react/model-switcher";
import { Text } from "@ctrl-ui/react/ui/typography";

import type { AgentConfigChoice } from "@/lib/agent-ipc-types";

import type { AgentChoice } from "./use-agent-choice";

const asOptions = (choices: AgentConfigChoice[]) =>
  choices.map((choice) => ({ value: choice.value, label: choice.name }));

export function AgentConfigPicker({ choice }: { choice: AgentChoice }) {
  const { preparing } = choice;
  if (preparing.state === "starting") {
    const installing = choice.listing?.readiness === "download";
    return (
      <Text className="truncate" size="caption" tone="muted">
        {installing ? "Installing" : "Starting"} {choice.name}…
      </Text>
    );
  }
  if (preparing.state === "failed" || preparing.prepared.models === null) {
    return null;
  }
  const { models, efforts } = preparing.prepared;
  return (
    <ModelSwitcher
      label={models.name}
      models={asOptions(models.choices)}
      onValueChange={(value) => choice.pick(models.id, value)}
      size="xs"
      thinking={
        efforts
          ? {
              label: efforts.name,
              levels: asOptions(efforts.choices),
              value: choice.effort ?? undefined,
              onValueChange: (value) => choice.pick(efforts.id, value),
            }
          : undefined
      }
      value={choice.model ?? undefined}
      variant="ghost"
    />
  );
}
