import { createDb } from './client.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const { sql } = createDb(url);
await migrate(sql);
await sql.end();
console.log('migrated');
