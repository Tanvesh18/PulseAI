# PulseAI workflow diagrams

The Mermaid files are editable sources. SVG and PNG files, when present, are renders of those sources. The diagrams describe current server behavior; protected actions require the corresponding authenticated role.

- `overall`: HR setup, employee timesheets, Manager decisions, the separate department review, and Finance billing.
- `timesheet`: daily entry and submission, Manager approval or return, correction and resubmission.
- `invoice`: approved-work eligibility, exceptions, invoice status changes, snapshot checks and cancellation.

## Source references

- Employee entries and submission: [`server.ts`](../../backend/server.ts), routes `/api/employee/timesheet/entries` and `/api/employee/timesheet/submit-daily`; [`timesheetRules.ts`](../../backend/timesheetRules.ts); [`reportingPeriod.ts`](../../backend/reportingPeriod.ts).
- Manager decisions and department submission: `decideManagerTimesheet`, `departmentApprovalStatus`, and `/api/manager/department-submission` in [`server.ts`](../../backend/server.ts).
- Director department decisions: `/api/director/approvals/:id/approve` and `/return` in [`server.ts`](../../backend/server.ts).
- Billing eligibility, snapshot validation and invoice transitions: [`financeRoutes.ts`](../../backend/financeRoutes.ts) and [`financeRules.ts`](../../backend/financeRules.ts).
- Role guards and workflow audit helpers: [`server.ts`](../../backend/server.ts); Finance writes both finance and general audit events via `writeFinanceAudit` in [`financeRoutes.ts`](../../backend/financeRoutes.ts).

## Important details and inconsistencies

- Finance invoice creation checks Manager-approved entries and billing eligibility; it does not require Director department approval. Director approval is a separate department workflow.
- Manager department submission requires a uniquely identifiable department and every active employee in that department to have an approved timesheet. Director approval repeats readiness checks and also checks unresolved critical findings. A returned department can be resubmitted.
- Entry dates must be weekdays, within the active period and no later than today. Hours are positive quarter-hour increments with a maximum daily total of 24. Project work requires active, date-valid employee and activity assignments. Deadline or closed-cycle locks can prevent editing and submission.
- Missing workdays are warnings recorded at submission, not an automatic submission blocker. Approval requires entries, matching totals and no unresolved critical findings.
- The current UI/API exposes Manager approve and return actions. A legacy `rejected` status is still recognized for employee correction and resubmission; no Manager reject route is exposed.
- The November 2026 demo seed inserts on-call entries on Sunday 1 November directly into the database, although the employee entry API rejects weekend dates. This is a fixture/API inconsistency, not a supported employee entry path.
- Invoice creation relies on the invoice-line uniqueness constraint to reject already-reserved entries. Draft cancellation removes invoice lines and releases entries. Ready and finalized invoices cannot be cancelled through that route. Revalidation checks the current billing configuration and source status before Ready and Finalized.
- Timesheet submission notifies the employee and assigned Manager; Manager decisions notify the employee, and approval also notifies Finance users. Department decisions and invoice transitions record audit events; the inspected routes do not create corresponding notifications.
