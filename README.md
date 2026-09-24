# PulseAI

PulseAI is a role-based workforce timesheet platform for recording work hours, validating submissions, managing approvals, tracking exceptions, and preparing authorized finance information.

The repository contains a React and TypeScript frontend, an Express and TypeScript backend, and a MySQL persistence layer. The application is designed around clear authorization boundaries and auditable workflow states rather than opaque automation.

## What PulseAI Provides

- Employee timesheet entry, submission, status tracking, and corrections
- Manager review queues with approve, reject, and return-for-correction decisions
- HR workforce records, reporting lines, and leave-calendar workflows
- Finance views for approved work, billing configuration, and invoices
- Director oversight for organization-wide compliance, approvals, exceptions, notifications, reports, and audit history
- Password authentication plus optional Google and GitHub sign-in
- Server-side role authorization for employee, manager, HR, finance, and director workspaces
- MySQL-backed users, workforce records, timesheets, reporting periods, approvals, finance records, and audit events

## Repository Layout

```text
PulseAI/
├── backend/                  Express API, MySQL initialization, rules, and tests
│   ├── server.ts             API server and database bootstrap
│   ├── financeRoutes.ts      Finance endpoints
│   ├── financeRules.ts       Finance business rules
│   ├── timesheetRules.ts     Timesheet business rules
│   └── tests/                Unit and MySQL integration tests
├── frontend/                 React, TypeScript, and Vite application
│   ├── src/app/App.tsx                    Authentication and workspace routing
│   ├── src/features/dashboards/<role>/    Role-specific workspaces
│   └── vite.config.ts                     Development server and API proxy
├── docs/                     Retained workflow and product references
└── .env.example files        Safe configuration templates
```

`docs/timesheet-demo.html` is retained as a workflow reference. It is not the application entry point and should not be modified as part of normal feature work.

## Prerequisites

Install the following before starting the application:

- Node.js with npm
- MySQL Server 8 or a compatible MySQL installation
- A MySQL user that can create the `pulseai` database and tables

The backend creates the configured database and required tables on startup. No separate migration command is currently required.

## Quick Start

### 1. Install dependencies

From the repository root:

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure the backend

Copy the backend template:

```bash
cd backend
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

At minimum, set a real JWT secret and the MySQL password in `backend/.env`:

```dotenv
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=pulseai
JWT_SECRET=replace_with_a_long_random_secret
SEED_DEMO_DATA=true
DEMO_USER_PASSWORD=replace_with_one_shared_demo_password
```

The approved account blocks in the template configure sign-in for each role. Add at least one account for the workspace you want to exercise. For example:

```dotenv
DIRECTOR_1_NAME=Example Director
DIRECTOR_1_EMAIL=director@example.com
DIRECTOR_1_PASSWORD=use_a_local_password
```

Keep `backend/.env` private. Never commit real passwords, OAuth secrets, database credentials, or JWT secrets.

### 3. Configure optional Google sign-in

The frontend reads the Google client ID from a Vite environment variable. Create `frontend/.env` from the frontend template if needed:

```powershell
cd ../frontend
Copy-Item .env.example .env
```

Set the client ID in `frontend/.env`:

```dotenv
VITE_API_URL=
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

Leave `VITE_API_URL` blank for local development so Vite's `/api` proxy continues to target `http://127.0.0.1:4000`. Set it to the deployed backend origin for Vercel, for example `https://your-backend.up.railway.app`, without adding `/api`.

The Google OAuth client must be configured for the local frontend origin. Password sign-in remains available without Google configuration.

### 4. Configure optional GitHub sign-in

GitHub OAuth is configured on the backend. Set these values in `backend/.env` and register the callback URL in the GitHub OAuth application:

```dotenv
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:4000/api/auth/github/callback
```

The callback URL must match the GitHub application configuration exactly.

### 5. Start the backend

In one terminal:

```bash
cd backend
npm run dev
```

The API listens on `http://localhost:4000` by default.

### 6. Start the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in a browser. Vite proxies `/api` requests to the backend at `http://127.0.0.1:4000`.

## Demo Data

When `SEED_DEMO_DATA=true`, the backend prepares demonstration departments, employees, reporting periods, timesheets, approvals, validation findings, and finance records during startup. Set `DEMO_USER_PASSWORD` to at least eight characters to create a complete set of role logins with that shared password:

| Role | Demo email |
| --- | --- |
| Employee | `aarav@emerson.demo` |
| Manager | `meera@emerson.demo` |
| HR | `hr@emerson.demo` |
| Finance | `finance@emerson.demo` |
| Director | `director@emerson.demo` |

Additional Manager accounts are created for `dev@emerson.demo`, `ritu@emerson.demo`, and `nikhil@emerson.demo`. Seeding is idempotent, so restarting the backend fills missing demo records without duplicating them. Existing timesheets that already have workflow audit history are preserved.

Use demo seeding only in local, preview, or dedicated demonstration environments. Set it to `false` before connecting the service to a production database that should contain real workforce records.

The backend also creates configured Director, Manager, Finance, and HR accounts from the corresponding environment-variable blocks. Employee account creation is enabled when `EMPLOYEE_1_NAME`, `EMPLOYEE_1_EMAIL`, and `EMPLOYEE_1_PASSWORD` are configured and the email matches an active employee roster record.

## Available Workspaces

### Employee

Employees can work with their own active reporting period, enter daily hours and remarks, submit a timesheet, view status history, and respond to returned or rejected entries.

### Manager

Managers see the employee records assigned to them and can review submitted or resubmitted timesheets. Decisions require valid workflow state and can include a return reason.

### HR

HR manages workforce records, reporting lines, leave-related information, and shared employee data used by other workflows.

### Finance

Finance works with approved timesheet data, billing configuration, invoice status transitions, and authorized downstream billing preparation.

### Director

Directors receive organization-wide oversight of timesheet compliance, approval progress, exceptions, department drill-down, notifications, reporting, and audit history. Director access is restricted to explicitly configured approved accounts.

## Development Commands

Run commands from the package directory they belong to.

### Frontend

```bash
cd frontend
npm run dev       # Start Vite with hot reload
npm run build     # Type-check and create the production bundle
npm run lint      # Run Oxlint
npm run preview   # Serve the production bundle locally
```

### Backend

```bash
cd backend
npm run dev              # Start the API with tsx watch mode
npm run build            # Compile the API into backend/dist
npm start                # Run the compiled API with Node
npm run typecheck        # Run TypeScript without emitting files
npm test                 # Run unit and rule tests
npm run test:integration # Run MySQL integration tests when enabled
```

Integration tests are opt-in and require a reachable MySQL database plus `RUN_MYSQL_INTEGRATION=true`. Configure the same database variables used by the backend before running them.

## Configuration Reference

The complete, commented configuration templates are the source of truth:

- [Backend environment template](backend/.env.example)
- [Frontend environment template](frontend/.env.example)

Important backend variables include:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | API listening port | `4000` |
| `CLIENT_ORIGIN` | Allowed browser origin for CORS | `http://localhost:5173` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_NAME` | Application database name | `pulseai` |
| `DB_SSL` | Enable TLS for hosted MySQL providers such as Aiven | `false` |
| `DB_CA` | Optional PEM CA certificate with literal `\n` line breaks | Blank |
| `DB_SSL_REJECT_UNAUTHORIZED` | Require certificate verification without a custom CA | `false` |
| `MYSQLHOST` / `MYSQLPORT` | Railway MySQL fallback host and port | Blank / `3306` |
| `MYSQLUSER` / `MYSQLPASSWORD` | Railway MySQL fallback credentials | Blank |
| `MYSQLDATABASE` | Railway MySQL fallback database name | Blank |
| `JWT_SECRET` | JWT signing secret | Required |
| `SEED_DEMO_DATA` | Enable local demonstration records | Disabled unless `true` |
| `DEMO_USER_PASSWORD` | Shared password used to create all demo role accounts | Blank |
| `BUSINESS_TIME_ZONE` | Time zone used for deadlines and active periods | `Asia/Kolkata` |
| `MANAGER_DAILY_HOURS_WARNING_THRESHOLD` | Optional manager warning threshold | Blank |

`DB_*` variables take precedence when explicitly configured. On Railway, the `MYSQL*` variables can be supplied directly by the MySQL service. The backend skips `CREATE DATABASE` when Railway database variables are present, then initializes the application tables and compatibility columns at startup. Review the startup initialization carefully before applying schema changes to an existing production database.

OAuth, role-account, and frontend variables are documented inline in [backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example). Environment files containing real credentials are intentionally ignored by Git. `.env.example` files remain trackable.

## Security and Authorization

- Treat all environment files except `.env.example` as secrets.
- Keep OAuth client secrets, database passwords, and JWT secrets out of source control.
- Authorization is enforced by the backend; hiding a frontend role selector is not a security boundary.
- Use HTTPS, production-grade secret storage, restricted database users, and non-demo data settings before deployment.
- Review audit events when investigating workflow or authorization changes.
- AI/ML functionality is not part of the current application scope.

## Product Principles

PulseAI is being developed around these principles:

1. Make workforce risk and ownership legible within seconds.
2. Preserve authorization boundaries at every layer.
3. Prefer explainable, auditable workflow states over opaque automation.
4. Keep operational work dense, calm, and action-oriented.
5. Build role experiences progressively without breaking shared data integrity.

## Current Scope Notes

Timesheet cadence, overtime and leave policy, approval hierarchy, integration contracts, payroll or invoice rules, and other stakeholder-dependent decisions may evolve as requirements are finalized. Keep those decisions explicit in the product and functional documentation rather than inferring them from UI behavior alone.
