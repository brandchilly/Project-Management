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
