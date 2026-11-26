// Admin-only user management. Accounts are created here (no public signup, no invite emails).
// Actions: create | update | reset_password | set_active
// The caller's JWT must belong to an active admin. Uses the service role server-side only.
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'manager', 'member'] as const;
type Role = (typeof ROLES)[number];

interface UserFields {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string | null;
  role?: Role;
  reports_to?: string | null;
  // Departments the person belongs to, and job roles they hold (each job role also makes
  // them a member of its department).
  department_ids?: string[];
  job_role_ids?: string[];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(fields: UserFields, creating: boolean): string | null {
  if (creating || fields.email !== undefined) {
    if (!fields.email || !EMAIL_RE.test(fields.email)) return 'Enter a valid email';
  }
  if (creating || fields.password !== undefined) {
    if (!fields.password || fields.password.length < 8) return 'Password must be at least 8 characters';
  }
  if (creating && !fields.full_name?.trim()) return 'Name is required';
  if (fields.role !== undefined && !ROLES.includes(fields.role)) return 'Invalid role';
  if (fields.reports_to && !UUID_RE.test(fields.reports_to)) return 'Invalid reporting manager';
  const isUuidList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && UUID_RE.test(x));
  if (fields.department_ids !== undefined && !isUuidList(fields.department_ids)) return 'Invalid departments';
  if (fields.job_role_ids !== undefined && !isUuidList(fields.job_role_ids)) return 'Invalid job roles';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling?
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller?.user) return fail('Not signed in', 401);
  const { data: me } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', caller.user.id)
    .single();
  if (!me || me.role !== 'admin' || !me.is_active) return fail('Only admins can manage users', 403);

  let body: { action?: string; user_id?: string; active?: boolean } & UserFields;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON');
  }

  // Reporting manager must be an active manager/admin.
  async function checkManager(id: string | null | undefined) {
    if (!id) return null;
    const { data } = await admin.from('profiles').select('role, is_active').eq('id', id).single();
    if (!data || !data.is_active || !['admin', 'manager'].includes(data.role)) {
      return 'Reporting manager must be an active manager or admin';
    }
    return null;
  }

  // Applies department and job-role membership as a diff. Removing someone from a department
  // clears them as its default person, so unchanged memberships must not be re-created.
  async function setMemberships(userId: string, departmentIds?: string[], jobRoleIds?: string[]) {
    if (departmentIds === undefined && jobRoleIds === undefined) return null;

    let wantedDepartments = departmentIds;
    if (jobRoleIds !== undefined && jobRoleIds.length > 0) {
      const { data: roles, error } = await admin.from('job_roles').select('id, department_id').in('id', jobRoleIds);
      if (error) return error.message;
      if ((roles ?? []).length !== new Set(jobRoleIds).size) return 'Unknown job role';
      // A job role's department is always kept.
      if (wantedDepartments !== undefined) {
        wantedDepartments = [...new Set([...wantedDepartments, ...roles!.map((r) => r.department_id)])];
      }
    }

    if (wantedDepartments !== undefined) {
      const { data: current, error } = await admin
        .from('department_members')
        .select('department_id')
        .eq('user_id', userId);
      if (error) return error.message;
      const have = (current ?? []).map((r) => r.department_id);
      const remove = have.filter((d) => !wantedDepartments!.includes(d));
      const add = wantedDepartments.filter((d) => !have.includes(d));
      if (remove.length) {
        const { error: e } = await admin
          .from('department_members')
          .delete()
          .eq('user_id', userId)
          .in('department_id', remove);
        if (e) return e.message;
      }
      if (add.length) {
        const { error: e } = await admin
          .from('department_members')
          .insert(add.map((department_id) => ({ department_id, user_id: userId })));
        if (e) return e.message;
      }
    }

    if (jobRoleIds !== undefined) {
      const { data: current, error } = await admin
        .from('profile_job_roles')
        .select('job_role_id')
        .eq('user_id', userId);
      if (error) return error.message;
      const have = (current ?? []).map((r) => r.job_role_id);
      const remove = have.filter((r) => !jobRoleIds.includes(r));
      const add = [...new Set(jobRoleIds)].filter((r) => !have.includes(r));
      if (remove.length) {
        const { error: e } = await admin
          .from('profile_job_roles')
          .delete()
          .eq('user_id', userId)
          .in('job_role_id', remove);
        if (e) return e.message;
      }
      if (add.length) {
        const { error: e } = await admin
          .from('profile_job_roles')
          .insert(add.map((job_role_id) => ({ job_role_id, user_id: userId })));
        if (e) return e.message;
      }
    }
    return null;
  }

  switch (body.action) {
    case 'create': {
      const invalid = validate(body, true) ?? (await checkManager(body.reports_to));
      if (invalid) return fail(invalid);
      const role = body.role ?? 'member';
      const { data, error } = await admin.auth.admin.createUser({
        email: body.email!.trim().toLowerCase(),
        password: body.password!,
        email_confirm: true,
        user_metadata: { full_name: body.full_name!.trim() },
        app_metadata: { role },
      });
      if (error || !data.user) return fail(error?.message ?? 'Could not create user');
      const userId = data.user.id;
      const { error: profileError } = await admin
        .from('profiles')
        .update({
          full_name: body.full_name!.trim(),
          role,
          phone: body.phone?.trim() || null,
          reports_to: body.reports_to ?? null,
        })
        .eq('id', userId);
      if (profileError) return fail(profileError.message);
      const membershipError = await setMemberships(userId, body.department_ids, body.job_role_ids);
      if (membershipError) return fail(membershipError);
      return json({ user_id: userId });
    }

    case 'update': {
      if (!body.user_id || !UUID_RE.test(body.user_id)) return fail('user_id is required');
      const invalid = validate(body, false) ?? (await checkManager(body.reports_to));
      if (invalid) return fail(invalid);
      if (body.reports_to === body.user_id) return fail('A user cannot report to themselves');

      // Profile first: it is the source of truth, and the database may refuse the change
      // (e.g. demoting the last admin) before the auth record is touched.
      const profile: Record<string, unknown> = {};
      if (body.full_name !== undefined) profile.full_name = body.full_name.trim();
      if (body.phone !== undefined) profile.phone = body.phone?.trim() || null;
      if (body.role !== undefined) profile.role = body.role;
      if (body.reports_to !== undefined) profile.reports_to = body.reports_to;
      if (Object.keys(profile).length) {
        const { error } = await admin.from('profiles').update(profile).eq('id', body.user_id);
        if (error) return fail(error.message);
      }

      const authChanges: Record<string, unknown> = {};
      if (body.email !== undefined) {
        authChanges.email = body.email.trim().toLowerCase();
        authChanges.email_confirm = true;
      }
      if (body.role !== undefined) authChanges.app_metadata = { role: body.role };
      if (body.full_name !== undefined) authChanges.user_metadata = { full_name: body.full_name.trim() };
      if (Object.keys(authChanges).length) {
        const { error } = await admin.auth.admin.updateUserById(body.user_id, authChanges);
        if (error) return fail(error.message);
      }

      const membershipError = await setMemberships(body.user_id, body.department_ids, body.job_role_ids);
      if (membershipError) return fail(membershipError);
      return json({ user_id: body.user_id });
    }

    case 'reset_password': {
      if (!body.user_id || !UUID_RE.test(body.user_id)) return fail('user_id is required');
      if (!body.password || body.password.length < 8) return fail('Password must be at least 8 characters');
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) return fail(error.message);
      return json({ user_id: body.user_id });
    }

    case 'set_active': {
      if (!body.user_id || !UUID_RE.test(body.user_id)) return fail('user_id is required');
      if (body.user_id === caller.user.id && body.active === false) return fail('You cannot deactivate yourself');
      const active = body.active !== false;
      // Profile first: the last-admin guard in the database can refuse this.
      const { error } = await admin.from('profiles').update({ is_active: active }).eq('id', body.user_id);
      if (error) return fail(error.message);
      const { error: banError } = await admin.auth.admin.updateUserById(body.user_id, {
        ban_duration: active ? 'none' : '876000h',
      });
      if (banError) return fail(banError.message);
      return json({ user_id: body.user_id, active });
    }

    default:
      return fail('Unknown action');
  }
});
