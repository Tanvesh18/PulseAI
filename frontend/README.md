# Pulse AI frontend

The Pulse AI frontend is an independent Next.js App Router application. It is
kept in `frontend/` so the future NestJS backend can be developed and deployed
without coupling its source tree to the web client.

The current vertical slice implements the Employee experience. The editable
current timesheet is connected through a same-origin proxy to the NestJS API in
`../backend`, including persistent saves, submission, conflicts, and recovery
states. The overview, shell preview, and historical screens still use isolated
demo data while their API presentation work is completed. Non-employee
workspaces are not yet implemented.

## Requirements

- Node.js 22.13 or newer in the Node 22 line, or another version supported by
  the installed dependencies
- npm 10 or newer

## Commands

```bash
npm run dev          # Start the development server
npm run build        # Create a production build
npm run typecheck    # Run TypeScript without emitting files
npm run lint         # Run Next.js and TypeScript lint rules
npm run test         # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
npm run format       # Format supported files
npm run format:check # Verify formatting
npm run check        # Run all static and unit checks
```

## Environment

Next.js loads `.env*` files from this directory. Copy `.env.example` when
application-specific variables are introduced. Environment values must be
parsed through `src/config/env.ts`; browser-exposed values must use the
`NEXT_PUBLIC_` prefix and must never contain secrets.

Set `BACKEND_API_URL` to the NestJS service origin. It defaults to
`http://localhost:4000` for local development.

## Source layout

```text
src/
|-- app/
|   |-- (app)/       # Application routes; authentication is not wired yet
|   |-- (auth)/      # Authentication route group; no auth pages yet
|   |-- globals.css  # Global accessibility and typography baseline
|   |-- layout.tsx   # Root metadata, font, language, and skip link
|   `-- page.tsx     # Redirects to the Employee overview
|-- components/
|   |-- shell/       # Responsive sidebar, header, drawers, and profile context
|   `-- ui/          # Only the primitives used by the Employee slice
|-- config/
|   `-- env.ts       # Typed environment validation boundary
|-- features/
|   `-- employee/    # Employee models, isolated demo data, screens, and tests
|-- styles/
|   `-- tokens.css   # Authoritative implementation design tokens
`-- test/
    `-- setup.ts     # Shared DOM and accessibility test matchers
```

Tests are colocated with the source they verify. Accessibility smoke coverage
includes the application shell, employee overview, current timesheet editor,
and history table alongside token and environment validation.

## Employee routes

- `/employee` — current-period overview, alerts, and recent timesheets
- `/employee/timesheets/current` — API-backed editable weekly timesheet
- `/employee/timesheets/history` — employee timesheet history
- `/employee/timesheets/[periodId]` — read-only historical detail

The overview and historical presentation still use
`src/features/employee/data/mock-employee.ts`. The current editor loads and
mutates data through the Employee API, preserving unsaved input and offering a
retry when the service is unavailable.

## Design tokens

`src/styles/tokens.css` is the only authoritative implementation source for
Pulse AI visual tokens. It maps the values governed by the repository-level
`design.md` into CSS custom properties for color, semantic state, typography,
spacing, radii, elevation, layout, breakpoints, focus, and motion.

Future global and component styles must consume these properties with
`var(--token-name)`. They must not redeclare token names or introduce raw color
values. Token tests enforce required semantic states, unique ownership, and
reliable WCAG AA foreground/background combinations.

CSS custom properties cannot be interpolated inside native media-query
conditions. Responsive styles must therefore mirror the breakpoint values from
`tokens.css` exactly and cite the relevant breakpoint token in a nearby comment;
the custom properties remain the authoritative record.
