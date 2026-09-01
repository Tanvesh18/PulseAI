# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Implemented foundation: Next.js and React with TypeScript for the frontend; NestJS with TypeScript for the backend; PostgreSQL with Prisma migrations; and configurable OIDC bearer-token verification. The Employee current-timesheet path is connected end to end. A PostgreSQL-backed job queue and optional Python/FastAPI analytics service remain planned for later phases.

## Users

- Employees record, validate, submit, and review their own weekly timesheets.
- Managers review assigned employees, resolve anomaly flags, and approve or reject timesheets.
- HR maintains workforce records, imports employee data, and monitors submission compliance.
- Finance uses approved hours for payroll-ready exports and invoice preparation, with restricted access to compensation and billing data.
- Directors review organization-wide operational and workforce summaries.

## Product Purpose

Pulse AI is an enterprise workforce-management application that connects employee time capture to validation, approval, payroll preparation, and invoice preparation. It exists to reduce missing or incorrect timesheets, shorten administrative review, preserve accountability, and make permitted workforce information easier to understand.

Success means users can complete a reliable weekly employee-to-manager-to-finance workflow with less manual checking, clear exceptions, secure role boundaries, and full traceability.

## Positioning

Pulse AI combines a conventional, auditable timesheet workflow with explainable anomaly detection and a permission-aware assistant. AI supplements deterministic controls; it does not approve timesheets, calculate payroll, or override authorization.

## Operating Context

The primary operating rhythm is weekly. Employees enter hours by project and task, submit a period, managers approve or reject it, and Finance prepares downstream exports from locked approved records. HR imports employee and organizational data. Scheduled jobs issue reminders for missing submissions and pending approvals. Users work mainly in dense dashboards, tables, queues, forms, and review panels on desktop, with essential tasks remaining usable on smaller screens.

## Capabilities and Constraints

- Required domains include employees, departments, clients, projects, tasks, assignments, timesheets, entries, approvals, notifications, anomaly flags, payroll-ready exports, invoice drafts, and audit events.
- Timesheets follow explicit draft, submitted, rejected, resubmitted, approved, reopened, and void states as applicable.
- Approved time is locked and becomes the source for Finance outputs.
- Authorization is enforced by the backend using role, action, resource, organizational scope, and field sensitivity.
- Salary and billing-rate information are restricted independently from general workforce access.
- Deterministic rules handle numerical and policy validation.
- Statistical methods may flag unusual entries but do not automatically reject them.
- The LLM assistant is read-only, uses restricted backend tools, and never receives arbitrary SQL execution.
- Payroll tax calculation, autonomous invoice delivery, employee surveillance, GPS tracking, and a complete accounting system are outside the approved scope.
- Exact approval levels, work-hour rules, salary scope, invoice rules, SSO provider, integrations, hosting, and external-LLM data policy remain stakeholder decisions.

## Brand Commitments

- Product name: Pulse AI.
- Tone: professional, precise, calm, trustworthy, and operational.
- The interface must feel like enterprise workforce software, not an e-commerce site, flashy startup, or generic AI dashboard.
- The design system must use disciplined tokens, clean white and gray surfaces, restrained accent use, strong information hierarchy, and responsive behavior.
- Manrope is preferred, with Inter and system sans-serif fallbacks.

## Evidence on Hand

- `Employee Timesheet and Workforce Management System.docx`: project SRS.
- `FF_180_PulseAI_Completed_with_Architecture.pdf`: project synopsis and preliminary architecture.
- `PulseAI_Full_Project_Plan.md`: research-backed product and architecture plan.
- `Plan.md`: current planning directive.
- `design.md`: incumbent HP-inspired design analysis to be replaced; it is evidence, not continuing brand authority.
- No approved Pulse AI logo, production UI, customer testimonials, usage metrics, or final Emerson brand kit is currently present. Future work must not fabricate them.

## Product Principles

1. Make the next required action unmistakable.
2. Show state, scope, ownership, and exceptions wherever a decision is made.
3. Prefer deterministic controls and traceable evidence over opaque automation.
4. Keep sensitive workforce and compensation data visibly and technically scoped.
5. Use AI only when it adds understandable value and always reveal its limits.

## Accessibility & Inclusion

The web application should target WCAG 2.2 AA. Keyboard access, visible focus, semantic structure, non-color status cues, adequate contrast, reduced-motion support, readable data tables, clear validation, and zoom/reflow behavior are required. Visualizations must provide text equivalents and must not rely on hue alone.
