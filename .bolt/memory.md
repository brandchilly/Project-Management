# Project memory

## Product intent & audience

- PMS (Project Management System) — frontend for managing projects/tasks.
- Target: teams/users needing project management workflows.
- Comprehensive frontend plan covering architecture, UI/UX, components, and phased implementation.

## Brand personality & voice

- Professional, productivity-focused tone.
- Clarity and efficiency over flourish; interfaces should feel capable and trustworthy.

## Visual design & UX direction

- Vite + React; JSX + Tailwind CSS for styling.
- Lucide React for all icons/logos.
- `@/` path alias maps to `src/` — prefer over deep relative imports.
- Aiming for production-quality, non-cookie-cutter UI per author instructions.
- No additional UI/theme/icon packages unless explicitly requested.

## Decisions, constraints & rationale

- Target shared repo: `https://github.com/TusharChauhan04/PMS.git`
- Direct `git push` is not possible from this workspace; publishing/syncing must go through Bolt's GitHub integration (connect repo URL in Bolt).
- No project files were changed in this turn; only guidance provided.

## Open questions & assumptions

- Assumed PMS = Project Management System; exact feature scope and data models not yet specified.
- Backend/API details unknown; current focus appears to be frontend plan.
- Repo connection status and branch strategy not yet confirmed.
- Tech stack details beyond Vite+React (TypeScript? routing lib? state management?) still to be clarified.