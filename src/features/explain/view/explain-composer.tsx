import {
  ChatComposer,
  ChatComposerShell,
  ChatComposerSubmit,
  ChatComposerTextarea,
  ChatComposerToolbar,
  ChatComposerTools,
} from "@ctrl-ui/react/chat-composer";
import { ArrowUp } from "lucide-react";

import { AgentSettingsPicker } from "@/features/agent/agent-settings";
import type { AgentRunSettings } from "@/lib/agent-ipc-types";
import type { ExplainLevel } from "@/lib/explain-ipc-types";

import { DetailSlider } from "./detail-level";

export function ExplainComposer({
  value,
  onValueChange,
  onSend,
  onStop,
  running,
  level,
  onLevelChange,
  settings,
  onSettingsChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  running: boolean;
  level: ExplainLevel;
  onLevelChange: (level: ExplainLevel) => void;
  settings: AgentRunSettings;
  onSettingsChange: (settings: AgentRunSettings) => void;
}) {
  return (
    <ChatComposer
      density="compact"
      layout="stacked"
      onSubmit={async ({ value: asked, clear }) => {
        clear();
        await onSend(asked);
      }}
      onValueChange={onValueChange}
      state={running ? "submitting" : "idle"}
      value={value}
    >
      <ChatComposerShell>
        <ChatComposerTextarea
          aria-label="Ask about this project"
          placeholder="Ask how something works, where it lives, or why…"
        />
        <ChatComposerToolbar>
          <ChatComposerTools>
            <DetailSlider level={level} onLevelChange={onLevelChange} />
          </ChatComposerTools>
          <AgentSettingsPicker
            onSettingsChange={onSettingsChange}
            settings={settings}
          />
          <ChatComposerSubmit
            aria-label="Explain"
            iconOnly
            onStop={onStop}
            size="sm"
            stopLabel="Stop"
          >
            <ArrowUp />
          </ChatComposerSubmit>
        </ChatComposerToolbar>
      </ChatComposerShell>
    </ChatComposer>
  );
}
