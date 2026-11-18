# Production operations runbook (Phase 1 draft)

> **Status:** Operational guidance only. Backup/restore, rollback, incident response and production readiness have **not** been validated against a live environment.

## Environment separation

- Use distinct MySQL databases and credentials for development, staging, demo and production.
- Keep `SEED_DEMO_DATA=false` in production. Do not use demo credentials.
- Use separate JWT and OAuth secrets for each environment; store them in the hosting platform's secret manager.
- Set `NODE_ENV=production`, a strong `JWT_SECRET`, and a specific `CLIENT_ORIGIN`.
- Require verified TLS for remote MySQL. Configure `DB_SSL=true` and either `DB_CA` or `DB_SSL_REJECT_UNAUTHORIZED=true`; verify provider compatibility.
- Do not enable Swagger API docs publicly without explicit authorization and risk review.
- Restrict MySQL network access and grant the runtime database user the least privilege possible after separating schema migrations.

## Database backup and recovery (operator checklist)

1. Identify the actual production database and its hosting provider. Confirm the target with `SELECT DATABASE()` before any operation.
2. Prefer provider-managed automated backups with point-in-time recovery; define retention and offsite storage policies.
3. For an additional logical backup, use a dedicated backup account and a secure environment (never paste credentials into shell history). Example for an appropriately authorized operator:

   ```sh
   mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF --host="$DB_HOST" --user="$BACKUP_USER" --databases "$DB_NAME" > pulseai-backup.sql
   ```

   Ensure credentials are supplied through a secure client configuration, not command arguments. Encrypt and restrict access to the resulting file.
4. **Restore only into a fresh, isolated recovery database/server**, never into production during a drill. Validate tables, record counts, key timesheet and invoice totals, and role login flows.
5. Record recovery point objective (RPO), recovery time objective (RTO), restore duration, backup timestamp and verification evidence.
6. Test restores on a recurring schedule. An untested backup is not a verified recovery strategy.

## Deployment and rollback

1. Require passing CI, reviewed changes, a database backup and a staging smoke test.
2. Inventory current startup schema DDL before adopting versioned migrations. **Do not** deploy unreviewed schema modifications to production.
3. Deploy backend and frontend with environment-specific secrets and immutable build artifacts.
4. Check `/api/health` and exercise a read-only role-specific smoke test.
5. On failure, roll back application artifacts to the last known-good release. **Do not assume database DDL is reversible**; use an explicitly tested forward repair or restore procedure.
6. Record release SHA, operator, time, migration version, outcome and incident notes.

## Incident response

- Contain: restrict access, disable compromised credentials and pause writes if data integrity is at risk.
- Preserve: capture sanitized logs and database snapshots according to access policy.
- Assess: determine affected users, organizations, timesheets, invoices and duration.
- Recover: use verified rollback/recovery procedures and reconcile financial records.
- Notify: follow applicable contractual and legal breach-notification requirements.
- Review: document root cause, corrective tests and prevention actions.

## Monitoring requirements (not yet implemented)

- Structured request/error logs with request IDs and no JWTs, passwords or sensitive payloads.
- Availability, error-rate and latency alerts; MySQL pool/connection health; failed authentication trends.
- Alerting on failed backups, migration failures and unusual Finance finalization errors.
- Dashboards for request latency, approval failures and queue/reminder processing.

## Open production blockers

See [Phase 1 issue](https://github.com/Tanvesh18/PulseAI/issues/2). This runbook is not evidence that backups, monitoring, TLS or recovery are currently configured.
