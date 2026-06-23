import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartEmpty } from './chart-empty';
import {
  CHART_AXIS_STROKE,
  CHART_CURSOR_FILL,
  CHART_GRID_STROKE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from './chart-theme';
import {
  buildValueAxisTicks,
  type ChartReferenceLine,
  formatValueAxisTick,
} from './reference-axis';

export type { ChartReferenceLine };

export interface CategoricalBarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface CategoricalBarChartProps {
  rows: CategoricalBarRow[];
  /** Default bar fill when a row omits `color`. */
  barColor?: string;
  referenceLines?: ChartReferenceLine[];
  /** `horizontal` = member-style labels on Y (default); `vertical` = labels on X. */
  orientation?: 'horizontal' | 'vertical';
  labelWidth?: number;
  height?: number;
  valueFormatter?: (value: number) => string;
  onBarClick?: (row: CategoricalBarRow) => void;
}

const DEFAULT_BAR = 'var(--color-primary)';

/** Single-series categorical bar chart with optional threshold reference lines. */
export function CategoricalBarChart({
  rows,
  barColor = DEFAULT_BAR,
  referenceLines = [],
  orientation = 'horizontal',
  labelWidth = 120,
  height,
  valueFormatter = (value) => String(value),
  onBarClick,
}: CategoricalBarChartProps) {
  const dataValues = useMemo(() => rows.map((row) => row.value), [rows]);
  const valueAxisTicks = useMemo(
    () => buildValueAxisTicks(dataValues, referenceLines),
    [dataValues, referenceLines],
  );
  const valueAxisTickFormatter = (value: number) => formatValueAxisTick(value, valueFormatter);
  const valueAxisWidth = 48;

  if (rows.length === 0) return <ChartEmpty />;

  const vertical = orientation === 'vertical';
  const h =
    height ??
    (vertical ? Math.max(260, rows.length * 36 + 48) : Math.max(200, rows.length * 32 + 40));
  const clickable = Boolean(onBarClick);

  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={rows}
        layout={vertical ? 'horizontal' : 'vertical'}
        margin={{ left: 8, right: 16, top: 8, bottom: vertical ? 24 : 4 }}
      >
        <CartesianGrid horizontal={vertical} vertical={!vertical} stroke={CHART_GRID_STROKE} />
        {vertical ? (
          <>
            <XAxis
              type="category"
              dataKey="label"
              tick={CHART_TICK}
              stroke={CHART_AXIS_STROKE}
              tickLine={false}
              interval={0}
              angle={rows.length > 8 ? -35 : 0}
              textAnchor={rows.length > 8 ? 'end' : 'middle'}
              height={rows.length > 8 ? 56 : 30}
            />
            <YAxis
              type="number"
              width={valueAxisWidth}
              ticks={valueAxisTicks}
              tick={CHART_TICK}
              stroke={CHART_AXIS_STROKE}
              tickLine={false}
              axisLine={false}
              tickFormatter={valueAxisTickFormatter}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              ticks={valueAxisTicks}
              tick={CHART_TICK}
              stroke={CHART_AXIS_STROKE}
              tickLine={false}
              tickFormatter={valueAxisTickFormatter}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={labelWidth}
              tick={CHART_TICK}
              tickLine={false}
              axisLine={false}
            />
          </>
        )}
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          cursor={{ fill: CHART_CURSOR_FILL }}
          formatter={(value) => [valueFormatter(Number(value ?? 0)), 'Value']}
        />
        {referenceLines.map((line) => (
          <ReferenceLine
            key={line.label}
            {...(vertical ? { y: line.value } : { x: line.value })}
            stroke={line.stroke}
            strokeDasharray={line.strokeDasharray ?? '4 4'}
          />
        ))}
        <Bar
          dataKey="value"
          radius={[4, 4, 4, 4]}
          cursor={clickable ? 'pointer' : undefined}
          onClick={
            onBarClick
              ? (_entry: unknown, index: number) => {
                  const row = rows[index];
                  if (row) onBarClick(row);
                }
              : undefined
          }
        >
          {rows.map((row) => (
            <Cell key={row.key} fill={row.color ?? barColor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
