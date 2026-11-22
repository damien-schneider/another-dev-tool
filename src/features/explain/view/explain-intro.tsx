import { Button } from "@ctrl-ui/react/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ctrl-ui/react/ui/empty";
import { FolderOpen, Telescope } from "lucide-react";

import { pathName } from "@/features/library/library-paths";

const STARTERS = [
  {
    label: "Give me the 2-minute tour",
    prompt:
      "Give me a quick tour of this project: what it does, how it is organized, and where I should start reading.",
  },
  {
    label: "Trace the main flow",
    prompt:
      "Trace the main flow end to end, from where it starts to where the real work happens.",
  },
  {
    label: "Map the data model",
    prompt:
      "Map the data model: the main entities, how they relate, and where they are stored.",
  },
  {
    label: "What changed lately?",
    prompt:
      "What changed in this project over the last few weeks, and what does it mean for someone working on it?",
  },
  {
    label: "Where is the complexity?",
    prompt:
      "Which parts are the hardest to understand or the riskiest to change, and why?",
  },
] as const;

export function NoProject({ onChoose }: { onChoose: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <Telescope />
        </EmptyMedia>
        <EmptyTitle>Understand any codebase</EmptyTitle>
        <EmptyDescription>
          Pick a project or any folder. Claude reads the code and answers with
          diagrams, charts, and links to the exact lines.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onChoose} size="sm" variant="surface">
          <FolderOpen />
          Choose a folder…
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function ExplainIntro({
  project,
  onPick,
}: {
  project: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <Telescope />
        </EmptyMedia>
        <EmptyTitle>{`What do you want to know about ${pathName(project)}?`}</EmptyTitle>
        <EmptyDescription>
          Ask anything about the code. The detail slider sets how much you get
          back, from one sentence to a full walkthrough.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        {STARTERS.map((starter) => (
          <Button
            key={starter.label}
            onClick={() => onPick(starter.prompt)}
            size="sm"
            variant="surface"
          >
            {starter.label}
          </Button>
        ))}
      </EmptyContent>
    </Empty>
  );
}
