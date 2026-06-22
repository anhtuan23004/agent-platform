import { type AgentToolContext, actorFromContext } from '@seta/agent-sdk';

/** Read the authenticated tenant id off the agent request context. */
export function tenantIdFromContext(ctx: AgentToolContext): string {
  const tenantId = ctx.requestContext?.get('tenant_id') as string | undefined;
  if (!tenantId) throw new Error('missing_tenant_context');
  return tenantId;
}

export function userIdFromContext(ctx: AgentToolContext): string {
  return actorFromContext(ctx).user_id;
}

/** Selected published upload scope injected by PMO chat runtime. */
export function analyticsIngestionSessionIdFromContext(ctx: AgentToolContext): string | undefined {
  const requestContext = ctx.requestContext as { get?: (key: string) => unknown } | undefined;
  const id = requestContext?.get?.('pmo.analytics.ingestion_session_id') as string | undefined;
  return id?.trim() || undefined;
}
