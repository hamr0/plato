import { knowless } from 'knowless';

const REQUIRED_ENV = ['KNOWLESS_SECRET', 'KNOWLESS_BASE_URL', 'KNOWLESS_FROM'];

export function createAuth(env = process.env, overrides = {}) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new Error(`auth: ${key} is required`);
  }

  return knowless({
    secret: env.KNOWLESS_SECRET,
    baseUrl: env.KNOWLESS_BASE_URL,
    from: env.KNOWLESS_FROM,
    smtpHost: env.KNOWLESS_SMTP_HOST ?? 'localhost',
    smtpPort: Number(env.KNOWLESS_SMTP_PORT ?? 1025),
    dbPath: env.KNOWLESS_DB_PATH ?? './knowless.db',
    openRegistration: true,
    cookieSecure: env.KNOWLESS_COOKIE_SECURE !== 'false',
    devLogMagicLinks: env.KNOWLESS_DEV_LOG_LINKS === 'true',
    ...overrides,
  });
}
