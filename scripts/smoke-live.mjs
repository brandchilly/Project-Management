// Read-only checks against the live Supabase project, using only the public key from .env.
// Never writes data. Run: node scripts/smoke-live.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => /^\s*VITE_/.test(l))
    .map((l) => l.trim().split(/=(.*)/s).slice(0, 2))
);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env first.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `\n        ${detail}` : ''}`);
};

// 1. Auth settings: public sign-up must be off.
const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then((r) => r.json());
check('Public sign-up is disabled', settings.disable_signup === true, `disable_signup = ${settings.disable_signup}`);

// 2. Anonymous visitors see no data (RLS).
for (const table of ['profiles', 'clients', 'tasks', 'templates', 'departments', 'board_cells', 'notifications']) {
  const { data, error } = await sb.from(table).select('*').limit(1);
  check(`Anonymous read of ${table} returns nothing`, !error ? data.length === 0 : true, error ? `error: ${error.message}` : `rows: ${data.length}`);
}

// 3. RPCs exist and refuse anonymous callers (a missing function would say "Could not find").
for (const [fn, args] of [
  ['get_reports', {}],
  ['import_client', { p_name: 'x', p_template_id: '00000000-0000-0000-0000-000000000000', p_onboarding_date: '2026-01-01' }],
  ['create_client_from_template', { p_name: 'x', p_template_id: '00000000-0000-0000-0000-000000000000', p_onboarding_date: '2026-01-01' }],
  ['set_task_status', { p_task_id: '00000000-0000-0000-0000-000000000000', p_status: 'done' }],
  ['reveal_client_credential', { p_credential_id: '00000000-0000-0000-0000-000000000000' }],
]) {
  const { error } = await sb.rpc(fn, args);
  const missing = error && /Could not find the function/i.test(error.message);
  check(`RPC ${fn} is deployed and refuses anonymous callers`, !!error && !missing, error ? error.message : 'no error (unexpected)');
}

// 4. admin-users Edge Function: CORS pre-check and refusal without a login.
{
  const pre = await fetch(`${url}/functions/v1/admin-users`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info' },
  });
  check('admin-users answers the browser CORS pre-check', pre.ok && !!pre.headers.get('access-control-allow-origin'), `status ${pre.status}`);
  const res = await fetch(`${url}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create' }),
  });
  const body = await res.text();
  check('admin-users refuses a caller with no login', res.status === 401 || res.status === 403, `status ${res.status}: ${body.slice(0, 120)}`);
  check(
    'admin-users "Verify JWT with legacy secret" is off (our code answered, not the gateway)',
    /Not signed in/.test(body),
    /Not signed in/.test(body) ? undefined : 'The gateway answered instead; turn the setting off in Edge Functions > admin-users > Settings'
  );
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
