# Plan: client workspace, task UI, team UI and chat (2026-11-26)

Source: "Platform Improvements & UI/UX Enhancement Requirements" (points 1–6).
Branch: `feature/workspace-chat`. Nothing reaches the live site until it is merged to `main`.

## What exists today (checked in the code)

| Requirement | Today | Gap |
|---|---|---|
| 1. Client when assigning a task | Client page and Board stage drawer: "Add task" is fixed to that client. My Team: "Team task" has **no client choice**. | Client picker in the task form; one "Assign task" form used everywhere; assignee list narrowed to the chosen department. |
| 2. Task section (My Tasks) | Groups: review queue, overdue, today, waiting, upcoming, sent for review. No filters, no search, no completed list, **no priority field**. | Summary tiles, status filters (Pending, In progress, In review, Waiting, Overdue, Completed), search, client filter, sort; richer cards (priority, client, deadline, assigned date, description). |
| 3. Chat | Task comments and a per-client "Thread" exist. **No chat.** | Chat: direct messages, group chats, one channel per department (team), client threads surfaced in Chat, realtime, unread badges, @mentions. |
| 4. My Team | A list of expandable rows. | Card grid with profile, departments, job roles, workload and progress; profile sheet with tasks; "Assign task" and "Message" per person. |
| 5. Client cards and workspace | Clients page already shows a card per client (created automatically). Members already see only clients they have tasks on (enforced in the database). | Richer cards (current stage, open/overdue counts, team avatars, quick "Assign task"); in the client page, **By department** tab (assign per department) and **Team** tab. |
| 6. Same card design | Departments page has its own cards. | Shared card pieces (stat tiles, filter tabs, avatar stack) used by Clients, Team, Tasks and Departments. |

## Decisions taken (recommended defaults; tell me to flip any)

- **P1. One assignee per task.** Review, approval and overdue alerts assume one owner, so multi-assignee would change the workflow engine. To give the same work to several people, add the task once per person.
- **P2. Who can assign tasks on a client:** admins, plus the client's own manager. This is decision D2 and is unchanged. Other managers see the client card and its tasks read-only, and the form only offers clients you manage.
- **P3. Priority:** Low, Normal (default), High or Urgent. Managers and admins set it. Members see it but can't change it (the existing column guard already blocks this). Existing tasks become Normal.
- **P4. Chat scope:**
  - Direct messages: anyone active can message anyone active.
  - Groups: anyone can create one. The creator or an admin renames it and adds or removes people; anyone can leave.
  - Department channels: one per department, made automatically. Members of the department, managers and admins can use it.
  - Client conversations: the existing client **Thread**, now also reachable from Chat. Same access as the client: members only see their own clients.
  - Task conversations: stay in each task's Comments.
- **P5. Privacy:** nobody can read a direct message or group chat they aren't part of, admins included. Admins can delete messages in channels they can open.
- **P6. In v1, chat is text only.** You can send, delete your own message and @mention someone (they get an Alert). Attachments, threads, search, reactions, typing and online status are planned in Chat v2 below.

## How the live system stays safe

1. **The database update only adds things.**
   - New: enum `task_priority`; column `tasks.priority` (default `normal`, no table rewrite); tables `chat_conversations`, `chat_participants`, `chat_reads` and `chat_messages`; their access rules and functions.
   - Replaced: `create_custom_task`, with the **same parameters plus an optional `p_priority`**, so the current app keeps working unchanged.
   - Nothing is deleted or renamed. Existing rows only gain `priority = normal`.
2. **It's one SQL file with the double-run guard.** Run it before testing the new frontend. If it's run twice, it stops with "already applied" and changes nothing.
3. **The frontend copes with an old database.**
   - Before the SQL is run, Chat shows "needs the latest database update" instead of crashing.
   - Priority is sent only when it isn't Normal.
4. **Tests:** every new access rule gets a database test: who can read which chat, DM de-duplication, who manages a group, and that members can't change priority. Existing tests must still pass, plus a typecheck, lint and build.
5. **Release:** test locally on the branch. On your "push", it's merged to `main` and deployed.

## Which SQL file to run

In the Supabase SQL Editor, first check what is already applied:

```sql
select version from private.applied_migrations order by version desc limit 1;
```

| It returns | Run this file | It contains |
|---|---|---|
| `20261126001000` | `supabase/setup/update_after_20261126001000.sql` | read-own-profile fix (1100) + priority (1200) + chat (1300) |
| `20261126001100` | `supabase/setup/update_after_20261126001100.sql` | priority (1200) + chat (1300) |

Running the wrong one is harmless: it stops with "already applied" and changes nothing.

## Build order

1. Database: migrations `…1200_task_priority.sql` and `…1300_chat.sql`, tests, the SQL bundle and regenerated types.
2. Shared card pieces: `StatTile`, `FilterTabs`, `AvatarStack`, `PriorityBadge`.
3. Task form (point 1):
   - A client picker with "No client = team task"; stages load for the chosen client.
   - Department picks the default person, and the assignee list is limited to department members (with "show everyone").
   - Priority.
   - Entry points: My Tasks → New task, My Team → Assign task, client → department → Assign, person card → Assign.
4. My Tasks redesign (point 2).
5. My Team redesign (point 4).
6. Client cards and the client workspace tabs By department and Team (points 5 and 6).
7. Chat (point 3): `/chat` and `/chat/:id`; Chat in the sidebar and phone nav with an unread badge; realtime.
8. Update `docs/ROUTE_CATALOG.md` with the new test steps.

## Known limits (deliberate, can follow later)

- A recurring task's next occurrence starts at Normal priority (the recurrence job isn't touched).
- Chat v1 loads the latest 200 messages and refetches on every new message. Chat v2 (below) replaces this with 50 per page plus live appends.
- Chat v1 has no attachments, typing indicators, online status, threads or search. All of these are in Chat v2.

## Chat v2: aligning with the "Slack-like chat on the Supabase free tier" plan

The plan was reviewed against what v1 already has. Its stack (Postgres, Realtime, Presence and Broadcast, RLS, Storage, no Redis) is the one v1 uses.

### Already covered by v1

| Plan item | In v1 |
|---|---|
| `channels`, `channel_members`, `messages` | `chat_conversations` (direct, group, department), `chat_participants`, `chat_messages` |
| Only members read and write | RLS on every chat table; tested, including that admins can't read others' DMs |
| Realtime on messages | `chat_messages` is in the realtime publication, on its own channel |
| Index `(channel_id, created_at desc)` | `chat_messages_conversation_idx` |
| Unread counts via `last_read_at` | `chat_reads` plus `chat_inbox()` |
| Lean rows | Text plus a uuid array for mentions; no JSON blobs |
| Notifications | @mentions create an in-app Alert (email is deferred, decision D15) |

### Changes and additions, in build order

| # | What | Why | DB change |
|---|---|---|---|
| C1 | **Pagination and egress:** load the newest 50, fetch older ones on scroll up, and add new messages from the realtime payload instead of refetching the list | v1 refetches up to 200 messages on every message, which wastes the 5 GB/month egress | None |
| C2 | **Attachments:** files go to the existing private `files` bucket under `chat/<conversation>/…`, and the message stores only the path. Images are compressed in the browser (max 1600 px, WebP). Limit is 10 MB per file. Signed URLs. | Plan rules 1 and 2 | New migration: `chat_messages.attachments` (small array of path, name, size and type), plus a `chat/` branch in `can_access_storage_path` (additive `create or replace`) |
| C3 | **Online status and typing:** one Presence channel for "online", and Broadcast "typing…" per conversation. Nothing is stored. | Plan stack; it doesn't count toward database size | None |
| C4 | **Threads:** replies to a message, shown in a side panel | Plan step 6 | `chat_messages.parent_id`, nullable |
| C5 | **Search:** across messages you can read | Plan step 6 | `tsvector` generated column plus a GIN index; RLS still applies |
| C6 | **Reactions:** emoji on messages | Plan "later" | `chat_reactions(message_id, user_id, emoji)` |
| C7 | **Retention job:** pg_cron deletes chat messages older than **12 months**, plus read notifications older than 90 days and activity_log older than 12 months. Chat files are removed with their messages. | Plan rule 6; this was also an earlier audit finding | New cron job |
| C8 | **Keep-alive:** a GitHub Action every 3 days makes one read-only API call with the public key | Plan rule 7; prevents the free project pausing over holidays | None (workflow file) |
| C9 | **Weekly backup:** a GitHub Action runs `pg_dump`, then **encrypts** the dump before storing it | Plan rule 8; the free plan has no backups at all | Workflow plus 2 secrets |
| C10 | **Usage check:** database size, storage used and the largest tables, in Admin › Settings | Plan rule 9 | Admin-only RPC |

### Corrections to the pasted plan

- **Backups in a public repo (important):** artifacts from a public repository can be downloaded by anyone. An unencrypted dump would expose every client's data. C9 encrypts the dump with a passphrase you keep, or sends it to private storage. The database password goes only into GitHub **Secrets**, entered by you, never in chat or code.
- **"Start from Supabase's Realtime Chat UI component":** not needed. v1 already has its own chat UI in the app's design, and the component would duplicate it.
- **Realtime filter by `channel_id`:** a filter on one conversation would hide unread counts for the others. v1 keeps one subscription that RLS limits to the person's own conversations, and C1 makes each event cheap.
- **Notifications via Make.com:** not needed for in-app Alerts, which already work. Use it, or Resend, only when email is turned on.

### Decisions (confirmed 2026-11-27) and status

- **Retention:** chat is kept for **6 months**. An admin can change this in Admin › Settings › Usage.
- **File limit:** 10 MB per file.
- **Backups:** encrypted, stored in GitHub (see `docs/BACKUP.md`).
- **Status:** C1–C10 are built on the branch. The database part is migration `20261126001400_chat_v2.sql`, included in the update files. Database tests pass 66 of 66.

### When to upgrade to Pro ($25/month)

Any one of these is enough:
- The database passes about 350 MB (C10 shows it).
- About 150 people are online at the same time.
- You need daily backups and point-in-time restore rather than the weekly dump from C9.
- A pause would hurt even with C8 in place.

Redis isn't needed at this team size.
