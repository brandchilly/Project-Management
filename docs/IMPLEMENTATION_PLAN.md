# BrandChilly PMS: Implementation Plan

This plan and checklist come from `PMS-Plan.md` and `BrandChilly-PMS-Mega-Prompt.md`. Every feature in either document is listed here with an ID. Tick a box only when the feature is built **and** verified.

## Confirmed decisions (2026-11-25)

| # | Decision |
|---|---|
| D1 | **Backend: Supabase** (Postgres, RLS, Auth, Realtime, Storage, Edge Functions, pg_cron, Vault), Mumbai region. This replaces FastAPI and MongoDB from PMS-Plan. |
| D2 | **Managers can read every client** (the board shows all clients, and "My clients" is a filter). They can **edit, approve and see the vault only for clients they manage**. |
| D3 | **Every member has a reporting manager** (`profiles.reports_to`, set by the Admin). A manager sees and manages the tasks and workload of their own members, including approving those members' review tasks. |
| D4 | **Post-launch offsets** (Day 21, Day 30) are **working days** counted from onboarding. Repeats after that run on the calendar: weekly or monthly. |
| D5 | **Hosting: GitHub Pages from a public repo** (GitHub free plan). This is safe: only the anon key is in the frontend, and RLS protects the data. |
| D6 | **The Admin creates every account** with an email and password through the `admin-users` Edge Function. There are no invite or verification emails and no public signup. The Admin also resets passwords. |
| D7 | **4 separate access-request tasks** (12, 18, 19, 20). They are **non-blocking** (`blocks_stage = false`), so Onboarding can finish on Day 0. |
| D8 | **The review flow is enforced in the database** from Phase 1. Only a Manager or Admin can move a review task to Done. |
| D9 | **Onboarding on a Sunday or holiday** rolls forward to the next working day, which becomes Day 0. |
| D10 | **Waiting on Client** never counts as overdue. When a task leaves that status, the waiting working days are added to its due date and to `client_wait_days`, which the reports use. |
| D11 | **Stage slip:** when a stage finishes N working days after its due date, all later stages and their open tasks shift forward N working days. `launch_date` moves, and `original_launch_date` never changes. |

### Added 2026-11-26

| # | Decision |
|---|---|
| D12 | **Members read every task on a client they work on, but edit only their own tasks**: tasks assigned to them, or unassigned department tasks in their department. They can change **details only**: title, description, submission link and checklist. Status always goes through the buttons. Due date, assignee and flags stay with managers. |
| D13 | **A member's edit notifies** the Admins, the client's manager and the member's reporting manager. Ticking a checklist item is progress, not an edit, so it sends no notification. |
| D14 | **The 8 seeded names are departments**: Account Manager, Strategist, Copywriter, Designer, Tech, Video Team, Editor, Ads Manager. **Departments are also the teams.** Job roles are optional titles inside a department. Template tasks point to a department, and each department has a **default person**, who must be a member. A person can be in several departments and hold several job roles. The Admin adds all people, job roles and memberships; none are seeded. |
| D15 | **Notifications are in-app only for now.** Email (the digest, the manager summary and client reminders) gets added later. |
| D16 | **The database is set up from the Supabase SQL Editor**: `supabase/setup/full_setup.sql`, then `first_admin.sql`. Each later change ships as a separate `update_after_<version>.sql`. Applied migrations are tracked in `private.applied_migrations`, and a migration can never be applied twice. Existing data is never rewritten. |

## Progress

| Phase | Status |
|---|---|
| 0 Foundation | **Done in code, not yet deployed.** Role comes from `profiles`, demo signup removed, public signup off, IST dates, PWA (manifest, service worker, icons), the GitHub Pages workflow, CNAME, README, error boundary, offline banner, role-guarded routes, new UI primitives, generated DB types. |
| 1 Database | **Done and tested** with `npm run test:db` (48 tests passing, including D12–D14 and the SQL Editor bundle). Not yet applied to the real Supabase project. |
| 2 Admin and clients | **Built and type-checked, not yet tried against the live project.** Screens: Users (create, edit, reset password, deactivate, reporting manager, departments, job roles), Departments (members, job roles, default person), Templates editor, Settings (holidays, reminder switches), Add Client (with schedule and assignee preview), Clients list, Account (profile, password, email preferences). |
| 3–6, 9–11 | **Built and type-checked, not yet tried live.** My Tasks (sections, one-tap Done with Undo, Send for Review with a link, a review queue for managers), the task drawer (actions, approve/request changes, link, description, checklist, files, comments with @mentions, manager settings), the Board (colour cells, filters, stage drawer, custom tasks), the client page (info card, stages, thread, files, vault, activity, edit, pause/resume/complete), My Team, Alerts with the unread badge, realtime sync, Reports, CSV import. Migration `20261126000900` (reports and import) ships as `update_after_20261125000800.sql`. |
| 7–8 email | Deferred (D15). In-app notifications and their cron jobs work. |
| 12 | Pending: live testing, Lighthouse, Pro plan and a separate prod project. |

## Open item

- **Email sending** has been deferred (D15). Notifications are in-app only until an email provider is chosen.

---

## Feature checklist

### A. Platform and foundation (Phase 0)
- [ ] A1 React 18, Vite, TypeScript, Tailwind, Radix/shadcn-style UI, lucide icons
- [ ] A2 TanStack Query, with optimistic status updates — *built, verify live*
- [ ] A3 HashRouter, with lazy-loaded routes — *built screens are lazy-loaded*
- [ ] A4 react-hook-form and zod on every form
- [ ] A5 date-fns with the Asia/Kolkata timezone. Dates shown as DD-MM-YY, with relative labels ("Today", "2 days overdue"). Weeks start Monday. Currency in ₹.
- [ ] A6 PWA (vite-plugin-pwa): installable, app shell cached, friendly offline message
- [ ] A7 GitHub Actions deploy to GitHub Pages, `CNAME` for `pm.brandchilly.com`, HTTPS enforced. The same build works on Cloudflare Pages and Vercel.
- [x] A8 Only the `VITE_SUPABASE_URL` and anon key in the frontend. All other secrets live in Edge Function secrets.
- [ ] A9 Brand design: ink background, crimson glow, `rounded-2xl` cards, BRANDCHILLY wordmark, serif page titles, crimson pill buttons
- [ ] A10 Tap targets of at least 44px, mobile first, skeleton loaders, toasts, friendly empty states
- [ ] A11 Accessibility: WCAG AA contrast, keyboard navigation, visible focus rings
- [ ] A12 Mobile bottom tab bar, slim desktop sidebar, nav filtered by role
- [ ] A13 `features/*` folder structure, generated Supabase types, ESLint and Prettier
- [x] A14 Error boundaries

### B. Auth, roles and users
- [ ] B1 Email and password login. Admin-created accounts only, with public signup disabled.
- [x] B2 Role (admin | manager | member) read from `profiles`, never from user metadata
- [ ] B3 Admin Users page: create a user (name, email, password, role, departments, job roles, reporting manager), edit, deactivate, reset password — *built, verify live*
- [ ] B4 **Reporting manager per member** (D3), plus a "My Team" view for managers — *built, verify live*
- [ ] B5 Users can change their own password — *built, verify live*
- [ ] B6 Departments (the 8 seeded) and job roles under them (D14), kept separate from the permission role — *built, verify live*

### C. Teams (= departments, D14)
- [ ] C1 `departments`, `department_members`, `job_roles` and `profile_job_roles`, managed by the Admin — *built, verify live*
- [ ] C2 Team-level custom tasks (not tied to a client) — *built, verify live*
- [ ] C3 Members see tasks assigned to them plus team-level tasks for their teams — *built, verify live*
- [ ] C4 Members can open only the clients they have at least one task on — *built, verify live*

### D. Templates
- [x] D-1 Seed the **Digital Sales Engine** template: exactly 8 launch stages, the Post-Launch stage and 24 tasks
- [x] D-2 Seed a **Personal Branding** template, starting as a copy
- [ ] D-3 Template editor (Admin): add, rename, reorder and delete stages and tasks; set duration, milestone, department, due offset, needs review, client dependent, blocks stage, recurring; duplicate templates — *built, verify live*
- [x] D-4 Template version increments on every edit, and each client stores `template_version`
- [x] D-5 Editing a template never changes existing clients

### E. Clients
- [ ] E1 Add Client form: name, service/template, onboarding date, manager, contact name, phone, WhatsApp, email, package — *built with a schedule and assignee preview, verify live*
- [ ] E2 `create_client_from_template` in a single transaction: stages, tasks, working-day due dates, default assignees, notifications. Done in under 2 seconds. — *built, verify live*
- [ ] E3 Client list with search — *built (search, status, service, My clients), verify live*
- [ ] E4 Client page info card: contact, WhatsApp, package, onboarding date, launch date, original launch date and delay, manager, progress % — *built, verify live*
- [ ] E5 Client page sections: stages with tasks, files, client thread, vault (role-gated) — *built, verify live*
- [ ] E6 Client lifecycle: onboarding, active, launched, paused, completed — *DB done, UI pending*
- [ ] E7 Edit client details and change the manager — *built, verify live*
- [ ] E8 CSV import (Admin): name, onboarding date and per-stage status, which marks the matching stages and tasks Done. Covers the 12 live clients. — *built, verify live*

### F. Due dates and scheduling
- [x] F1 Working days are Monday to Saturday, skipping the `holidays` table
- [x] F2 Due date = Day 0 + N working days (D9)
- [x] F3 Stage slip shifts later stages and tasks forward, keeping `original_launch_date` and showing the delay in days (D11)
- [ ] F4 Holidays editor in Settings (Indian public holidays) — *built, verify live*

### G. Default assignees
- [ ] G1 Each department has a default person (D14), set on the Departments page — *built, verify live*
- [ ] G2 A new client is fully assigned with zero clicks — *DB done, UI pending*
- [ ] G3 Managers reassign with one click — *built, verify live*

### H. Tasks and statuses
- [x] H1 The only statuses are To Do, In Progress, In Review, Done and Waiting on Client
- [x] H2 Status changes go only through the `set_task_status` RPC, which runs the state machine
- [ ] H3 Waiting on Client records `waiting_since`, shows "waiting X days" and pauses the overdue clock (D10) — *built, verify live*
- [ ] H4 Review: the member attaches a link or file and clicks **Send for Review**. A Manager or Admin clicks **Approve** (Done) or **Request changes** with one comment (back to In Progress). `review_rounds` is counted. — *built, verify live*
- [ ] H5 The button on a review task reads "Send for Review", never "Done" — *built, verify live*
- [ ] H6 Checklist items inside any task — *built, verify live*
- [ ] H7 Custom tasks (marked "Custom") on any stage of a client, or on a team, with assignee and due date — *built, verify live*
- [x] H8 Stage auto-completes when all its **blocking** tasks are Done
- [ ] H9 Access-pending badge while non-blocking access requests are open — *built, verify live*
- [ ] H10 Task drawer (`#/tasks/:id`): details, status, checklist, link and files, comments, review history — *built, verify live*

### I. My Tasks (member home)
- [ ] I1 Sections: Overdue, Today, Waiting on Client, plus a collapsed Upcoming — *built, verify live*
- [ ] I2 Each card shows task, client, due date and one big Done or Send for Review button — *built, verify live*
- [ ] I3 One tap or swipe to change status, with optimistic UI — *built, verify live*
- [ ] I4 Team-level tasks included — *built, verify live*

### J. Client board (manager home)
- [ ] J1 Grid of clients (rows) by the 8 stages plus a Post-Launch column. Sticky first column, horizontal scroll on mobile. — *built, verify live*
- [ ] J2 Cell colours: Done green, Pending orange, Upcoming gold, Overdue crimson, Waiting graphite with a clock icon — *built, verify live*
- [ ] J3 Cells show Done or the due date — *built, verify live*
- [ ] J4 Click a cell to open a drawer with that stage's tasks — *built, verify live*
- [ ] J5 Filters: My clients, Delayed, Launching this week, Service — *built, verify live*
- [ ] J6 Badges for "days waiting on client", delay (+N days) and access pending — *built, verify live*
- [ ] J7 Live updates — *built, verify live*

### K. Collaboration
- [ ] K1 Task comments with @mentions — *built, verify live*
- [ ] K2 File attachments in a private bucket with signed URLs — *built, verify live*
- [ ] K3 One auto-created thread per client — *built, verify live*
- [ ] K4 Realtime for comments, status changes and the board, scoped to what's visible — *built, verify live*
- [ ] K5 Credentials must never go in chat or comments (UI warning, with the vault as the alternative) — *built, verify live*

### L. Notifications
- [ ] L1 In-app bell with a realtime unread count, and an Alerts page — *built, verify live*
- [ ] L2 Triggers: assigned, due today, overdue, @mention, review requested, approved, changes requested — *DB done, UI pending*
- [ ] L3 Daily digest at 9:30 AM IST (`0 4 * * *` UTC): today's tasks and overdue tasks
- [ ] L4 End-of-day overdue summary, sent to managers only — *DB done, UI pending*
- [ ] L5 Per-type email mute in user settings — *built on the Account page; takes effect when email is added*
- [ ] L6 Edge Functions `notify` and `daily-digest`, rate-limited

### M. Waiting on Client reminders
- [ ] M1 Automatic email to the client every 2 days while a task waits on them (`client-reminders`)
- [ ] M2 WhatsApp adapter (Interakt, WATI or Gupshup, with approved templates) behind a feature flag, off by default
- [ ] M3 Per-client switch to turn reminders off

### N. Recurring tasks
- [ ] N1 Weekly Ads Performance Review from Day 21 (pg_cron) — *DB done, UI pending*
- [ ] N2 Monthly Performance Review from Day 30 (pg_cron) — *DB done, UI pending*

### O. Client access vault
- [ ] O1 `client_credentials` encrypted with Supabase Vault — *built, verify live*
- [ ] O2 Visible only to Admins and the client's manager — *built, verify live*
- [ ] O3 Every reveal logged — *built, verify live*

### P. Reports (Managers and Admins)
- [ ] P1 Active clients — *built, verify live*
- [ ] P2 On-time vs delayed — *built, verify live*
- [ ] P3 Average days per stage — *built, verify live*
- [ ] P4 Workload per person (and per reporting manager's team) — *built, verify live*
- [ ] P5 Days lost to Waiting on Client — *built, verify live*

### Q. Security and operations
- [x] Q1 RLS on every table
- [x] Q2 Tests proving a Member cannot read another client, even through the API
- [x] Q3 `activity_log` written for every change, by trigger
- [ ] Q4 Private storage buckets with signed URLs — *DB done, UI pending*
- [ ] Q5 Separate dev and prod Supabase projects; Pro plan with daily backups on prod
- [x] Q6 Indexes on `tasks(assignee_id, status, due_date)`, `tasks(client_id)` and `notifications(user_id, read_at)`
- [ ] Q7 Pagination everywhere; never fetch all tasks

### R. Quality targets
- [ ] R1 First load under 2 seconds on 4G, with code-split routes
- [ ] R2 Lighthouse mobile performance score of 90 or more
- [ ] R3 README covering setup, env vars, deployment and creating the first Admin

### Future: design for these, but don't build yet
- Read-only client progress link
- Ad metrics from the BrandChilly CRM (FastAPI and MongoDB) through its API
- AI helpers: manager daily summary, client update drafts, tasks generated from onboarding call notes
- DMs

### Out of scope
Gantt charts, sprints, story points, time tracking, custom workflow builders, extra statuses, DMs and channels, and a client portal.

---

## Phases

| # | Phase | Checklist IDs |
|---|---|---|
| 0 | Foundation fixes | A1–A14, B1, B2 |
| 1 | Database: schema, RLS, functions, seed, cron | D-1, D-2, D-4, F1–F3, H1–H3, H8, Q1–Q3, Q6, C1 |
| 2 | Templates, users, settings, Add Client | B3–B6, C1, D-3, D-5, E1–E3, E6, E7, F4, G1–G3 |
| 3 | My Tasks, task drawer, review flow | H4–H6, H10, I1–I4 |
| 4 | Client board | J1–J7, H9 |
| 5 | Client page, custom and team tasks | E4, E5, H7, C2–C4 |
| 6 | Comments, files, realtime | K1–K5 |
| 7 | Notifications and digest | L1–L6 |
| 8 | Waiting on Client reminders | M1–M3 |
| 9 | Vault | O1–O3 |
| 10 | Recurring tasks, CSV import | N1, N2, E8 |
| 11 | Reports | P1–P5 |
| 12 | Hardening and launch | Q4, Q5, Q7, R1–R3, A11 |
