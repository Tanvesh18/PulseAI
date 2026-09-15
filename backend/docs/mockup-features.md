# Mockup feature coverage

## Current workspace focus

Only Director is open for current development. The root URL shows role selection. Director is available through Continue as Director; Manager, Finance, and HR display lock icons and Under maintenance. No automatic role sign-in runs on page load. The Director overview is at `/dashboard`. Sections use `/approvals`, `/reports`, `/timesheets`, `/notifications`, and `/audit`; old `/portal` URLs redirect. Other roles and Employee routes remain locked. Frontend availability is controlled by `frontend/src/config/workspace-focus.ts`; backend access is restricted by `WORKSPACE_FOCUS_ROLE=DIRECTOR` in `backend/.env`. Role implementations and stored accounts are retained. Reopening the other workspaces later also requires restoring their navigation and entry flow.

The reference `timesheet-demo.html` is unchanged. The existing employee pages, typography, colors, controls, and shell styles remain the visual authority.

Open `/portal` or select **Team workspace** in the employee sidebar. Locally, choose Manager, Finance, HR, or Director. Demo role selection is disabled in production; production uses the existing OIDC integration and database role assignments.

| Area | Implemented functionality |
| --- | --- |
| Dashboard | Period selection, scoped employee counts, submission status, short-hours alerts, import history, Finance requests for HR uploads and manager reminders |
| Timesheets | Group/cost center filters, inline editing, Finance grade fields, draft saves, conflict protection, remarks validation, submission confirmation |
| Shared resources | HR lookup, auto-filled employee details, project/hour assignment, confirmed shared-only removal |
| Approvals | Locked manager submissions, director/Finance review, approval, required return reason, resubmission, in-app notifications |
| Finance corrections | Edits require fresh approval; exported timesheets are locked |
| Reports | Business platform, short/excess hours, BG headcount, B1 travel, multi-period parameterized reports, scoped revenue, Excel downloads |
| Master data | Add/edit/export business groups, projects, cost centers, rate cards, FX rates, billing-cycle settings; project workbook import |
| Access | Finance grants roles and cost centers by employee/identity subject, revokes and restores access; changes apply on the next request |
| HR imports | Downloadable six-tab Excel template, atomic validation, joiner/departure proration, transfer and B1 splits, salary-band billing grades, import summaries |
| Exports | Approved nonzero back-charging rows, configured billing/FX rates, real Excel staging workbook, source/version traceability and audit |
| Persistence | PostgreSQL workforce, monthly sheet, master-data and import tables; existing users, notifications and audit events reused |

## Boundaries and assumptions

### Desktop comparison with the running HTML demo

The demo at `http://127.0.0.1:5500/timesheet-demo.html` was inspected through Playwright. The existing persisted workflows cover its timesheet entry, shared resources, approval/return, five report types, master data, access management, and HR workbook import actions. Added gaps include name/email search with empty results, recent dashboard notifications and mark-as-read actions, month-range controls across report types, and a Finance export summary with approved-sheet details before exclusions. Export is disabled until at least one sheet is approved.

The demo's fixed notification counts, completion markers, deadline countdown, and illustrative employee totals are not live operational facts. Pulse AI uses stored records where available; deadline configuration and explicit completion tracking for the early workflow stages are not implemented. External email and direct Oracle upload remain outside the configured integration scope described below. Mobile work is deferred.

- The mockup has inconsistent illustrative dates. A billing month defaults to the previous month's 23rd through the current month's 22nd and 167 hours. Finance can configure these values. Proration uses active weekdays; an organization-specific holiday/payroll policy has not been supplied.
- Demo rates and FX values are illustrative, not current market rates or approved payroll rules.
- Oracle output is a **staging workbook**. Web ADI compatibility and direct upload require the real Oracle template, endpoint and credentials. No external Oracle transmission is performed.
- Reminders and notifications are in-app; email delivery is not configured.
- HR workbook columns are defined by the downloaded template. Optional tabs accept partial changes matched by Employee Code. Locked sheets are skipped; edited draft hours/remarks are retained during regeneration. Invalid imports roll back all changes.
- Supplied salaries must match exactly one configured rate band; ambiguous or missing bands block import.

## Validation

Run `npm.cmd run check` in both backend and frontend; `npm.cmd run build` in frontend verifies production compilation.

