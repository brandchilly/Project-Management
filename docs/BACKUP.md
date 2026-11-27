# Backups and keep-alive

## What runs automatically

| Workflow | When | What it does |
|---|---|---|
| `Weekly database backup` (`.github/workflows/backup.yml`) | Every Monday at 2:00 AM IST | Dumps the database (roles, schema and data, including logins), **encrypts** the dump with your passphrase, and keeps it for 90 days as a downloadable artifact. |
| `Keep Supabase awake` (`.github/workflows/keep-alive.yml`) | Every 3 days | Makes one harmless call, so the free project never pauses after 7 quiet days. |
| `pms-retention` (database cron job) | Every night at 3:00 AM IST | Deletes chat older than the period set in Admin › Settings (6 months by default), read alerts older than 90 days, and activity older than 12 months. |

Files in Storage (attachments) are **not** in the database backup. Download anything important from the app.

## One-time setup (5 minutes)

On GitHub: **Settings › Secrets and variables › Actions › Secrets › New repository secret**.

1. `SUPABASE_DB_URL`
   - In Supabase, click **Connect** (top bar) and choose **Session pooler**.
   - Copy the URI and replace `[YOUR-PASSWORD]` with the database password.
   - Use the Session pooler, not the direct connection: GitHub runners can't reach the direct address on the free plan.
   - Paste it only into GitHub, nowhere else.
2. `BACKUP_PASSPHRASE`
   - Make up a long passphrase and save it in a password manager.
   - **Without it, a backup cannot be opened.**
3. Run both workflows once by hand: **Actions › (workflow) › Run workflow**. Both should finish green.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are already needed for the deploy, and the keep-alive reuses them.

## Restoring (only if something went badly wrong)

1. Download the artifact: **Actions › Weekly database backup › (a run) › Artifacts**.
2. Decrypt it (needs `gpg`, which comes with Git for Windows):
   ```bash
   gpg --decrypt pms-backup-YYYY-MM-DD.tar.gz.gpg > backup.tar.gz
   tar -xzf backup.tar.gz
   ```
3. Restore into a **new, empty** Supabase project with `psql` and the new project's Session pooler URL:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file backup/roles.sql --file backup/schema.sql \
     --command 'SET session_replication_role = replica' --file backup/data.sql \
     --dbname "<NEW_PROJECT_SESSION_POOLER_URL>"
   ```
4. Re-create the client logins in the Vault. Vault secrets are encrypted with a key that belongs to the old project, so they can't be decrypted in a new one.
5. Point the app at the new project by updating `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy.

## When to move to Pro ($25/month)

Any one of these:
- The database passes about 350 MB (Admin › Settings › Usage).
- About 150 people are online at once.
- You want daily backups with point-in-time restore instead of this weekly dump.
