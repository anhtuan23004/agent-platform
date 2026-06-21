export interface CapacitySimulation {
  transferHours: number;
  sourceAfterBusyRate: number;
  targetAfterBusyRate: number;
  fullSolution: boolean;
}

export function requiredReductionHours(
  planned: number,
  available: number,
  greenMax: number,
): number {
  return Math.max(0, planned - greenMax * available);
}

export function simulateCapacity(input: {
  sourcePlanned: number;
  sourceAvailable: number;
  targetPlanned: number;
  targetAvailable: number;
  projectTransferableHours: number;
  greenMin: number;
  greenMax: number;
  transferStepHours: number;
}): CapacitySimulation[] {
  if (input.sourceAvailable <= 0 || input.targetAvailable <= 0) return [];
  const required = requiredReductionHours(
    input.sourcePlanned,
    input.sourceAvailable,
    input.greenMax,
  );
  const rounded = Math.ceil(required / input.transferStepHours) * input.transferStepHours;
  const maximum = Math.min(
    input.projectTransferableHours,
    input.greenMax * input.targetAvailable - input.targetPlanned,
    input.sourcePlanned - input.greenMin * input.sourceAvailable,
  );
  const scenarios: CapacitySimulation[] = [];
  for (
    let hours = Math.min(
      rounded,
      Math.floor(maximum / input.transferStepHours) * input.transferStepHours,
    );
    hours > 0;
    hours -= input.transferStepHours
  ) {
    const sourceAfterBusyRate = (input.sourcePlanned - hours) / input.sourceAvailable;
    const targetAfterBusyRate = (input.targetPlanned + hours) / input.targetAvailable;
    scenarios.push({
      transferHours: hours,
      sourceAfterBusyRate,
      targetAfterBusyRate,
      fullSolution:
        hours >= required &&
        sourceAfterBusyRate >= input.greenMin &&
        sourceAfterBusyRate <= input.greenMax &&
        targetAfterBusyRate <= input.greenMax,
    });
  }
  return scenarios;
}
