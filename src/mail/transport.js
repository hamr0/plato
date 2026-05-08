import nodemailer from 'nodemailer';

// Production deploys set PLATO_SENDMAIL_PATH=/usr/sbin/sendmail (the msmtp
// symlink installed by msmtp-mta) so plato sends magic-link mail and
// operator alerts through one local binary that owns the relay creds in
// /etc/msmtprc. Dev leaves PLATO_SENDMAIL_PATH unset; knowless falls back
// to its SMTP localhost:1025 default which fails fast → KNOWLESS_DEV_LOG_LINKS
// stderr fallback prints the magic link instead.

export function resolveSendmailPath(env = process.env) {
  const raw = env.PLATO_SENDMAIL_PATH;
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new Error('mail/transport: PLATO_SENDMAIL_PATH must be a string');
  }
  return raw;
}

export function createMailerTransport(env = process.env) {
  const path = resolveSendmailPath(env);
  if (path === null) return null;
  return nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path,
  });
}
