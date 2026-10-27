import { describe, expect, it } from 'vitest';
import { EnvValidationError, integrationStatus, parseEnv } from '../src/config/env';

const base = {
  MONGODB_URI: 'mongodb://localhost/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
};

describe('env validation', () => {
  it('rejects missing required variables', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
  });
  it('rejects short secrets', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });
  it('applies defaults and parses CORS origins', () => {
    const env = parseEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });
  it('rejects placeholder secrets and wildcard CORS in production', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me'.padEnd(40, 'x') }),
    ).toThrow(/placeholder/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(
      /Wildcard/,
    );
  });
  it('requires SMTP settings when email provider is smtp', () => {
    expect(() => parseEnv({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
  });
  it('reports integrations as not configured by default, without secrets', () => {
    const status = integrationStatus(parseEnv(base));
    expect(Object.values(status).every((v) => v === 'not_configured')).toBe(true);
  });

  describe('production hardening', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://db.internal:27017/x?replicaSet=rs0',
      WEB_APP_URL: 'https://app.example.com',
      CORS_ORIGINS: 'https://app.example.com',
    };
    it('accepts a sound production configuration', () => {
      expect(() => parseEnv(prod)).not.toThrow();
    });
    it('requires different secrets for access and refresh tokens', () => {
      expect(() => parseEnv({ ...prod, REFRESH_TOKEN_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
        /must differ/,
      );
    });
    it('requires https for the web app and CORS origins', () => {
      expect(() => parseEnv({ ...prod, WEB_APP_URL: 'http://app.example.com' })).toThrow(/https/);
      expect(() => parseEnv({ ...prod, CORS_ORIGINS: 'http://app.example.com' })).toThrow(/https/);
    });
    it('does not apply these rules outside production', () => {
      expect(() => parseEnv({ ...base, WEB_APP_URL: 'http://localhost:3000' })).not.toThrow();
    });
    it('turns API docs off by default in production and on elsewhere', () => {
      expect(parseEnv(prod).ENABLE_API_DOCS).toBeUndefined();
      expect(parseEnv({ ...prod, ENABLE_API_DOCS: 'true' }).ENABLE_API_DOCS).toBe(true);
    });
  });
});
