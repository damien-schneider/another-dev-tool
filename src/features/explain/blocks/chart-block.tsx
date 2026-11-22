import {
  Chart,
  ChartLegend,
  ChartLegendItem,
  ChartPlot,
} from "@ctrl-ui/react/ui/chart";
import {
  areaChart,
  barChart,
  type CartesianChartOptions,
  lineChart,
} from "@ctrl-ui/react/ui/chart-cartesian";
import type { ChartColor } from "@ctrl-ui/react/ui/chart-colors";
import {
  type ChartSliceOptions,
  donutChart,
  resolveChartSlices,
} from "@ctrl-ui/react/ui/chart-polar";
import {
  type ChartFill,
  resolveChartSeries,
} from "@ctrl-ui/react/ui/chart-series";
import { Text } from "@ctrl-ui/react/ui/typography";
import { type ReactNode, useMemo } from "react";

import type { ChartSpec } from "./block-specs";

type SeriesKey = `v${number}`;

interface PlotRow {
  label: string;
  [key: SeriesKey]: number | null;
}

interface LegendEntry {
  key: string;
  label: string;
  color: ChartColor;
  fill: ChartFill;
}

const PLOT_HEIGHT = 240;
const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const JOINED_UNIT = /^[%‰°]$/;

function seriesKey(index: number): SeriesKey {
  return `v${index}`;
}

function valueFormatter(unit: string | null) {
  if (unit === null) {
    return (value: number) => NUMBER_FORMAT.format(value);
  }
  const separator = JOINED_UNIT.test(unit) ? "" : " ";
  return (value: number) => `${NUMBER_FORMAT.format(value)}${separator}${unit}`;
}

function chartModel(spec: ChartSpec): {
  plot: ReactNode;
  legend: LegendEntry[];
} {
  const rows = spec.rows.map((row) => {
    const datum: PlotRow = { label: row.x };
    spec.series.forEach((entry, index) => {
      datum[seriesKey(index)] = row.values.get(entry.key) ?? null;
    });
    return datum;
  });
  const formatValue = valueFormatter(spec.unit);
  const ariaLabel = spec.title ?? `${spec.type} chart by ${spec.x}`;

  if (spec.type === "donut") {
    const options: ChartSliceOptions<PlotRow> = {
      data: rows,
      label: "label",
      value: seriesKey(0),
      formatValue,
    };
    return {
      plot: (
        <ChartPlot
          ariaLabel={ariaLabel}
          definition={donutChart<PlotRow>(options)}
          height={PLOT_HEIGHT}
        />
      ),
      legend: resolveChartSlices(options).map((slice) => ({
        key: slice.id,
        label: `${slice.label} · ${formatValue(slice.value)}`,
        color: slice.color,
        fill: slice.fill,
      })),
    };
  }

  const series = resolveChartSeries<PlotRow>(
    spec.series.map((entry, index) => ({
      key: seriesKey(index),
      label: entry.label,
    }))
  );
  const options: CartesianChartOptions<PlotRow> = {
    data: rows,
    x: "label",
    series,
    formatValue,
    formatTick: formatValue,
  };
  const legend =
    series.length > 1
      ? series.map((entry) => ({
          key: entry.key,
          label: entry.label,
          color: entry.color,
          fill: entry.fill,
        }))
      : [];

  if (spec.type === "line") {
    return {
      plot: (
        <ChartPlot
          ariaLabel={ariaLabel}
          definition={lineChart<PlotRow>(options)}
          height={PLOT_HEIGHT}
        />
      ),
      legend,
    };
  }
  if (spec.type === "area") {
    return {
      plot: (
        <ChartPlot
          ariaLabel={ariaLabel}
          definition={areaChart<PlotRow>({ ...options, stacked: spec.stacked })}
          height={PLOT_HEIGHT}
        />
      ),
      legend,
    };
  }
  return {
    plot: (
      <ChartPlot
        ariaLabel={ariaLabel}
        definition={barChart<PlotRow>({
          ...options,
          orientation: spec.horizontal ? "horizontal" : "vertical",
          layout: spec.stacked ? "stacked" : "grouped",
        })}
        height={PLOT_HEIGHT}
      />
    ),
    legend,
  };
}

export function ChartBlock({ spec }: { spec: ChartSpec }) {
  const { plot, legend } = useMemo(() => chartModel(spec), [spec]);

  return (
    <div className="flex flex-col gap-2">
      <Chart>
        {plot}
        {legend.length > 0 ? (
          <ChartLegend>
            {legend.map((entry) => (
              <ChartLegendItem
                color={entry.color}
                fill={entry.fill}
                key={entry.key}
              >
                {entry.label}
              </ChartLegendItem>
            ))}
          </ChartLegend>
        ) : null}
      </Chart>
      {spec.caption ? (
        <Text size="caption" tone="muted">
          {spec.caption}
        </Text>
      ) : null}
    </div>
  );
}
