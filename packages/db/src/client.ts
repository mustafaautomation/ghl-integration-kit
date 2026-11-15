import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { sql: postgres.Sql; db: Database } {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
