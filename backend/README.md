# Pulse AI backend

NestJS service for Pulse AI. The first vertical slice implements
Employee profile, assigned timesheet entry, history, submission/resubmission,
notifications, and optimistic concurrency.

The backend currently uses static in-memory data. No database is required.
Edits and submissions remain available for the lifetime of the server process
and reset to the seed values whenever the server restarts.

## Local setup

1. Copy `.env.example` to `.env` if you need to override local defaults.
2. Run `npm install`.
3. Run `npm run start:dev`.

`ALLOW_DEV_AUTH=true` permits the seeded development identity only when no
Bearer token is supplied. Set it to `false` outside local development and
configure the OIDC issuer, audience, and JWKS URL.

The API is served below `/api/v1/employee`. Every endpoint resolves the
authenticated user server-side and scopes data access to that employee.
