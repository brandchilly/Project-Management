# BrandChilly PMS

BrandChilly's internal project management system. It replaces the Google Sheets the team uses to run the 14-day **Digital Sales Engine** and **Personal Branding** launches.

- **Members** open **My Tasks** and tap **Done** (or **Send for Review**).
- **Managers** run the **Client Board**, approve reviews and add custom tasks.
- **Admins** manage users, templates and settings.

The plan and the full feature checklist are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind, Radix UI, lucide-react, TanStack Query, React Router (HashRouter), react-hook-form + zod, date-fns (IST) |
| Backend | Supabase: Postgres + RLS, Auth, Realtime, Storage, Edge Functions, pg_cron, Vault. Mumbai region. |
| Hosting | GitHub Pages through GitHub Actions, served at `pm.brandchilly.com`. Installable as a PWA. |

The business rules live in the database, so they hold even if someone calls the API directly:

| Rule | Where it lives |
|---|---|
| Client creation | `create_client_from_template()` |
| Task status rules | `set_task_status()`, `approve_task()`, `request_task_changes()` |
| Working days (Mon–Sat, minus holidays) | `add_working_days()` |
| Stage auto-complete and delay shifting | Triggers |
| Access control | RLS on every table |

## Project layout

```
src/
  features/        feature screens (auth, tasks, board, clients, ...)
  components/      ui/ (Radix-based primitives), layout/, brand/, app/
  hooks/           useAuth (role comes from the profiles table)
  lib/             supabase client, IST date helpers, constants
  types/           database.ts (generated: npm run gen:types)
supabase/
  migrations/      schema, RLS, workflow functions, seed, cron, vault
  functions/       Edge Functions (admin-users, ...)
  tests/           Supabase stubs for the local DB tests
scripts/           test-db.mjs, gen-types.mjs
```

## Local development

```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run test:db` | Applies every migration to an in-memory Postgres (PGlite, no Docker needed). Then tests the workflow and the RLS rules as real users: member isolation, member edits, departments, the review flow, waiting on client, delay shifting, the vault, recurring tasks, and the SQL Editor bundle itself. |
| `npm run sql:bundle` | Rebuilds `supabase/setup/full_setup.sql` from the migrations. `npm run sql:bundle -- --since <version>` builds an update file containing only newer migrations. |
| `npm run gen:types` | Regenerates `src/types/database.ts` from the migrations |
| `npm run brand:assets` | Regenerates the UI logo, the tab icon (`favicon.ico`) and the app/home-screen icons from `assets/brand/brandchilly-logo-transparent.png` |
| `npm run smoke:live` | Read-only checks against the live Supabase project in `.env` (sign-up off, no public data access, functions deployed) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Typecheck, lint and production build |

Only `VITE_SUPABASE_URL` and the public **anon** key ever go in the frontend. The service role key and any email or WhatsApp keys live only in Supabase Edge Function secrets.

## Supabase setup (SQL Editor, no CLI needed)

Use a project in the **Mumbai (ap-south-1)** region. For production, the **Pro** plan is recommended: the free tier pauses when idle, and Pro includes daily backups.

1. **Create the database.** Open `supabase/setup/full_setup.sql`, copy all of it, and paste it into **Dashboard > SQL Editor > New query**. Click **Run**. It runs as one transaction: if anything fails, nothing is applied, and you can run it again after fixing the problem.
   - It creates the tables, the security rules, the workflow functions, the 8 departments, the Digital Sales Engine and Personal Branding templates, and the schedules.
   - To check what is installed: `select * from private.applied_migrations order by version;`
2. **Auth settings** (Dashboard > Authentication):
   - **Sign In / Providers > Email:** turn off **Allow new users to sign up**. Only the Admin creates accounts.
   - **URL Configuration:** set **Site URL** to `https://pm.brandchilly.com`, and add `http://localhost:5173` to the redirect URLs.
3. **Deploy the `admin-users` function.** The app's Users page needs it to create logins.
   1. Go to **Dashboard > Edge Functions > Deploy a new function > Via Editor**.
   2. Name it exactly `admin-users`.
   3. Replace the sample code with the contents of `supabase/functions/admin-users/index.ts`, then click **Deploy**.
   4. Under the function's **Settings**, turn **Verify JWT with legacy secret** **off** and save. The function checks the caller itself: it validates the login with Supabase Auth, then requires an active Admin. Leaving the legacy check on can block valid logins on projects that use the newer signing keys, and it can also block the browser's CORS pre-check.

   (With the CLI, the equivalent is `npx supabase functions deploy admin-users`.)
4. **Create the first Admin** (see below).
5. **Later, when email is added:** the scheduled jobs call Edge Functions only once these two Vault secrets exist. Until then, in-app notifications work without them.
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<long random string>', 'cron_secret');
   ```

### Create the first Admin

1. In **Authentication > Users > Add user > Create new user**, enter your email and a password, and tick **Auto Confirm User**. Skip this if you have already created your login.
2. Open `supabase/setup/first_admin.sql`, put your email on the marked line, and run it in the SQL Editor. It works whether the login was created before or after step 1 of the setup.
3. Sign in to the app. From **Admin**:
   - **Departments:** add members and job roles, and choose each department's default person.
   - **Users:** create everyone's login, with their role, departments, job roles and reporting manager.
   - **Settings:** add this year's festival holidays.

### Updating an existing project

Never re-run `full_setup.sql` on a project that already has data. It refuses to run twice anyway. Each change ships as `supabase/setup/update_after_<version>.sql`, which contains only the new migrations. Run that file once in the SQL Editor; it also refuses to run twice. Existing clients and tasks are never rewritten.

## Deploy (GitHub Pages)

The GitHub free plan only serves Pages from a **public** repository. That is safe here: the frontend contains only the anon key, and RLS protects every row.

1. **Settings > Pages > Source:** choose **GitHub Actions**.
2. **Settings > Secrets and variables > Actions:** add the secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, using the prod project.
3. Push to `main`. [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the DB tests, the lint and the build, then deploys.
4. **Custom domain:**
   - At your DNS provider, add a `CNAME` record: `pm` → `<github-user>.github.io`.
   - In **Settings > Pages**, set the custom domain to `pm.brandchilly.com` and tick **Enforce HTTPS**.
   - `public/CNAME` already contains the domain.
5. **Before the domain is connected:** to serve from `<github-user>.github.io/PMS/`, add the repository variable `VITE_BASE=/PMS/`. Remove it once the domain is live.

The same `dist/` build works unchanged on Cloudflare Pages or Vercel.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything: users, templates, settings, all clients and the vault |
| Manager | Sees every client. Edits, approves and opens the vault only for clients they manage. Manages the tasks of members who report to them. |
| Member | Sees the clients they have a task on, including every task on those clients, plus their departments' team tasks. Edits only the details of their own tasks (title, description, link, checklist); each edit notifies the admins, the client's manager and their reporting manager. Changes status only through the one-tap actions. |

"Manager" is a permission role. **Departments** (Account Manager, Copywriter, Editor, ...) organise the work: each template task belongs to a department, and that department's **default person** gets the task when a client is added. **Job roles** are titles inside a department. One person can be in several departments, hold several job roles, and also be a Manager.
