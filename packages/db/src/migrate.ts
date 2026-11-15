import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

export async function migrate(sql: postgres.Sql): Promise<void> {
  const file = fileURLToPath(new URL('./sql/001_init.sql', import.meta.url));
  const text = readFileSync(file, 'utf8');
  const statements = text
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith('--'));
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}
