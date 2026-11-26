// Creates an in-memory Postgres (PGlite) with the Supabase stubs and every migration applied.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(root, 'supabase', 'migrations');
// Platform extensions (pg_cron, pg_net, vault) are stubbed instead.
const SKIP = new Set(['20261125000100_extensions.sql']);

export async function createMigratedDb({ log = () => {} } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(join(root, 'supabase', 'tests', 'stubs.sql'), 'utf8'));
  // Like the live project: schema usage only. Table privileges must come from the migrations
  // themselves (20261126001000 grants them), so a missing grant fails the tests.
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (SKIP.has(file)) continue;
    try {
      await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
      log(`  applied ${file}`);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
  }
  return db;
}
