# @seta/identity

Identity domain module — users, organizations, sessions, SSO (Entra
OIDC), and RBAC role bindings. Built on better-auth with an argon2id
password hash via `@node-rs/argon2`. No JIT provisioning: admins
pre-create every user; SSO links to an existing account on first login.

## Exports

| Entry | Purpose |
|---|---|
| `@seta/identity` | Public surface — user/org commands and queries |
| `@seta/identity/auth` | better-auth instance and session middleware |
| `@seta/identity/events` | `identity.user.created`, `identity.session.*`, … |
| `@seta/identity/testing` | Test fixtures: seed users, orgs, sessions |
| `@seta/identity/register` | Module registration hook |
