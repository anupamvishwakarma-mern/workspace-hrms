// Creates apps/api/.env from .env.example with freshly generated secrets. Never overwrites an existing file.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps', 'api', '.env');
if (existsSync(target)) {
  console.log('apps/api/.env already exists - leaving it untouched.');
  process.exit(0);
}
const secret = () => randomBytes(48).toString('hex');
const text = readFileSync(join(root, '.env.example'), 'utf8')
  .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret()}`)
  .replace(/^REFRESH_TOKEN_SECRET=.*$/m, `REFRESH_TOKEN_SECRET=${secret()}`);
writeFileSync(target, text);
console.log('Created apps/api/.env with generated secrets.');
console.log(
  'Next: start MongoDB (docker compose up -d mongo), then pnpm --filter @workforce/api seed',
);
