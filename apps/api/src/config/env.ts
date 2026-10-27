import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(20),
    /** Public company signup: set false to close self-service signup (platform admins can still onboard). */
    PUBLIC_SIGNUP_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Max signups per IP per hour. */
    RATE_LIMIT_SIGNUP_MAX: z.coerce.number().int().min(1).default(5),
    RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().min(1).default(10),
    INVITE_TTL_HOURS: z.coerce.number().int().min(1).default(72),
    RESET_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
    ENABLE_API_DOCS: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),
    MOBILE_APP_SCHEME: z.string().min(1).default('workforcehrms'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    REDIS_URL: optionalString,
    /** Punch coordinates older than this are erased by the nightly purge job (the punch itself is kept). */
    LOCATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
    /** Punch proof photos older than this are erased by the nightly purge job (the punch itself is kept). */
    PHOTO_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
    OBJECT_STORAGE_ENDPOINT: optionalString,
    OBJECT_STORAGE_BUCKET: optionalString,
    OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
    OBJECT_STORAGE_ACCESS_KEY: optionalString,
    OBJECT_STORAGE_SECRET_KEY: optionalString,
    /** Local-disk storage (used only when S3 is not configured). Set a folder to enable, e.g. ./uploads */
    LOCAL_STORAGE_DIR: optionalString,
    /** Public base URL of this API as the clients reach it (phones need a LAN IP/domain, not localhost). */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    EMAIL_PROVIDER: z.enum(['none', 'smtp']).default('none'),
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalString,
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    EMAIL_FROM: optionalString,
    PUSH_PROVIDER: z.enum(['none', 'expo']).default('none'),
    EXPO_ACCESS_TOKEN: optionalString,
    EXPO_PUSH_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
    MAP_PROVIDER: z.enum(['none', 'mapbox', 'google']).default('none'),
    MAP_API_KEY: optionalString,
    SUBSCRIPTION_PROVIDER: z.enum(['none', 'stripe']).default('none'),
    SUBSCRIPTION_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_ACCESS_SECRET', 'REFRESH_TOKEN_SECRET'] as const) {
        if (/change[-_]?me|example|placeholder/i.test(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must not be a placeholder value in production`,
          });
        }
      }
      if (env.JWT_ACCESS_SECRET === env.REFRESH_TOKEN_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REFRESH_TOKEN_SECRET'],
          message: 'REFRESH_TOKEN_SECRET must differ from JWT_ACCESS_SECRET',
        });
      }
      const insecure = [env.WEB_APP_URL, ...env.CORS_ORIGINS].filter(
        (u) => !u.startsWith('https://'),
      );
      if (insecure.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEB_APP_URL'],
          message: `WEB_APP_URL and CORS_ORIGINS must use https in production (found: ${insecure.join(', ')})`,
        });
      }
      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'Wildcard CORS origin is not allowed in production',
        });
      }
    }
    if (env.EMAIL_PROVIDER === 'smtp' && (!env.SMTP_HOST || !env.EMAIL_FROM)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST and EMAIL_FROM are required when EMAIL_PROVIDER=smtp',
      });
    }
  });

export type Env = z.infer<typeof schema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export type IntegrationState = 'configured' | 'not_configured';

/** Reports which optional integrations are configured. Never includes secret values. */
export function integrationStatus(env: Env): Record<string, IntegrationState> {
  const s = (ok: boolean): IntegrationState => (ok ? 'configured' : 'not_configured');
  return {
    redis: s(!!env.REDIS_URL),
    objectStorage: s(
      !!env.LOCAL_STORAGE_DIR ||
        !!(
        env.OBJECT_STORAGE_ENDPOINT &&
        env.OBJECT_STORAGE_BUCKET &&
        env.OBJECT_STORAGE_ACCESS_KEY &&
        env.OBJECT_STORAGE_SECRET_KEY
      ),
    ),
    email: s(env.EMAIL_PROVIDER !== 'none'),
    push: s(env.PUSH_PROVIDER !== 'none'),
    maps: s(env.MAP_PROVIDER !== 'none' && !!env.MAP_API_KEY),
    subscriptionBilling: s(env.SUBSCRIPTION_PROVIDER !== 'none' && !!env.SUBSCRIPTION_API_KEY),
  };
}
