import { Slider } from "@ctrl-ui/react/ui/slider";
import { useState } from "react";

import type { ExplainLevel } from "@/lib/explain-ipc-types";

const LEVEL_STORAGE_KEY = "another-dev-tool.explain-level";

export const DETAIL_LEVELS: readonly { value: ExplainLevel; label: string }[] =
  [
    { value: "gist", label: "Gist" },
    { value: "brief", label: "Brief" },
    { value: "standard", label: "Standard" },
    { value: "detailed", label: "Detailed" },
    { value: "deep", label: "Deep dive" },
  ];

const DEFAULT_LEVEL: ExplainLevel = "standard";

const position = (level: ExplainLevel) =>
  DETAIL_LEVELS.findIndex((candidate) => candidate.value === level) + 1;

const levelAt = (step: number) => DETAIL_LEVELS[step - 1]?.value;

export function shiftLevel(level: ExplainLevel, by: -1 | 1) {
  return levelAt(position(level) + by) ?? null;
}

export function useDetailLevel() {
  const [level, setLevel] = useState<ExplainLevel>(
    () =>
      DETAIL_LEVELS.find(
        (candidate) =>
          candidate.value === window.localStorage.getItem(LEVEL_STORAGE_KEY)
      )?.value ?? DEFAULT_LEVEL
  );

  const change = (next: ExplainLevel) => {
    setLevel(next);
    window.localStorage.setItem(LEVEL_STORAGE_KEY, next);
  };

  return [level, change] as const;
}

export function DetailSlider({
  level,
  onLevelChange,
}: {
  level: ExplainLevel;
  onLevelChange: (level: ExplainLevel) => void;
}) {
  return (
    <Slider
      className="w-44"
      formatValue={(step) => DETAIL_LEVELS[step - 1]?.label ?? ""}
      label="Detail"
      max={DETAIL_LEVELS.length}
      min={1}
      onValueChange={(step) => {
        const next = levelAt(step);
        if (next) {
          onLevelChange(next);
        }
      }}
      step={1}
      value={position(level)}
      variant="plain"
    />
  );
}
