# @seta/integrations

External integrations module — encrypted credential storage, mail
transport configuration, and Microsoft Graph connectors (SSO consent,
Planner sync). Credentials are sealed with `@seta/shared-crypto` data
keys before they land in Postgres.

## Exports

| Entry | Purpose |
|---|---|
| `@seta/integrations` | Public surface — credential and connector commands |
| `@seta/integrations/backend` | Backend handlers and route mounts |
| `@seta/integrations/events` | `integrations.credential.*`, sync events |
| `@seta/integrations/db` | Pooled Drizzle client (`integrations` schema) |
| `@seta/integrations/db/schema` | Credential, mailer, and provider tables |
| `@seta/integrations/register` | Module registration hook |
