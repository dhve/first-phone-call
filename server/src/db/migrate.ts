import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { buildConfig } from '../config.js';

/**
 * Applies pending *.sql files from db/migrations in lexical order.
 * Tracks applied files in schema_migrations. Idempotent across runs.
 * Each file runs in its own transaction.
 */
async function migrate(): Promise<void> {
  const config = buildConfig();
  const sql = postgres(config.db.url, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Container images copy migrations to db/migrations; the repo keeps them
    // in src/db/migrations. Support both so npm run migrate works locally.
    const candidates = ['db/migrations', 'src/db/migrations']
      .map((p) => path.resolve(process.cwd(), p));
    const dir = candidates.find((p) => existsSync(p));
    if (!dir) {
      throw new Error(`no migrations directory found (looked in: ${candidates.join(', ')})`);
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [applied] = await sql<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = ${file}
      `;
      if (applied) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      await sql.begin(async (tx) => {
        await tx.file(path.join(dir, file));
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });
      console.log(`applied ${file}`);
    }

    console.log('migrations done');
  } finally {
    await sql.end();
  }
}

migrate().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
