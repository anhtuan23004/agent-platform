export interface ChartReferenceLine {
  value: number;
  label: string;
  stroke: string;
  strokeDasharray?: string;
}

/** Merge reference-line values with a small set of round data ticks for the value axis. */
export function buildValueAxisTicks(
  dataValues: number[],
  referenceLines: ChartReferenceLine[],
): number[] {
  const ticks = new Set<number>([0, 100, ...referenceLines.map((line) => line.value)]);
  if (dataValues.length > 0) {
    const max = Math.max(...dataValues);
    const min = Math.min(...dataValues);
    ticks.add(Math.floor(min / 25) * 25);
    ticks.add(Math.ceil(max / 25) * 25);
  }
  return [...ticks].sort((left, right) => left - right);
}

export function formatValueAxisTick(value: number, valueFormatter: (n: number) => string): string {
  return valueFormatter(value);
}
