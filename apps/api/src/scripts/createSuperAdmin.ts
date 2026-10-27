/**
 * Provision a SaaS super-admin. There is deliberately NO HTTP endpoint for this.
 *   pnpm --filter @workforce/api create-super-admin -- --email ops@example.com
 * Password is read from SUPER_ADMIN_PASSWORD or prompted (hidden).
 */
import { User } from '../database/models/user.model';
import { passwordSchema } from '../modules/auth/auth.routes';
import { hashPassword } from '../utils/security';
import { runScript } from './bootstrap';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f') value = value.slice(0, -1);
      else value += ch;
    };
    stdin.on('data', onData);
  });
}

void runScript(async () => {
  const i = process.argv.indexOf('--email');
  const email = i > -1 ? process.argv[i + 1]?.toLowerCase() : undefined;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error('Usage: create-super-admin --email <address>');
  const password = process.env.SUPER_ADMIN_PASSWORD ?? (await promptHidden('Password: '));
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues.map((x) => x.message).join('; '));
  const existing = await User.findOne({ email });
  if (existing?.isPlatformAdmin) throw new Error('A super-admin with this email already exists');
  if (existing)
    throw new Error(
      'A regular user with this email already exists; use a dedicated operator email',
    );
  await User.create({
    email,
    passwordHash: await hashPassword(password),
    status: 'ACTIVE',
    isPlatformAdmin: true,
    emailVerifiedAt: new Date(),
  });
  console.log(`Super-admin ${email} created.`);
});
