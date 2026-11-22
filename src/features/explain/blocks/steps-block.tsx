import {
  Timeline,
  TimelineContent,
  TimelineDescription,
  TimelineIndicator,
  TimelineItem,
  TimelineMeta,
  TimelineSeparator,
  TimelineTitle,
} from "@ctrl-ui/react/ui/timeline";

import { CodeRefLink } from "../source/code-ref-link";
import { keyedByContent, type StepsSpec } from "./block-specs";

export function StepsBlock({ spec }: { spec: StepsSpec }) {
  return (
    <Timeline>
      {keyedByContent(spec.steps, (step) => step.title).map(
        ({ key, item: step }, index) => (
          <TimelineItem key={key} state="neutral">
            <TimelineIndicator aria-hidden="true">
              <span className="text-micro font-medium tabular-nums">
                {index + 1}
              </span>
            </TimelineIndicator>
            <TimelineSeparator />
            <TimelineContent>
              <TimelineTitle>{step.title}</TimelineTitle>
              {step.detail ? (
                <TimelineDescription>{step.detail}</TimelineDescription>
              ) : null}
              {step.ref ? (
                <TimelineMeta>
                  <CodeRefLink codeRef={step.ref} />
                </TimelineMeta>
              ) : null}
            </TimelineContent>
          </TimelineItem>
        )
      )}
    </Timeline>
  );
}
