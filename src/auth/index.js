import { knowless } from 'knowless';

const REQUIRED_ENV = ['KNOWLESS_SECRET', 'KNOWLESS_BASE_URL', 'KNOWLESS_FROM'];

// knowless validates the mail display name (fromName) at boot: ASCII, ≤60
// chars, no `"`/`<`/`>`/CR/LF — and throws if it fails. plato sources fromName
// from branding.forumName, which is operator-free-text and may be non-ASCII
// (the forum supports multilingual content) or long. Reduce an unsafe name to
// undefined so mail simply sends from the bare address, rather than letting a
// cosmetic branding value take the whole forum down at boot.
export function safeFromName(name) {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60 || /[^\x20-\x7e]|["<>]/.test(trimmed)) return undefined;
  return trimmed;
}

export function createAuth(env = process.env, overrides = {}) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new Error(`auth: ${key} is required`);
  }

  const { fromName, ...restOverrides } = overrides;
  const cfg = {
    secret: env.KNOWLESS_SECRET,
    baseUrl: env.KNOWLESS_BASE_URL,
    // Must be a bare RFC 5321 address. knowless ≥1.1.9 rejects the
    // display form (`Name <addr>`) at boot — the display name belongs in
    // `fromName`, passed by the caller (bin/server.js, from branding.forumName)
    // and sanitized via safeFromName above.
    from: env.KNOWLESS_FROM,
    fromName: safeFromName(fromName),
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
  if (env.KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR) {
    cfg.maxLoginRequestsPerIpPerHour = Number(env.KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR);
  }
  return knowless({ ...cfg, ...restOverrides });
}
