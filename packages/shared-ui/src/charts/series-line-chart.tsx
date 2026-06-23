import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartEmpty } from './chart-empty';
import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from './chart-theme';
import type { ChartReferenceLine } from './reference-axis';
import { buildValueAxisTicks, formatValueAxisTick } from './reference-axis';

export interface SeriesLineRow {
  label: string;
  [seriesKey: string]: string | number;
}

export interface LineSeries {
  key: string;
  name: string;
  color: string;
}

export interface SeriesLineChartProps {
  rows: SeriesLineRow[];
  series: LineSeries[];
  referenceLines?: ChartReferenceLine[];
  height?: number;
  valueFormatter?: (value: number) => string;
}

/** Generic multi-series line chart (e.g. week-over-week metrics). */
export function SeriesLineChart({
  rows,
  series,
  referenceLines = [],
  height = 220,
  valueFormatter = (value) => String(value),
}: SeriesLineChartProps) {
  const dataValues = useMemo(
    () => rows.flatMap((row) => series.map((s) => Number(row[s.key] ?? 0))),
    [rows, series],
  );
  const yTicks = useMemo(
    () => buildValueAxisTicks(dataValues, referenceLines),
    [dataValues, referenceLines],
  );
  const yAxisWidth = 48;

  if (rows.length === 0) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} />
        <XAxis
          dataKey="label"
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          width={yAxisWidth}
          ticks={yTicks}
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatValueAxisTick(Number(value), valueFormatter)}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value, name) => [valueFormatter(Number(value ?? 0)), String(name)]}
        />
        {referenceLines.map((line) => (
          <ReferenceLine
            key={line.label}
            y={line.value}
            stroke={line.stroke}
            strokeDasharray={line.strokeDasharray ?? '4 4'}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 3, fill: s.color }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
