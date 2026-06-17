import type { AgentToolContext } from '@seta/agent-sdk';

/** Read the authenticated tenant id off the agent request context. */
export function tenantIdFromContext(ctx: AgentToolContext): string {
  const tenantId = ctx.requestContext?.get('tenant_id') as string | undefined;
  if (!tenantId) throw new Error('missing_tenant_context');
  return tenantId;
}
