# Route Catalog and Test Guide

Every screen in the app: who can open it, what it does, and what to check. Run the app locally with `npm run dev`, open http://localhost:5173, and sign in.

**Testing more than one person at once:** use a normal window for the Admin and an **Incognito / Private window** for a Member. Each window keeps its own login, so you can watch live updates move between them.

Issues already known from the audit are listed in [AUDIT_2026-11-26.md](AUDIT_2026-11-26.md) and don't need reporting again.

## Who can open what

| Screen | Route | Admin | Manager | Member |
|---|---|:-:|:-:|:-:|
| Login | `#/login` | ✓ | ✓ | ✓ |
| My Tasks (member home) | `#/my-tasks` | ✓ | ✓ | ✓ |
| Client Board (manager home) | `#/board` | ✓ | ✓ | – |
| My Team | `#/team` | ✓ | ✓ | – |
| Clients | `#/clients` | all | all | only clients they have a task on |
| Add Client | `#/clients/new` | ✓ | ✓ | – |
| Client page | `#/clients/:id` | ✓ (+ vault) | ✓ (vault only for their own clients) | read-only, no vault |
| Task (also opens as a side drawer) | `#/tasks/:id` | ✓ | ✓ | tasks on their clients |
| Chat | `#/chat`, `#/chat/:id`, `#/chat/client/:id` | ✓ (not DMs or groups they aren't in) | ✓ | ✓ (client threads only for their own clients) |
| Alerts | `#/notifications` | ✓ | ✓ | ✓ |
| Account ("Me" on phones) | `#/account` | ✓ | ✓ | ✓ |
| Reports | `#/reports` | ✓ | ✓ | – |
| Admin: Users | `#/admin/users` | ✓ | – | – |
| Admin: Departments | `#/admin/departments` | ✓ | – | – |
| Admin: Templates | `#/admin/templates` | ✓ | – | – |
| Admin: Settings | `#/admin/settings` | ✓ | – | – |
| Admin: Import | `#/admin/import` | ✓ | – | – |

If someone opens a screen they aren't allowed to see, they're sent to My Tasks. The database refuses the data too, even if someone calls the API directly.

---

## Suggested test order (about 30 minutes)

Each step builds on the one before it.

### 1. Login: `#/login`
- [ ] Wrong password shows "Wrong email or password."
- [ ] An Admin lands on the **Board**; a Member lands on **My Tasks**.
- [ ] There is no sign-up link and no demo buttons.

### 2. Departments: `#/admin/departments`
The 8 departments are pre-loaded: Account Manager, Strategist, Copywriter, Designer, Tech, Video Team, Editor and Ads Manager.
- [ ] Add a job role inside a department (e.g. Copywriter → "Script Writer"), then rename it and delete it.
- [ ] Move a department up and down.
- [ ] Add a department and delete it.
- [ ] "Default person" stays disabled until the department has a member.

### 3. Users: `#/admin/users`
- [ ] **Add user** (a Manager): the password is generated, and on save the email and password are copied to the clipboard.
- [ ] Add two **Members**. For each, tick departments and job roles and choose the Manager as **Reporting manager**.
- [ ] Back on Departments, the new people appear as members. Set each department's **default person**.
- [ ] Edit a user and change their departments. The default person in departments they kept is not cleared.
- [ ] **Reset password**: it's copied, and the user can log in with it.
- [ ] **Deactivate**: that user is signed out and can't log in. **Reactivate** restores access.
- [ ] Filters (All, Admins, Managers, Members, Inactive) and search work.

### 4. Settings: `#/admin/settings`
- [ ] Add a holiday (e.g. a festival date) and switch between years.
- [ ] Delete a holiday.
- [ ] The client reminders switch saves. Email shows as "not set up yet", which is expected.

### 5. Templates: `#/admin/templates`
- [ ] Digital Sales Engine shows 8 stages plus Post-Launch, launches on Day 14, and has 24 tasks.
- [ ] Open a task and change its department, due day or flags, then save. The version number goes up.
- [ ] **Duplicate** creates a copy you can rename.
- [ ] Add a stage and delete it. Add a task and delete it.
- [ ] Existing clients do not change after template edits (check one in step 7).

### 6. Add Client: `#/clients/new`
- [ ] Pick a Sunday as the onboarding date. The form says Day 0 moves to Monday.
- [ ] The schedule preview shows every stage date and the **Ads launch** date (14 working days, skipping Sundays and holidays).
- [ ] "Who gets the tasks" lists each department's default person. Departments without one show "Unassigned" in amber.
- [ ] Save. You land on Clients with a toast that shows the launch date.

### 7. Board: `#/board`
- [ ] The new client is a row with 8 stage cells plus Post-launch.
- [ ] Colours: green = Done, orange = in progress, gold = upcoming, crimson = overdue, grey with a clock = waiting on client.
- [ ] Stage 1 shows a key icon while access requests are pending.
- [ ] Filters work: My clients, Delayed, Launching this week, Service.
- [ ] Click a cell to see that stage's tasks. Click a task to open the drawer. Use **Add custom task to this stage**.

### 8. Client page: `#/clients/:id`
- [ ] The info card shows the dates, manager, package and progress %. The call, WhatsApp and email buttons open the right apps.
- [ ] **Stages & tasks** lists every task. Use **+** to add a custom task (it shows the "Custom" tag).
- [ ] **Thread**: post a message with `@Name`. That person gets an alert.
- [ ] **Files**: upload a file, download it, delete it.
- [ ] **Vault**: add a login, reveal it (it hides after 30 seconds), copy it. "Recent reveals" lists you. Edit it, delete it.
- [ ] **Activity** shows the history.
- [ ] Menu: **Edit details**, **Pause** (the client drops out of the Delayed filter), **Resume** (the status returns correctly), **Mark completed** (the client leaves the Board).

### 9. My Tasks as a Member (Incognito window): `#/my-tasks`
- [ ] Sections: Overdue, Today, Waiting on client, Upcoming (collapsed), Sent for review (collapsed).
- [ ] **Done** on a normal task: it disappears at once, and a toast offers **Undo**, which brings it back.
- [ ] A review task shows **Send for Review** (never "Done"). It asks for a link, and an empty link with no file is refused.
- [ ] A client-dependent task: open it, choose **Waiting on client**, and it moves to that section. **Client replied** moves it back.
- [ ] In the task drawer: edit the title, description and link of **your own** task. The Admin and your Manager each get a "edited a task" alert.
- [ ] Another person's task on the same client opens **read-only**.
- [ ] Tick checklist items, add one, remove one.
- [ ] Attach a file and comment on the task.

### 10. Review as Manager or Admin
- [ ] On My Tasks, **Waiting for your review** lists the member's task.
- [ ] **Changes** needs a comment. The task returns to the member as In Progress and they get an alert.
- [ ] The member sends it again. **Approve** marks it Done. In the drawer, "round 2" shows.
- [ ] The Board cell turns green **without refreshing** once the stage's tasks are all Done (live update).

### 11. Late stage shifting
- [ ] Add a client with an onboarding date a few working days in the past, then finish Stage 1's two Onboarding tasks.
- [ ] The later stages and the launch date move forward. The client page shows "Planned …" with the original date, and the Board shows **+Nd**.

### 12. My Team: `#/team`
- [ ] The Manager sees the members who report to them, with open, overdue and in-review counts. Expand a member to see their tasks.
- [ ] **Team task** for a department: every member of that department sees it on My Tasks, and anyone there can complete it.
- [ ] Admin: switch between "My reports" and "Everyone".

### 13. Alerts: `#/notifications`
- [ ] The bell badge counts unread alerts (in the sidebar, and in the bottom bar on phones).
- [ ] Clicking an alert opens the task or client and marks it read. **Mark all read** works.

### 14. Reports: `#/reports`
- [ ] Tiles: Active clients, Launching this week, Delayed now, Average delay.
- [ ] On time vs delayed, average working days per stage (planned vs actual), workload per person, days lost waiting on clients.

### 15. Import: `#/admin/import`
- [ ] Download **Template**, fill in 1–2 clients, paste or upload it, then **Check rows**.
- [ ] Bad dates, an unknown manager, duplicates and existing names are flagged and skipped.
- [ ] **Import**: Done stages show green on the Board, and the client is not marked delayed.

### 16. Account: `#/account` ("Me" on phones)
- [ ] Change your name and phone. Change your password, then log out and back in with it.
- [ ] Email preference switches save. They take effect once email is turned on.
- [ ] On a phone, admins see Admin shortcuts here, and managers see My Team.

### 17. Phone check
- [ ] Use Chrome DevTools device mode. Or run `npm run dev -- --host` and open the "Network" address it prints on a phone on the same Wi-Fi.
- [ ] Bottom tab bar, large buttons, drawers slide up from the bottom, no sideways scrolling except the Board table.

---

## Workspace, task UI, team UI and chat (branch feature/workspace-chat)

First run the database update in the Supabase SQL Editor; see [PLAN_2026-11-26_WORKSPACE_CHAT.md](PLAN_2026-11-26_WORKSPACE_CHAT.md). Then run `npm run dev`.

### W1. Assign task with a client (Admin, or the client's Manager)
- [ ] My Tasks → **New task** and My Team → **Assign task** both open a form with a **Client** picker. It lists only clients you manage; an Admin sees every open client.
- [ ] Choose a client and the **Stage** list fills with its stages. Choose "No client" and it becomes a team task, with Department required.
- [ ] Choose a Department: the assignee becomes its default person, and the list shows only that department's members. **Show everyone** widens it.
- [ ] Set **Priority** to Urgent and save. The task appears on the client page and in the assignee's My Tasks with an **Urgent** flag, without a refresh.
- [ ] As a Member, open your own task: you can't change its priority (the database refuses it).

### W2. My Tasks: `#/my-tasks`
- [ ] Six tiles: Overdue, Due today, Pending, In progress, In review, Completed (30 days). Clicking a tile filters the list; clicking it again clears the filter.
- [ ] Tabs: All open, Pending, In progress, In review, Waiting on client, Overdue and Completed, each with a count.
- [ ] Search matches title, description and client. The client filter includes **Team tasks**. Sorting works by Due date, Priority and Newest first.
- [ ] Each card shows the client, stage, priority, title, a 2-line description, status, deadline and assigned date. The coloured left edge is red when overdue.
- [ ] A **To Do** card has **Start**, which moves it to In progress.
- [ ] Loading no longer flashes "All clear" before the tasks appear (audit item A-03).

### W3. My Team: `#/team` (Admin or Manager)
- [ ] Summary tiles, search, a department filter and three sorts: Needs attention, Most open, Name.
- [ ] Each card shows the person's departments and job roles, their open, today, in-review and done counts, and a progress bar of recent work. Overdue shows in red.
- [ ] **View tasks** opens a profile sheet with contact details, departments, job roles, and Open and Completed tabs. **Assign** opens the task form with that person preset.
- [ ] **Message** opens a direct chat with that person.
- [ ] Open team tasks are grouped by department, in cards.

### W4. Clients: `#/clients`
- [ ] Tiles: All, Onboarding, Active, Launched and Delayed. Clicking one filters the list.
- [ ] Each card shows the current stage (e.g. "Stage 3 of 8 · Script"), progress, open, overdue and in-review counts, the team's avatars and the manager.
- [ ] **Assign task** appears only on clients you can manage.
- [ ] A newly added client's card appears straight away.
- [ ] As a Member, you see only clients where you have a task, with no Assign button.

### W5. Client workspace: `#/clients/:id`
- [ ] **By department** tab: one card per department, with its default person, counts and tasks. Done tasks are collapsed. **Assign** presets that department and its default person.
- [ ] **Team** tab: the client manager comes first, then everyone with tasks here, with progress and counts. **Tasks** expands each person's list, and the chat icon messages them.
- [ ] As a Member, both tabs are visible and read-only.

### W6. Chat: `#/chat`
- [ ] **New → Direct message** with a person. Starting it again from either side reopens the same conversation.
- [ ] **New → New group** with a name and people. Settings (the gear icon) let the creator or an Admin rename the group and add or remove people. Anyone can **Leave**.
- [ ] **Teams** lists one channel per department. Its members, managers and admins can post; other members don't see it.
- [ ] **Clients** opens each client's thread, the same one shown on the client page.
- [ ] A message sent in one window appears in the other within a second or two. The **Chat** badge in the sidebar and phone nav counts unread messages, and opening the conversation clears it.
- [ ] Enter sends and Shift+Enter starts a new line. **@name** suggests only people in that conversation, and the mentioned person gets an Alert that opens the chat.
- [ ] You can delete your own messages (hover a message; on phones the bin is always faintly visible). Typing "password: …" shows the Vault warning.
- [ ] On a phone, the list and the conversation take turns, with a back arrow.
- [ ] An Admin can't see direct messages or groups they aren't part of.

### W7. Chat v2
- [ ] Scroll up in a long conversation: older messages load 50 at a time, and the view doesn't jump.
- [ ] Use the paperclip to attach a photo and a PDF. The photo is compressed and shown inline; the PDF opens on click. A file over 10 MB is refused.
- [ ] A green dot shows who is online. While someone types in the other window, "Rahul is typing…" appears.
- [ ] Use the reply icon on a message: a thread opens beside it and the parent shows "1 reply". On phones the thread fills the screen.
- [ ] React with the smiley icon; click the reaction again to remove it.
- [ ] Type 3+ letters in the Chat search: **Messages found** lists matching messages from your conversations only.
- [ ] Admin › Settings › **Usage and storage** shows database and file meters and how long data is kept (Keep chat: 6 months). **Remove** cleans up unused chat files.
