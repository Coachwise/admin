// Applies admin/migrations/*.sql in filename order, once each.
//
// admin/ owns its own tables and therefore its own migration history, tracked in
// `admin_migrations`. It is deliberately separate from api/'s golang-migrate
// `schema_migrations`: two tools sharing one version table is how a migration
// history gets corrupted. Prisma is never used to migrate here — only to
// introspect (`npm run pull`).
import { DATABASE_URL } from '../src/env.js';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS public.admin_migrations (
    name       text PRIMARY KEY,
    applied_at timestamp NOT NULL DEFAULT now()
  )
`);

const { rows } = await client.query('SELECT name FROM admin_migrations');
const applied = new Set(rows.map((r) => r.name));

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
let count = 0;

for (const file of files) {
  if (applied.has(file)) continue;

  const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
  // Each migration is one transaction: it applies whole or not at all.
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO admin_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`applied  ${file}`);
    count += 1;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED   ${file}\n${err.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(count ? `\n${count} migration(s) applied.` : 'Already up to date.');
await client.end();
