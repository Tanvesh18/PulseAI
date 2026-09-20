# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Directors are the first active users. They need organization-wide oversight of timesheet compliance, approvals, exceptions, audit history, and reporting.
- Future Employee, Manager, and HR workspaces remain part of the product scope but are currently locked while their workflows are implemented.

## Product Purpose

PulseAI is a role-based workforce-timesheet platform for recording work hours, validating submissions, managing approvals, surfacing compliance risks, and preparing authorized downstream finance information.

Its immediate goal is to give approved Directors a reliable, controlled view of organizational timesheet health and exceptions without turning the Director workspace into day-to-day timesheet entry.

## Positioning

PulseAI connects workforce time entry, validation, approval status, exception tracking, notifications, and audit data in one permission-aware operational system.

## Operating Context

- Emerson industry-project context.
- Employees submit timesheets; Managers review and approve or reject them; HR maintains workforce records; Finance prepares authorized downstream outputs; Directors oversee organization-level performance.
- Current reporting focuses on organization-wide compliance, exceptions, department drill-down, notifications, and audit history.
- The retained `docs/timesheet-demo.html` is a workflow reference only and must not be modified as part of real application work.

## Capabilities and Constraints

- React + TypeScript/Vite frontend and TypeScript/Express/MySQL backend.
- MySQL persists users and workforce workflow data.
- Director access is restricted to approved accounts configured through the backend environment.
- Role-based authorization must be enforced server-side.
- Director data is oversight-oriented and read-only by default; restricted compensation and finance data require explicit authorization.
- AI/ML functionality is intentionally out of scope until explicitly requested.
- Timesheet cadence, overtime/leave policy, approval hierarchy, integration contracts, and payroll/invoice rules remain stakeholder decisions.

## Brand Commitments

- Product name: PulseAI.
- Voice: clear, controlled, operational, and trustworthy.
- Avoid generic AI-product treatment and do not copy external brands or assets.

## Evidence on Hand

- `docs/SRS.docx`, `docs/Pulse_AI_PRD_v1.docx`, and `docs/Pulse_AI_FSD_v1.docx` define requirements and functional scope.
- `docs/timesheet-demo.html` provides a retained workflow reference.
- Existing React Director dashboard and TypeScript backend provide working authentication, Director authorization, MySQL persistence, dashboard data, exceptions, reporting, notifications, audit events, and department drill-down.

## Product Principles

1. Make workforce risk and ownership legible within seconds.
2. Preserve authorization boundaries at every layer.
3. Prefer explainable, auditable workflow states over opaque automation.
4. Keep operational work dense, calm, and action-oriented.
5. Build role experiences progressively without breaking shared data integrity.

## Accessibility & Inclusion

- The web product should support keyboard navigation, visible focus, semantic controls, readable operational data, responsive layouts, and non-color-only status communication.
