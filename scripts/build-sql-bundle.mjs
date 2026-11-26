// Writes paste-ready SQL for the Supabase SQL Editor.
//
//   npm run sql:bundle                       -> supabase/setup/full_setup.sql (new project)
//   npm run sql:bundle -- --since <version>  -> supabase/setup/update_after_<version>.sql
//
// See what a project already has with:
//   select * from private.applied_migrations order by version;
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildBundle, bundleFileName, setupDir } from './lib/sql-bundle.mjs';

const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx > -1 ? process.argv[sinceIdx + 1] : null;

const { sql, files } = buildBundle({ since });
if (files.length === 0) {
  console.log('No migrations to bundle.');
  process.exit(0);
}
mkdirSync(setupDir, { recursive: true });
const target = join(setupDir, bundleFileName(since));
writeFileSync(target, sql);
console.log(`Wrote ${target} (${files.length} migrations)`);
