// Database tests: applies every migration to an in-memory Postgres (PGlite) with small
// Supabase stubs, then exercises the workflow and the RLS rules as real users.
// Run: npm run test:db
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createMigratedDb, root } from './lib/migrated-db.mjs';
import { buildBundle, bundleFileName, setupDir } from './lib/sql-bundle.mjs';

console.log('Applying migrations');
let db;
try {
  db = await createMigratedDb({ log: console.log });
} catch (e) {
  console.error(`  ${e.message}`);
  process.exit(1);
}
let passed = 0;
const failures = [];

async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0];
}
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !pattern.test(e.message)) {
      throw new Error(`Expected error matching ${pattern}, got: ${e.message}`);
    }
    return;
  }
  throw new Error(`Expected an error matching ${pattern}`);
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// Users. The role comes from app_metadata; user_metadata.role must be ignored.
const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  mgr1: '00000000-0000-0000-0000-0000000000a1',
  mgr2: '00000000-0000-0000-0000-0000000000a2',
  copy: '00000000-0000-0000-0000-0000000000b1', // copywriter, reports to mgr1
  editor: '00000000-0000-0000-0000-0000000000b2', // editor, reports to mgr2
  am: '00000000-0000-0000-0000-0000000000b3', // account manager
  outsider: '00000000-0000-0000-0000-0000000000b4', // no tasks anywhere
  sneaky: '00000000-0000-0000-0000-0000000000b5', // tries user_metadata.role = admin
};
async function addUser(id, email, role, name, userMeta = {}) {
  await q(
    `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3, $4)`,
    [id, email, role ? { role } : {}, { full_name: name, ...userMeta }]
  );
}
await addUser(U.admin, 'admin@bc.test', 'admin', 'Asha Admin');
await addUser(U.mgr1, 'mgr1@bc.test', 'manager', 'Manish One');
await addUser(U.mgr2, 'mgr2@bc.test', 'manager', 'Meera Two');
await addUser(U.copy, 'copy@bc.test', 'member', 'Chirag Copy');
await addUser(U.editor, 'editor@bc.test', 'member', 'Rahul Editor');
await addUser(U.am, 'am@bc.test', 'member', 'Anu AM');
await addUser(U.outsider, 'out@bc.test', 'member', 'Omar Outside');
await addUser(U.sneaky, 'sneaky@bc.test', null, 'Sam Sneaky', { role: 'admin' });

console.log('\nTests');

await test('seed: Digital Sales Engine has 9 stages and 24 tasks at version 1', async () => {
  const r = await one(`
    select t.version,
      (select count(*)::int from template_stages s where s.template_id = t.id) as stages,
      (select count(*)::int from template_tasks tt join template_stages s on s.id = tt.template_stage_id
        where s.template_id = t.id) as tasks
    from templates t where t.name = 'Digital Sales Engine'`);
  assert.deepEqual(r, { version: 1, stages: 9, tasks: 24 });
  const nos = await q(`select array_agg(task_no order by task_no) as n from template_tasks tt
    join template_stages s on s.id = tt.template_stage_id join templates t on t.id = s.template_id
    where t.name = 'Digital Sales Engine'`);
  assert.deepEqual(nos[0].n, Array.from({ length: 24 }, (_, i) => i + 1));
});

await test('seed: Personal Branding is a full copy at version 1', async () => {
  const r = await one(`
    select t.version, (select count(*)::int from template_tasks tt join template_stages s on s.id = tt.template_stage_id
      where s.template_id = t.id) as tasks from templates t where t.name = 'Personal Branding'`);
  assert.deepEqual(r, { version: 1, tasks: 24 });
});

await test('working days skip Sundays and holidays', async () => {
  const r = await one(`select
    add_working_days('2026-11-28', 1)::text as sat_plus_1,
    add_working_days('2026-12-24', 1)::text as christmas_eve_plus_1,
    next_working_day('2026-11-29')::text as sunday_next,
    working_days_between('2026-11-27', '2026-11-30') as fri_to_mon,
    working_days_between('2026-11-30', '2026-11-27') as backwards,
    add_working_days('2026-11-30', 0)::text as zero`);
  assert.deepEqual(r, {
    sat_plus_1: '2026-11-30',
    christmas_eve_plus_1: '2026-12-26',
    sunday_next: '2026-11-30',
    fri_to_mon: 2,
    backwards: -2,
    zero: '2026-11-30',
  });
});

await test('profiles: role comes from app_metadata, never user_metadata', async () => {
  const rows = await q(`select id, role from profiles order by email`);
  const role = Object.fromEntries(rows.map((r) => [r.id, r.role]));
  assert.equal(role[U.admin], 'admin');
  assert.equal(role[U.mgr1], 'manager');
  assert.equal(role[U.sneaky], 'member');
});

const dept = async (name) => (await one(`select id from departments where name = $1`, [name])).id;

await test('seed: 8 departments, no job roles or people; every template task has a department', async () => {
  const d = await q(`select name from departments order by position`);
  assert.deepEqual(d.map((r) => r.name), [
    'Account Manager', 'Strategist', 'Copywriter', 'Designer', 'Tech', 'Video Team', 'Editor', 'Ads Manager',
  ]);
  assert.equal((await one(`select count(*)::int n from job_roles`)).n, 0);
  assert.equal((await one(`select count(*)::int n from department_members`)).n, 0);
  assert.equal((await one(`select count(*)::int n from template_tasks where department_id is null`)).n, 0);
});

await test('departments: default person must be a member; job role implies membership', async () => {
  const copywriter = await dept('Copywriter');
  await rejects(
    as(U.admin, () => q(`update departments set default_user_id = $1 where id = $2`, [U.copy, copywriter])),
    /must be a member/
  );
  const role = (await as(U.admin, () => one(`insert into job_roles (department_id, name) values ($1, 'Script Writer') returning id`, [copywriter]))).id;
  await as(U.admin, () => q(`insert into profile_job_roles (user_id, job_role_id) values ($1, $2)`, [U.copy, role]));
  assert.ok(await one(`select 1 from department_members where department_id = $1 and user_id = $2`, [copywriter, U.copy]));
  await as(U.admin, () => q(`update departments set default_user_id = $1 where id = $2`, [U.copy, copywriter]));
  await rejects(as(U.copy, async () => {
    const r = await q(`insert into job_roles (department_id, name) values ($1, 'Nope') returning id`, [copywriter]);
    if (r.length) throw new Error('allowed');
  }), /row-level security|allowed/);
});

await test('departments: leaving clears the default and that department\'s job roles', async () => {
  const designer = await dept('Designer');
  const role = (await as(U.admin, () => one(`insert into job_roles (department_id, name) values ($1, 'Motion') returning id`, [designer]))).id;
  await as(U.admin, () => q(`insert into profile_job_roles (user_id, job_role_id) values ($1, $2)`, [U.outsider, role]));
  await as(U.admin, () => q(`update departments set default_user_id = $1 where id = $2`, [U.outsider, designer]));
  await as(U.admin, () => q(`delete from department_members where department_id = $1 and user_id = $2`, [designer, U.outsider]));
  const r = await one(`select default_user_id from departments where id = $1`, [designer]);
  assert.equal(r.default_user_id, null);
  assert.equal((await one(`select count(*)::int n from profile_job_roles where user_id = $1`, [U.outsider])).n, 0);
});

await test('admin sets reporting managers and department defaults; members cannot', async () => {
  await as(U.admin, async () => {
    await q(`update profiles set reports_to = $1 where id = $2`, [U.mgr1, U.copy]);
    await q(`update profiles set reports_to = $1 where id = $2`, [U.mgr2, U.editor]);
    const editor = await dept('Editor');
    await q(`insert into department_members (department_id, user_id) values ($1, $2)`, [editor, U.editor]);
    await q(`update departments set default_user_id = $1 where id = $2`, [U.editor, editor]);
    for (const name of ['Account Manager', 'Strategist', 'Tech', 'Ads Manager', 'Designer', 'Video Team']) {
      const id = await dept(name);
      await q(`insert into department_members (department_id, user_id) values ($1, $2)`, [id, U.am]);
      await q(`update departments set default_user_id = $1 where id = $2`, [U.am, id]);
    }
  });
  const n = await as(U.copy, () => q(`update profiles set role = 'admin' where id = $1 returning id`, [U.copy]));
  assert.equal(n.length, 0);
  const r = await one(`select role from profiles where id = $1`, [U.copy]);
  assert.equal(r.role, 'member');
});

let clientA;
let tplId;
await test('create_client_from_template: 9 stages, 24 tasks, working-day dates, assignees', async () => {
  tplId = (await one(`select id from templates where name = 'Digital Sales Engine'`)).id;
  const today = (await one(`select next_working_day(ist_today())::text as d`)).d;
  clientA = (
    await as(U.admin, () =>
      one(`select create_client_from_template('Bulls Edge', $1, $2::date, $3, 'Ravi', '99999', '99999', 'ravi@client.test', 'Gold') as id`,
        [tplId, today, U.mgr1])
    )
  ).id;
  const c = await one(`select c.*, (select count(*)::int from client_stages where client_id = c.id) as stages,
      (select count(*)::int from tasks where client_id = c.id) as tasks,
      (select count(*)::int from tasks where client_id = c.id and assignee_id is null) as unassigned
    from clients c where id = $1`, [clientA]);
  assert.equal(c.stages, 9);
  assert.equal(c.tasks, 24);
  assert.equal(c.unassigned, 0);
  assert.equal(c.template_version, 1);
  assert.equal(c.service, 'Digital Sales Engine');
  const expectLaunch = (await one(`select add_working_days($1::date, 14)::text as d`, [today])).d;
  assert.equal(c.launch_date.toISOString().slice(0, 10), expectLaunch);
  assert.equal(c.original_launch_date.toISOString().slice(0, 10), expectLaunch);

  const stages = await q(`select position, start_date::text s, due_date::text d from client_stages
    where client_id = $1 order by position`, [clientA]);
  const expected = await q(`select
      add_working_days($1::date, x.s)::text s, add_working_days($1::date, x.e)::text d
    from (values (0,0),(1,2),(3,4),(5,6),(7,8),(9,11),(12,13),(14,14),(15,30)) as x(s,e)`, [today]);
  assert.deepEqual(stages.map((r) => [r.s, r.d]), expected.map((r) => [r.s, r.d]));

  const t23 = await one(`select due_date::text d, series_id, occurrence from tasks where client_id = $1 and task_no = 23`, [clientA]);
  assert.equal(t23.d, (await one(`select add_working_days($1::date, 21)::text d`, [today])).d);
  assert.ok(t23.series_id);
  const checklist = await one(`select count(*)::int n from task_checklist_items ci join tasks t on t.id = ci.task_id
    where t.client_id = $1 and t.task_no = 10`, [clientA]);
  assert.equal(checklist.n, 4);
});

await test('assignees get one grouped notification; manager notified', async () => {
  const rows = await q(`select user_id, type, payload from notifications where payload->>'client_id' = $1`, [clientA]);
  const copy = rows.filter((r) => r.user_id === U.copy);
  assert.equal(copy.length, 1);
  assert.equal(copy[0].payload.count, 3);
  assert.ok(rows.some((r) => r.user_id === U.mgr1 && r.type === 'client_assigned'));
});

await test('preview_client_schedule matches the created launch date', async () => {
  const today = (await one(`select next_working_day(ist_today())::text as d`)).d;
  const r = await as(U.mgr1, () =>
    one(`select due_date::text d from preview_client_schedule($1, $2::date) where stage_position = 8`, [tplId, today]));
  assert.equal(r.d, (await one(`select launch_date::text d from clients where id = $1`, [clientA])).d);
});

await test('RLS: a member without tasks cannot see the client, its stages, tasks or thread', async () => {
  await as(U.mgr1, () => q(`insert into comments (client_id, body) values ($1, 'Kickoff notes')`, [clientA]));
  const r = await as(U.outsider, async () => ({
    clients: (await q(`select id from clients`)).length,
    stages: (await q(`select id from client_stages`)).length,
    tasks: (await q(`select id from tasks`)).length,
    comments: (await q(`select id from comments`)).length,
    board: (await q(`select stage_id from board_cells`)).length,
    activity: (await q(`select id from activity_log`)).length,
  }));
  assert.deepEqual(r, { clients: 0, stages: 0, tasks: 0, comments: 0, board: 0, activity: 0 });
});

await test('anon (signed out) has no table access at all', async () => {
  await db.exec(`set role anon`);
  try {
    for (const table of ['clients', 'profiles', 'tasks', 'board_cells']) {
      await rejects(q(`select 1 from ${table} limit 1`), /permission denied/);
    }
  } finally {
    await db.exec(`reset role`);
  }
});

await test('accounts not created by the admin start inactive and can read nothing', async () => {
  const p = await one(`select role, is_active from profiles where id = $1`, [U.sneaky]);
  assert.deepEqual(p, { role: 'member', is_active: false });
  const r = await as(U.sneaky, async () => ({
    profiles: (await q(`select id from profiles`)).length,
    departments: (await q(`select id from departments`)).length,
  }));
  assert.deepEqual(r, { profiles: 1, departments: 0 }, 'only their own profile row (so login can say "not active")');
  const own = await as(U.sneaky, () => q(`select id, is_active from profiles`));
  assert.deepEqual(own, [{ id: U.sneaky, is_active: false }]);
  const admin = await one(`select is_active from profiles where id = $1`, [U.admin]);
  assert.equal(admin.is_active, true, 'admin-created accounts (app_metadata.role set) are active');
});

await test('RLS: an assigned member sees the client and thread', async () => {
  const r = await as(U.copy, async () => ({
    clients: (await q(`select id from clients`)).length,
    comments: (await q(`select id from comments`)).length,
  }));
  assert.deepEqual(r, { clients: 1, comments: 1 });
});

await test('a blanket member update only touches their own tasks', async () => {
  const rows = await as(U.copy, () =>
    q(`update tasks set description = 'Copy notes' where client_id = $1 returning assignee_id`, [clientA]));
  const own = (await one(`select count(*)::int n from tasks where client_id = $1 and assignee_id = $2`, [clientA, U.copy])).n;
  assert.equal(rows.length, own);
  assert.ok(rows.every((r) => r.assignee_id === U.copy));
});

await test('managers cannot change status columns directly (RPC only)', async () => {
  await rejects(
    as(U.mgr1, () => q(`update tasks set status = 'done' where client_id = $1 and task_no = 1`, [clientA])),
    /task actions/
  );
});

let lp; // Landing Page (copy), a review task for the copywriter
await test('review flow: member cannot mark a review task Done', async () => {
  lp = (await one(`select id from tasks where client_id = $1 and task_no = 6`, [clientA])).id;
  await rejects(as(U.copy, () => q(`select set_task_status($1, 'done')`, [lp])), /needs manager approval/);
});

await test('review flow: Send for Review needs a link or file', async () => {
  await rejects(as(U.copy, () => q(`select set_task_status($1, 'in_review')`, [lp])), /Attach a link/);
  const t = await as(U.copy, () => one(`select * from set_task_status($1, 'in_review', null, 'https://docs.test/lp')`, [lp]));
  assert.equal(t.status, 'in_review');
  assert.equal(t.review_rounds, 1);
  const n = await q(`select user_id from notifications where type = 'review_requested' and payload->>'task_id' = $1`, [lp]);
  assert.deepEqual(n.map((r) => r.user_id).sort(), [U.mgr1]);
});

await test('review flow: another member cannot touch the task', async () => {
  await rejects(as(U.editor, () => q(`select set_task_status($1, 'in_progress')`, [lp])), /own tasks/);
});

await test('review flow: unrelated manager cannot approve', async () => {
  await rejects(as(U.mgr2, () => q(`select approve_task($1)`, [lp])), /Only a manager or admin/);
});

await test('review flow: request changes -> In Progress with comment, resubmit, approve', async () => {
  const t1 = await as(U.mgr1, () => one(`select * from request_task_changes($1, 'Tighten the headline')`, [lp]));
  assert.equal(t1.status, 'in_progress');
  const c = await one(`select body from comments where task_id = $1 order by created_at desc limit 1`, [lp]);
  assert.equal(c.body, 'Tighten the headline');
  assert.ok(await one(`select 1 from notifications where type = 'changes_requested' and user_id = $1`, [U.copy]));
  await as(U.copy, () => q(`select set_task_status($1, 'in_review')`, [lp]));
  const t2 = await as(U.mgr1, () => one(`select * from approve_task($1)`, [lp]));
  assert.equal(t2.status, 'done');
  assert.equal(t2.review_rounds, 2);
  assert.ok(t2.completed_at);
  await rejects(as(U.copy, () => q(`select set_task_status($1, 'in_progress')`, [lp])), /Only a manager can reopen/);
});

await test('reporting manager can approve their member\'s review task on another manager\'s client', async () => {
  const vsl = (await one(`select id from tasks where client_id = $1 and task_no = 15`, [clientA])).id; // editor -> reports to mgr2
  await as(U.editor, () => q(`select set_task_status($1, 'in_review', null, 'https://drive.test/vsl')`, [vsl]));
  const reviewers = await q(`select user_id from notifications where type = 'review_requested' and payload->>'task_id' = $1`, [vsl]);
  assert.deepEqual(reviewers.map((r) => r.user_id).sort(), [U.mgr1, U.mgr2].sort());
  const t = await as(U.mgr2, () => one(`select (approve_task($1)).status`, [vsl]));
  assert.equal(t.status, 'done');
});

await test('stage auto-completes on blocking tasks only; access requests show as pending', async () => {
  const ids = await q(`select id from tasks where client_id = $1 and task_no in (1, 2)`, [clientA]);
  for (const { id } of ids) await as(U.am, () => q(`select set_task_status($1, 'done')`, [id]));
  const s = await one(`select status from client_stages where client_id = $1 and position = 1`, [clientA]);
  assert.equal(s.status, 'done');
  const cell = await as(U.mgr1, () => one(`select pending_nonblocking_count from board_cells where client_id = $1 and position = 1`, [clientA]));
  assert.equal(cell.pending_nonblocking_count, 4);
  const c = await one(`select lifecycle, delay_days from clients where id = $1`, [clientA]);
  assert.deepEqual(c, { lifecycle: 'active', delay_days: 0 });
});

await test('waiting on client: only client-dependent tasks; pauses clock and extends due date', async () => {
  const offer = (await one(`select id from tasks where client_id = $1 and task_no = 5`, [clientA])).id;
  await rejects(as(U.am, () => q(`select set_task_status($1, 'waiting_on_client')`, [offer])), /client-dependent/);
  const photos = await one(`select id, due_date::text d from tasks where client_id = $1 and task_no = 13`, [clientA]);
  await as(U.am, () => q(`select set_task_status($1, 'waiting_on_client')`, [photos.id]));
  // Pretend the wait started 3 working days ago.
  const since = (await one(`select add_working_days(ist_today(), -3)::text d`)).d;
  await q(`update tasks set waiting_since = ($2::date + time '10:00') at time zone 'Asia/Kolkata' where id = $1`, [photos.id, since]);
  const t = await as(U.am, () => one(`select * from set_task_status($1, 'in_progress')`, [photos.id]));
  assert.equal(t.client_wait_days, 3);
  assert.equal(t.waiting_since, null);
  assert.equal(t.due_date.toISOString().slice(0, 10), (await one(`select add_working_days($1::date, 3)::text d`, [photos.d])).d);
});

let clientB;
await test('late stage shifts later stages; original launch date kept; no double shift on reopen', async () => {
  const past = (await one(`select add_working_days(next_working_day(ist_today()), -5)::text d`)).d;
  clientB = (await as(U.admin, () => one(`select create_client_from_template('IICSEH', $1, $2::date, $3) as id`, [tplId, past, U.mgr1]))).id;
  const before = await one(`select launch_date::text l, original_launch_date::text o from clients where id = $1`, [clientB]);
  const ids = await q(`select id from tasks where client_id = $1 and task_no in (1, 2)`, [clientB]);
  for (const { id } of ids) await as(U.am, () => q(`select set_task_status($1, 'done')`, [id]));
  const delay = (await one(`select working_days_between($1::date, ist_today()) n`, [past])).n;
  assert.ok(delay >= 4, `expected a delay, got ${delay}`);
  const after = await one(`select launch_date::text l, original_launch_date::text o, delay_days from clients where id = $1`, [clientB]);
  assert.equal(after.o, before.o);
  assert.equal(after.l, (await one(`select add_working_days($1::date, $2)::text d`, [before.l, delay])).d);
  assert.equal(after.delay_days, delay);
  const st2 = await one(`select due_date::text d, original_due_date::text o from client_stages where client_id = $1 and position = 2`, [clientB]);
  assert.equal(st2.d, (await one(`select add_working_days($1::date, $2)::text d`, [st2.o, delay])).d);
  const accessReq = await one(`select due_date::text d, original_due_date::text o from tasks where client_id = $1 and task_no = 12`, [clientB]);
  assert.equal(accessReq.d, accessReq.o, 'non-blocking stage-1 tasks are not shifted');

  // Reopen and finish again: no second shift.
  const t1 = ids[0].id;
  await as(U.mgr1, () => q(`select set_task_status($1, 'in_progress')`, [t1]));
  await as(U.am, () => q(`select set_task_status($1, 'done')`, [t1]));
  const again = await one(`select launch_date::text l from clients where id = $1`, [clientB]);
  assert.equal(again.l, after.l);
  assert.ok(await one(`select 1 from notifications where type = 'schedule_shifted' and user_id = $1`, [U.mgr1]));
});

await test('editing a template bumps its version and never changes existing clients', async () => {
  await as(U.admin, () => q(`update template_tasks set title = 'Offer Creation v2' where task_no = 5
    and template_stage_id in (select id from template_stages where template_id = $1)`, [tplId]));
  const t = await one(`select version from templates where id = $1`, [tplId]);
  assert.equal(t.version, 2);
  const c = await one(`select template_version, (select title from tasks where client_id = $1 and task_no = 5) as title
    from clients where id = $1`, [clientA]);
  assert.deepEqual(c, { template_version: 1, title: 'Offer Creation' });
  await rejects(as(U.mgr1, async () => {
    const r = await q(`update template_tasks set title = 'x' where task_no = 5 returning id`);
    if (r.length === 0) throw new Error('blocked');
  }), /blocked/);
});

await test('custom tasks: client manager can add; other managers cannot', async () => {
  const st4 = (await one(`select id from client_stages where client_id = $1 and position = 4`, [clientA])).id;
  const t = await as(U.mgr1, () => one(`select * from create_custom_task('Extra FAQ section', $1, $2, null, $3, ist_today() + 3)`, [clientA, st4, U.copy]));
  assert.equal(t.is_custom, true);
  await rejects(as(U.mgr2, () => q(`select create_custom_task('Nope', $1, $2)`, [clientA, st4])), /manager or an admin/);
  assert.ok(await one(`select 1 from notifications where type = 'task_assigned' and payload->>'task_id' = $1`, [t.id]));
});

let editorDept;
await test('department (team) tasks: visible to department members only; any member can complete an unassigned one', async () => {
  editorDept = await dept('Editor');
  const t = await as(U.mgr2, () => one(`select * from create_custom_task('Prepare monthly creative bank', null, null, $1)`, [editorDept]));
  assert.equal((await as(U.editor, () => q(`select id from tasks where id = $1`, [t.id]))).length, 1);
  assert.equal((await as(U.outsider, () => q(`select id from tasks where id = $1`, [t.id]))).length, 0);
  assert.equal((await as(U.am, () => q(`select id from tasks where id = $1`, [t.id]))).length, 0);
  const done = await as(U.editor, () => one(`select (set_task_status($1, 'done')).status`, [t.id]));
  assert.equal(done.status, 'done');
});

await test('departments with team tasks cannot be deleted', async () => {
  await rejects(as(U.admin, () => q(`delete from departments where id = $1`, [editorDept])), /still has team tasks/);
});

await test('client task members are tagged with their template department', async () => {
  const r = await one(`select d.name from tasks t join departments d on d.id = t.department_id
    where t.client_id = $1 and t.task_no = 15`, [clientA]);
  assert.equal(r.name, 'Editor');
});

const memberEdits = (taskId) =>
  q(`select user_id, body from notifications where type = 'member_edit' and payload->>'task_id' = $1 order by user_id`, [taskId]);

await test('member edits: details of own task allowed and notify admins, client manager and reporting manager', async () => {
  const vsl = (await one(`select id from tasks where client_id = $1 and task_no = 16`, [clientA])).id; // editor, reports to mgr2
  const rows = await as(U.editor, () =>
    q(`update tasks set title = 'Ads Editing (5 cuts)', description = 'Reels + stories', submission_url = 'https://drive.test/ads'
       where id = $1 returning id`, [vsl]));
  assert.equal(rows.length, 1);
  const n = await memberEdits(vsl);
  assert.deepEqual(n.map((r) => r.user_id).sort(), [U.admin, U.mgr1, U.mgr2].sort());
  assert.match(n[0].body, /changed title, description, link/);
});

await test('member edits: due date, assignee and flags are refused on own task', async () => {
  const vsl = (await one(`select id from tasks where client_id = $1 and task_no = 16`, [clientA])).id;
  await rejects(as(U.editor, () => q(`update tasks set due_date = due_date + 3 where id = $1`, [vsl])), /title, description and link/);
  await rejects(as(U.editor, () => q(`update tasks set assignee_id = $2 where id = $1`, [vsl, U.copy])), /title, description and link/);
  await rejects(as(U.editor, () => q(`update tasks set needs_review = false where id = $1`, [vsl])), /title, description and link/);
});

await test('member edits: other people\'s tasks on the same client are read-only', async () => {
  const offer = (await one(`select id from tasks where client_id = $1 and task_no = 5`, [clientA])).id; // assigned to am
  const visible = await as(U.editor, () => q(`select id from tasks where id = $1`, [offer]));
  assert.equal(visible.length, 1, 'members can read every task on their client');
  const rows = await as(U.editor, () => q(`update tasks set title = 'hijack' where id = $1 returning id`, [offer]));
  assert.equal(rows.length, 0);
});

await test('member edits: checklist add/rename/remove notify; ticking does not', async () => {
  const lpForms = (await one(`select id from tasks where client_id = $1 and task_no = 10`, [clientA])).id; // am
  const before = (await memberEdits(lpForms)).length;
  const item = (await as(U.am, () => one(`insert into task_checklist_items (task_id, label) values ($1, 'Pixel installed') returning id`, [lpForms]))).id;
  const afterAdd = (await memberEdits(lpForms)).length;
  assert.ok(afterAdd > before);
  await as(U.am, () => q(`update task_checklist_items set is_done = true where id = $1`, [item]));
  assert.equal((await memberEdits(lpForms)).length, afterAdd, 'ticks are progress, not edits');
  await as(U.am, () => q(`delete from task_checklist_items where id = $1`, [item]));
  assert.ok((await memberEdits(lpForms)).length > afterAdd);
});

await test('member edits: workflow actions and manager edits do not count as member edits', async () => {
  const still = (await one(`select id from tasks where client_id = $1 and task_no = 17`, [clientA])).id; // designer -> am
  await as(U.am, () => q(`select set_task_status($1, 'in_review', null, 'https://drive.test/stills')`, [still]));
  await as(U.mgr1, () => q(`update tasks set title = 'Still Graphics (6)' where id = $1`, [still]));
  assert.equal((await memberEdits(still)).length, 0);
});

await test('checklist: assignee can tick; others cannot', async () => {
  const item = (await one(`select ci.id from task_checklist_items ci join tasks t on t.id = ci.task_id
    where t.client_id = $1 and t.task_no = 10 limit 1`, [clientA])).id;
  const ok = await as(U.am, () => q(`update task_checklist_items set is_done = true where id = $1 returning done_by`, [item]));
  assert.equal(ok[0].done_by, U.am);
  const no = await as(U.copy, () => q(`update task_checklist_items set is_done = false where id = $1 returning id`, [item]));
  assert.equal(no.length, 0);
});

await test('mentions notify the mentioned user', async () => {
  await as(U.mgr1, () => q(`insert into comments (task_id, client_id, body, mentions) values ($1, $2, 'Looks good @Chirag', $3)`,
    [lp, clientA, [U.copy]]));
  assert.ok(await one(`select 1 from notifications where type = 'mention' and user_id = $1`, [U.copy]));
});

await test('vault: client manager saves and reveals (logged); others cannot', async () => {
  const cred = (await as(U.mgr1, () => one(`select save_client_credential($1, 'Meta', 'ravi@fb', 's3cret!') as id`, [clientA]))).id;
  const r = await as(U.mgr1, () => one(`select reveal_client_credential($1) as s`, [cred]));
  assert.equal(r.s, 's3cret!');
  assert.equal((await one(`select count(*)::int n from credential_reveals where credential_id = $1`, [cred])).n, 1);
  await rejects(as(U.mgr2, () => q(`select reveal_client_credential($1)`, [cred])), /Not allowed/);
  assert.equal((await as(U.copy, () => q(`select id from client_credentials`))).length, 0);
  const meta = await as(U.mgr1, () => one(`select * from client_credentials where id = $1`, [cred]));
  assert.ok(!JSON.stringify(meta).includes('s3cret!'));
});

await test('recurring tasks: next occurrence created once the current one is due, no duplicates', async () => {
  const past = (await one(`select add_working_days(next_working_day(ist_today()), -40)::text d`)).d;
  const c = (await as(U.admin, () => one(`select create_client_from_template('GURRPIT', $1, $2::date, $3) as id`, [tplId, past, U.mgr1]))).id;
  await q(`select private.generate_recurring_tasks()`);
  await q(`select private.generate_recurring_tasks()`);
  const weekly = await q(`select occurrence, due_date::text d from tasks where client_id = $1 and task_no = 23 order by occurrence`, [c]);
  assert.equal(weekly.length, 2);
  assert.ok(weekly[1].d >= (await one(`select ist_today()::text d`)).d);
  const monthly = await q(`select occurrence from tasks where client_id = $1 and task_no = 24 order by occurrence`, [c]);
  assert.equal(monthly.length, 2);
});

await test('scheduled notification jobs run', async () => {
  const n1 = await one(`select private.generate_due_notifications() n`);
  const n2 = await one(`select private.generate_manager_overdue_summary() n`);
  assert.ok(n1.n > 0 && n2.n > 0);
  const again = await one(`select private.generate_due_notifications() n`);
  assert.ok(again.n < n1.n, 'overdue notices are sent once per task');
  await q(`select private.refresh_stage_statuses()`);
  await q(`select private.invoke_edge_function('daily-digest')`);
});

await test('internal functions are not callable by users', async () => {
  await rejects(as(U.admin, () => q(`select private.generate_recurring_tasks()`)), /permission denied/);
  await rejects(as(U.admin, () => q(`select private.shift_client_schedule($1, 1, 5)`, [clientA])), /permission denied/);
});

await test('notifications: users see and mark only their own', async () => {
  const mine = await as(U.copy, () => q(`select user_id from notifications`));
  assert.ok(mine.length > 0 && mine.every((r) => r.user_id === U.copy));
  const n = await as(U.copy, () => one(`select mark_notifications_read() n`));
  assert.ok(n.n > 0);
});

await test('activity log records changes with the actor', async () => {
  const r = await one(`select count(*)::int n from activity_log where client_id = $1 and entity = 'tasks' and actor_id = $2`, [clientA, U.copy]);
  assert.ok(r.n > 0);
});

await test('guard: the last active admin cannot be demoted', async () => {
  await rejects(as(U.admin, () => q(`update profiles set role = 'manager' where id = $1`, [U.admin])), /active admin/);
});

await test('admin can delete a client (cascade works)', async () => {
  await as(U.admin, () => q(`delete from clients where id = $1`, [clientB]));
  assert.equal((await one(`select count(*)::int n from tasks where client_id = $1`, [clientB])).n, 0);
});

await test('performance: creating a client takes well under 2 seconds', async () => {
  const t0 = performance.now();
  await as(U.admin, () => q(`select create_client_from_template('Speed Test', $1, ist_today(), $2)`, [tplId, U.mgr1]));
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});

await test('import_client: done stages marked done without shifting; sheet dates applied; admin only', async () => {
  const past = (await one(`select add_working_days(next_working_day(ist_today()), -10)::text d`)).d;
  const planned = (await one(`select add_working_days(ist_today(), 3)::text d`)).d;
  await rejects(as(U.mgr1, () => q(`select import_client('Poonam', $1, $2::date)`, [tplId, past])), /Only admins/);
  const id = (await as(U.admin, () =>
    one(`select import_client('Poonam', $1, $2::date, $3, '{1,2,3}', $4::jsonb) as id`,
      [tplId, past, U.mgr1, JSON.stringify({ 5: planned })]))).id;
  const st = await q(`select position, status from client_stages where client_id = $1 order by position`, [id]);
  assert.deepEqual(st.slice(0, 3).map((s) => s.status), ['done', 'done', 'done']);
  const c = await one(`select delay_days, lifecycle, launch_date::text l, original_launch_date::text o from clients where id = $1`, [id]);
  assert.equal(c.delay_days, 0);
  assert.equal(c.lifecycle, 'active');
  assert.equal(c.l, c.o);
  const s5 = await one(`select due_date::text d from client_stages where client_id = $1 and position = 5`, [id]);
  assert.equal(s5.d, planned);
  await rejects(as(U.admin, () => q(`select import_client('poonam', $1, $2::date)`, [tplId, past])), /already exists/);
});

await test('get_reports: managers get every section; members are refused', async () => {
  const r = (await as(U.mgr1, () => one(`select get_reports() r`))).r;
  for (const k of ['clients', 'launches', 'stages', 'workload', 'waiting']) assert.ok(k in r, k);
  assert.ok(r.clients.active > 0);
  assert.equal(r.stages.length, 8);
  assert.ok(r.workload.some((w) => w.id === U.am && w.open > 0));
  assert.ok(r.waiting.some((w) => w.days >= 3), 'closed waits are counted');
  await rejects(as(U.copy, () => q(`select get_reports()`)), /managers and admins/);
});

await test('priority: defaults to normal; managers set it; members cannot change it', async () => {
  const r = await one(`select count(*)::int n from tasks where priority <> 'normal'`);
  assert.equal(r.n, 0, 'existing tasks are normal');
  const t = await as(U.mgr1, () =>
    one(`select * from create_custom_task('Urgent fix', $1, null, null, $2, ist_today() + 1, null, false, false, true, '{}', 'urgent')`,
      [clientA, U.copy]));
  assert.equal(t.priority, 'urgent');
  const old = await as(U.mgr1, () => one(`select * from create_custom_task('Old-style call', $1)`, [clientA]));
  assert.equal(old.priority, 'normal', 'callers that do not send p_priority still work');
  await rejects(as(U.copy, () => q(`update tasks set priority = 'low' where id = $1`, [t.id])), /title, description and link/);
  await as(U.mgr1, () => q(`update tasks set priority = 'high' where id = $1`, [t.id]));
  assert.equal((await one(`select priority from tasks where id = $1`, [t.id])).priority, 'high');
});

await test('chat: every department has its channel, including new ones', async () => {
  const r = await one(`select count(*)::int n from departments d
    where not exists (select 1 from chat_conversations c where c.department_id = d.id and c.kind = 'department')`);
  assert.equal(r.n, 0);
  const id = (await as(U.admin, () => one(`insert into departments (name, position) values ('Chat Test Dept', 99) returning id`))).id;
  assert.ok(await one(`select 1 from chat_conversations where department_id = $1`, [id]));
  await as(U.admin, () => q(`delete from departments where id = $1`, [id]));
  assert.equal((await q(`select 1 from chat_conversations where department_id = $1`, [id])).length, 0);
});

let dm;
await test('chat: direct messages are private to the two people and de-duplicated', async () => {
  dm = (await as(U.copy, () => one(`select start_direct_chat($1) id`, [U.editor]))).id;
  const again = (await as(U.editor, () => one(`select start_direct_chat($1) id`, [U.copy]))).id;
  assert.equal(again, dm);
  await rejects(as(U.copy, () => q(`select start_direct_chat($1)`, [U.copy])), /someone else/);
  await as(U.copy, () => q(`insert into chat_messages (conversation_id, body) values ($1, 'Hi Rahul')`, [dm]));
  assert.equal((await as(U.editor, () => q(`select id from chat_messages where conversation_id = $1`, [dm]))).length, 1);
  for (const uid of [U.outsider, U.admin, U.mgr1]) {
    assert.equal((await as(uid, () => q(`select id from chat_messages where conversation_id = $1`, [dm]))).length, 0);
    assert.equal((await as(uid, () => q(`select id from chat_conversations where id = $1`, [dm]))).length, 0);
  }
  await rejects(as(U.outsider, () => q(`insert into chat_messages (conversation_id, body) values ($1, 'sneak')`, [dm])), /row-level security/);
  await rejects(as(U.copy, () => q(`insert into chat_messages (conversation_id, author_id, body) values ($1, $2, 'forged')`, [dm, U.editor])), /row-level security/);
});

await test('chat: unread counts, mark read, edit own text only, delete own only', async () => {
  const inbox = await as(U.editor, () => one(`select * from chat_inbox() where id = $1`, [dm]));
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.other_user_id, U.copy);
  assert.equal(inbox.last_body, 'Hi Rahul');
  assert.equal((await as(U.copy, () => one(`select unread from chat_inbox() where id = $1`, [dm]))).unread, 0, 'own messages are read');
  await as(U.editor, () => q(`select mark_chat_read($1)`, [dm]));
  assert.equal((await as(U.editor, () => one(`select unread from chat_inbox() where id = $1`, [dm]))).unread, 0);

  const msg = (await one(`select id from chat_messages where conversation_id = $1`, [dm])).id;
  const edited = await as(U.copy, () => one(`update chat_messages set body = 'Hi Rahul!' where id = $1 returning edited_at`, [msg]));
  assert.ok(edited.edited_at);
  await rejects(as(U.copy, () => q(`update chat_messages set created_at = now() - interval '1 day' where id = $1`, [msg])), /Only the text/);
  assert.equal((await as(U.editor, () => q(`update chat_messages set body = 'x' where id = $1 returning id`, [msg]))).length, 0);
  assert.equal((await as(U.editor, () => q(`delete from chat_messages where id = $1 returning id`, [msg]))).length, 0);
  assert.equal((await as(U.copy, () => q(`delete from chat_messages where id = $1 returning id`, [msg]))).length, 1);
});

await test('chat: department channel open to its members, managers and admins only', async () => {
  const ch = (await one(`select id from chat_conversations where department_id = $1`, [editorDept])).id;
  await as(U.editor, () => q(`insert into chat_messages (conversation_id, body) values ($1, 'Edits are up')`, [ch]));
  for (const uid of [U.editor, U.mgr2, U.admin]) {
    assert.equal((await as(uid, () => q(`select id from chat_messages where conversation_id = $1`, [ch]))).length, 1, uid);
  }
  assert.equal((await as(U.copy, () => q(`select id from chat_messages where conversation_id = $1`, [ch]))).length, 0);
  assert.equal((await as(U.copy, () => q(`select id from chat_inbox() where id = $1`, [ch]))).length, 0);
  await rejects(as(U.copy, () => q(`insert into chat_messages (conversation_id, body) values ($1, 'hi')`, [ch])), /row-level security/);
});

await test('chat: groups are managed by their creator; others can only leave', async () => {
  const g = (await as(U.mgr1, () => one(`select create_group_chat('Bulls Edge launch', $1) id`, [[U.copy, U.editor]]))).id;
  assert.equal((await as(U.outsider, () => q(`select id from chat_conversations where id = $1`, [g]))).length, 0);
  assert.equal((await as(U.copy, () => one(`select member_count from chat_inbox() where id = $1`, [g]))).member_count, 3);
  await rejects(as(U.copy, () => q(`select update_group_chat($1, 'Renamed')`, [g])), /creator or an admin/);
  await as(U.mgr1, () => q(`select update_group_chat($1, 'Bulls Edge war room', $2, $3)`, [g, [U.am], [U.editor]]));
  assert.equal((await as(U.editor, () => q(`select id from chat_conversations where id = $1`, [g]))).length, 0);
  assert.equal((await as(U.am, () => one(`select title from chat_inbox() where id = $1`, [g]))).title, 'Bulls Edge war room');
  await as(U.copy, () => q(`select leave_chat($1)`, [g]));
  assert.equal((await as(U.copy, () => q(`select id from chat_conversations where id = $1`, [g]))).length, 0);
  await rejects(as(U.editor, () => q(`select leave_chat($1)`, [dm])), /Only group chats/);
  await rejects(as(U.mgr1, () => q(`select create_group_chat('Solo', '{}')`)), /at least one other/);
});

await test('chat: @mentions notify only people who can open the conversation', async () => {
  await as(U.copy, () => q(`insert into chat_messages (conversation_id, body, mentions) values ($1, '@Rahul @Omar check', $2)`,
    [dm, [U.editor, U.outsider]]));
  assert.ok(await one(`select 1 from notifications where user_id = $1 and type = 'chat_mention' and link = $2`, [U.editor, `/chat/${dm}`]));
  assert.equal((await q(`select 1 from notifications where user_id = $1 and type = 'chat_mention'`, [U.outsider])).length, 0);
});

await test('chat: inactive accounts cannot use chat', async () => {
  await rejects(as(U.sneaky, () => q(`select start_direct_chat($1)`, [U.copy])), /not active/);
  assert.equal((await as(U.sneaky, () => q(`select id from chat_inbox()`))).length, 0);
});

let topMsg;
await test('chat v2: threads keep reply counts; replies must stay in the conversation', async () => {
  topMsg = (await as(U.copy, () => one(`insert into chat_messages (conversation_id, body) values ($1, 'Thread start') returning id`, [dm]))).id;
  const reply = (await as(U.editor, () =>
    one(`insert into chat_messages (conversation_id, body, parent_id) values ($1, 'A reply', $2) returning id`, [dm, topMsg]))).id;
  let p = await one(`select reply_count, last_reply_at from chat_messages where id = $1`, [topMsg]);
  assert.equal(p.reply_count, 1);
  assert.ok(p.last_reply_at);
  await rejects(as(U.editor, () => q(`insert into chat_messages (conversation_id, body, parent_id) values ($1, 'nested', $2)`, [dm, reply])),
    /same conversation/);
  const ch = (await one(`select id from chat_conversations where department_id = $1`, [editorDept])).id;
  await rejects(as(U.editor, () => q(`insert into chat_messages (conversation_id, body, parent_id) values ($1, 'cross', $2)`, [ch, topMsg])),
    /same conversation/);
  await as(U.editor, () => q(`delete from chat_messages where id = $1`, [reply]));
  p = await one(`select reply_count from chat_messages where id = $1`, [topMsg]);
  assert.equal(p.reply_count, 0);
  await rejects(as(U.copy, () => q(`update chat_messages set reply_count = 99 where id = $1`, [topMsg])), /Only the text/);
});

await test('chat v2: attachments must live in the conversation folder; file-only messages allowed', async () => {
  const ok = [{ path: `chat/${dm}/abc-photo.webp`, name: 'photo.webp', size: 1200, type: 'image/webp' }];
  await as(U.copy, () => q(`insert into chat_messages (conversation_id, body, attachments) values ($1, '', $2)`, [dm, JSON.stringify(ok)]));
  const other = [{ path: `client/${clientA}/thread/x.pdf`, name: 'x.pdf' }];
  await rejects(as(U.copy, () => q(`insert into chat_messages (conversation_id, body, attachments) values ($1, 'see', $2)`, [dm, JSON.stringify(other)])),
    /Invalid attachment/);
  await rejects(as(U.copy, () => q(`insert into chat_messages (conversation_id, body) values ($1, '  ')`, [dm])), /chat_messages_content/);
  assert.equal((await as(U.editor, () => one(`select private.can_access_storage_path($1) ok`, [`chat/${dm}/abc-photo.webp`]))).ok, true);
  assert.equal((await as(U.outsider, () => one(`select private.can_access_storage_path($1) ok`, [`chat/${dm}/abc-photo.webp`]))).ok, false);
  assert.equal((await as(U.copy, () => one(`select private.can_access_storage_path($1) ok`, [`client/${clientA}/thread/a.pdf`]))).ok, true,
    'existing client paths unchanged');
});

await test('chat v2: search finds only messages the person can read', async () => {
  await as(U.copy, () => q(`insert into chat_messages (conversation_id, body) values ($1, 'The landing page headline is ready')`, [dm]));
  const mine = await as(U.editor, () => q(`select id from chat_messages where search @@ websearch_to_tsquery('simple', 'headline')`));
  assert.equal(mine.length, 1);
  const outsider = await as(U.outsider, () => q(`select id from chat_messages where search @@ websearch_to_tsquery('simple', 'headline')`));
  assert.equal(outsider.length, 0);
});

await test('chat v2: reactions follow conversation access; only your own can be removed', async () => {
  await as(U.editor, () => q(`insert into chat_reactions (message_id, emoji, conversation_id) values ($1, '👍', $2)`, [topMsg, dm]));
  const r = await one(`select conversation_id from chat_reactions where message_id = $1`, [topMsg]);
  assert.equal(r.conversation_id, dm);
  assert.equal((await as(U.copy, () => q(`select 1 from chat_reactions where message_id = $1`, [topMsg]))).length, 1);
  assert.equal((await as(U.outsider, () => q(`select 1 from chat_reactions where message_id = $1`, [topMsg]))).length, 0);
  await rejects(as(U.outsider, () => q(`insert into chat_reactions (message_id, emoji, conversation_id) values ($1, '👍', $2)`, [topMsg, dm])),
    /row-level security/);
  assert.equal((await as(U.copy, () => q(`delete from chat_reactions where message_id = $1 returning 1`, [topMsg]))).length, 0);
  assert.equal((await as(U.editor, () => q(`delete from chat_reactions where message_id = $1 returning 1`, [topMsg]))).length, 1);
});

await test('chat v2: presence and typing topics are limited to people who can open the chat', async () => {
  const typing = `pms-typing:${dm}`;
  assert.equal((await as(U.editor, () => one(`select private.can_use_realtime_topic('pms-online') ok`))).ok, true);
  assert.equal((await as(U.editor, () => one(`select private.can_use_realtime_topic($1) ok`, [typing]))).ok, true);
  assert.equal((await as(U.outsider, () => one(`select private.can_use_realtime_topic($1) ok`, [typing]))).ok, false);
  assert.equal((await as(U.outsider, () => one(`select private.can_use_realtime_topic('pms-typing:not-a-uuid') ok`))).ok, false);
  assert.equal((await as(U.sneaky, () => one(`select private.can_use_realtime_topic('pms-online') ok`))).ok, false);
  assert.ok(await one(`select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'`));
});

await test('chat v2: retention purges old chat, read notifications and empty groups; keeps recent', async () => {
  const old = (await as(U.copy, () => one(`insert into chat_messages (conversation_id, body) values ($1, 'ancient') returning id`, [dm]))).id;
  await q(`update chat_messages set created_at = now() - interval '7 months' where id = $1`, [old]);
  const keep = (await as(U.copy, () => one(`insert into chat_messages (conversation_id, body) values ($1, 'recent') returning id`, [dm]))).id;
  const g = (await as(U.mgr1, () => one(`select create_group_chat('Empty soon', $1) id`, [[U.copy]]))).id;
  await q(`delete from chat_participants where conversation_id = $1`, [g]);
  const r = (await one(`select private.purge_old_data() r`)).r;
  assert.ok(r.chat_messages >= 1);
  assert.equal(r.empty_groups, 1);
  assert.equal((await q(`select 1 from chat_messages where id = $1`, [old])).length, 0);
  assert.equal((await q(`select 1 from chat_messages where id = $1`, [keep])).length, 1);
  await rejects(as(U.admin, () => q(`select private.purge_old_data()`)), /permission denied/);
});

await test('chat v2: usage and file clean-up are admin-only; keep_alive is public and harmless', async () => {
  const u = (await as(U.admin, () => one(`select admin_usage() u`))).u;
  assert.ok(u.db_bytes > 0);
  assert.equal(u.retention.chat_months, 6);
  await rejects(as(U.mgr1, () => q(`select admin_usage()`)), /Only admins/);
  await rejects(as(U.copy, () => q(`select * from chat_files_to_purge()`)), /Only admins/);
  await q(`insert into storage.objects (bucket_id, name, owner, metadata, created_at)
           values ('files', $1, $2, '{"size": 5000}', now() - interval '2 days')`, [`chat/${dm}/orphan.pdf`, U.copy]);
  const files = await as(U.admin, () => q(`select * from chat_files_to_purge()`));
  assert.ok(files.some((f) => f.name === `chat/${dm}/orphan.pdf`));
  assert.ok(!files.some((f) => f.name === `chat/${dm}/abc-photo.webp`), 'files still used by a message are kept');
  await db.exec(`set role anon`);
  try {
    assert.match((await one(`select keep_alive() k`)).k, /^ok:/);
  } finally {
    await db.exec(`reset role`);
  }
});

await test('stage dates: client manager re-plans a stage; tasks follow; launch date and delay update', async () => {
  const st8 = await one(`select id, due_date::text d from client_stages where client_id = $1 and position = 8`, [clientA]);
  const before = await one(`select launch_date::text l, original_launch_date::text o from clients where id = $1`, [clientA]);
  const later = (await one(`select add_working_days($1::date, 3)::text d`, [st8.d])).d;
  await rejects(as(U.mgr2, () => q(`select set_stage_dates($1, $2::date, $3::date)`, [st8.id, st8.d, later])), /manager or an admin/);
  await rejects(as(U.mgr1, () => q(`select set_stage_dates($1, $2::date, $3::date)`, [st8.id, later, st8.d])), /cannot be before/);
  await as(U.mgr1, () => q(`select set_stage_dates($1, $2::date, $3::date)`, [st8.id, st8.d, later]));
  const c = await one(`select launch_date::text l, original_launch_date::text o, delay_days from clients where id = $1`, [clientA]);
  assert.equal(c.l, later);
  assert.equal(c.o, before.o, 'original launch date kept');
  assert.equal(c.delay_days, 3);
  const open = await q(`select due_date::text d from tasks where client_stage_id = $1 and status <> 'done' and not is_recurring`, [st8.id]);
  assert.ok(open.length > 0 && open.every((t) => t.d === later), 'open tasks follow the new deadline');
  await rejects(as(U.copy, () => q(`select set_stage_dates($1, $2::date, $3::date)`, [st8.id, st8.d, later])), /manager or an admin/);
});

await test('SQL Editor bundle is up to date with the migrations', async () => {
  const onDisk = readFileSync(join(setupDir, bundleFileName()), 'utf8');
  assert.equal(onDisk, buildBundle().sql, 'supabase/setup/full_setup.sql is stale: run npm run sql:bundle');
});

await test('SQL Editor bundle applies cleanly to a fresh project and refuses to run twice', async () => {
  const fresh = new PGlite();
  await fresh.exec(readFileSync(join(root, 'supabase', 'tests', 'stubs.sql'), 'utf8'));
  // Platform extensions are stubbed in PGlite.
  const sql = buildBundle().sql.replace(/^create extension .*$/gm, '');
  await fresh.exec(sql);
  const applied = (await fresh.query(`select count(*)::int n from private.applied_migrations`)).rows[0].n;
  assert.equal(applied, buildBundle().files.length);
  const tasks = (await fresh.query(`select count(*)::int n from template_tasks`)).rows[0].n;
  assert.equal(tasks, 48);
  await rejects(fresh.exec(sql), /already applied/);
  // The SQL Editor ends a failed run's transaction; do the same here.
  await fresh.exec('rollback');
  // The failed second run rolled back completely.
  const after = (await fresh.query(`select count(*)::int n from template_tasks`)).rows[0].n;
  assert.equal(after, 48);
  await fresh.close();
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
