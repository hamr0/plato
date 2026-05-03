import { knowless } from 'knowless';

const REQUIRED_ENV = ['KNOWLESS_SECRET', 'KNOWLESS_BASE_URL', 'KNOWLESS_FROM'];

export function createAuth(env = process.env, overrides = {}) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new Error(`auth: ${key} is required`);
  }

  const cfg = {
    secret: env.KNOWLESS_SECRET,
    baseUrl: env.KNOWLESS_BASE_URL,
    from: env.KNOWLESS_FROM,
    smtpHost: env.KNOWLESS_SMTP_HOST ?? 'localhost',
    smtpPort: Number(env.KNOWLESS_SMTP_PORT ?? 1025),
    dbPath: env.KNOWLESS_DB_PATH ?? './knowless.db',
    openRegistration: true,
    cookieSecure: env.KNOWLESS_COOKIE_SECURE !== 'false',
    devLogMagicLinks: env.KNOWLESS_DEV_LOG_LINKS === 'true',
    // Sham/expired/used-token clicks land on home, not /login. Landing
    // on /login telegraphs "your link was rejected" and partially
    // defeats the silent-miss design that POST /login worked so hard
    // to preserve. Home looks identical for logged-out users whether
    // they just clicked a sham link or arrived for the first time.
    failureRedirect: '/',
  };
  if (env.KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR) {
    cfg.maxNewHandlesPerIpPerHour = Number(env.KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR);
  }
  return knowless({ ...cfg, ...overrides });
}
