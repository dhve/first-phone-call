import postgres from 'postgres';
import { buildConfig } from '../config.js';

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns the shared postgres.js client, lazily initialized on first call.
 * Columns are auto-transformed snake_case <-> camelCase via postgres.camel.
 */
export function getSql(): ReturnType<typeof postgres> {
  if (_sql) return _sql;
  const config = buildConfig();
  _sql = postgres(config.db.url, {
    max: config.db.maxConnections,
    transform: postgres.camel,
  });
  return _sql;
}

export async function closeSql(): Promise<void> {
  if (!_sql) return;
  await _sql.end();
  _sql = null;
}
