import { ModelSwitcher } from "@ctrl-ui/react/model-switcher";
import { useState } from "react";

import type {
  AgentEffort,
  AgentModel,
  AgentRunSettings,
} from "@/lib/agent-ipc-types";

export interface SettingsScope {
  storagePrefix: string;
  defaults: AgentRunSettings;
}

export const AGENT_SETTINGS_SCOPE: SettingsScope = {
  storagePrefix: "another-dev-tool.agent",
  defaults: { model: "opus", effort: "high" },
};

export const MODELS: {
  value: AgentModel;
  label: string;
  provider: "anthropic";
}[] = [
  { value: "fable", label: "Fable", provider: "anthropic" },
  { value: "opus", label: "Opus", provider: "anthropic" },
  { value: "sonnet", label: "Sonnet", provider: "anthropic" },
  { value: "haiku", label: "Haiku", provider: "anthropic" },
];

export const EFFORTS: { value: AgentEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

function pick<Value extends string>(
  options: readonly { value: Value }[],
  value: string | null
): Value | undefined {
  return options.find((option) => option.value === value)?.value;
}

function readStoredSettings({
  storagePrefix,
  defaults,
}: SettingsScope): AgentRunSettings {
  return {
    model:
      pick(MODELS, window.localStorage.getItem(`${storagePrefix}-model`)) ??
      defaults.model,
    effort:
      pick(EFFORTS, window.localStorage.getItem(`${storagePrefix}-effort`)) ??
      defaults.effort,
  };
}

export function useAgentSettings(scope: SettingsScope) {
  const [settings, setSettings] = useState(() => readStoredSettings(scope));

  const change = (next: AgentRunSettings) => {
    setSettings(next);
    window.localStorage.setItem(`${scope.storagePrefix}-model`, next.model);
    window.localStorage.setItem(`${scope.storagePrefix}-effort`, next.effort);
  };

  return [settings, change] as const;
}

export function AgentSettingsPicker({
  settings,
  onSettingsChange,
}: {
  settings: AgentRunSettings;
  onSettingsChange: (settings: AgentRunSettings) => void;
}) {
  return (
    <ModelSwitcher
      models={MODELS}
      onValueChange={(value) => {
        const model = pick(MODELS, value);
        if (model) {
          onSettingsChange({ ...settings, model });
        }
      }}
      size="xs"
      thinking={{
        levels: EFFORTS,
        value: settings.effort,
        onValueChange: (value) => {
          const effort = pick(EFFORTS, value);
          if (effort) {
            onSettingsChange({ ...settings, effort });
          }
        },
      }}
      value={settings.model}
      variant="ghost"
    />
  );
}
