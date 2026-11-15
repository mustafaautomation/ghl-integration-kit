import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(root, 'packages/db/src/d1'));
  return {
    test: {
      root,
      include: ['apps/worker/test/**/*.test.ts'],
      poolOptions: {
        workers: {
          isolatedStorage: false,
          wrangler: { configPath: path.join(root, 'wrangler.toml') },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
