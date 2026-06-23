import type { TrustEnvelope } from '@seta/agent-sdk';

export interface MastraToolSignals {
  toolCalls: { payload: { toolName: string; args?: unknown } }[];
  toolResults: { payload: { toolName: string; result: unknown } }[];
  text?: string;
}

export function trustFromPmoMastraResult(res: MastraToolSignals): TrustEnvelope {
  const at = new Date().toISOString();
  const message = res.text?.trim() ?? '';
  return {
    reasoningTrace: res.toolCalls.map((tc) => ({
      step: tc.payload.toolName,
      detail: `args=${JSON.stringify(tc.payload.args ?? {})}`,
      at,
    })),
    evidenceCitations: [],
    confidenceScore: message ? 0.75 : 0.2,
  };
}
