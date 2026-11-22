import { Text } from "@ctrl-ui/react/ui/typography";

import type { StatsSpec } from "./block-specs";

const NUMBER_FORMAT = new Intl.NumberFormat();

export function StatsBlock({ spec }: { spec: StatsSpec }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {spec.items.map((item) => (
        <div
          className="rounded-panel flex flex-col gap-0.5 bg-[oklch(from_var(--foreground)_l_c_h/0.04)] px-3 py-2.5"
          key={item.label}
        >
          <Text as="dt" className="truncate" size="caption" tone="muted">
            {item.label}
          </Text>
          <Text
            as="dd"
            className="order-first"
            numeric
            size="heading-3"
            weight="semibold"
          >
            {typeof item.value === "number"
              ? NUMBER_FORMAT.format(item.value)
              : item.value}
          </Text>
          {item.hint ? (
            <Text as="dd" size="caption" tone="muted">
              {item.hint}
            </Text>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
