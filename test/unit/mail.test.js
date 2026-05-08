import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailerTransport, resolveSendmailPath } from '../../src/mail/transport.js';

test('resolveSendmailPath: returns null when PLATO_SENDMAIL_PATH unset (dev default)', () => {
  assert.equal(resolveSendmailPath({}), null);
});

test('resolveSendmailPath: returns null when PLATO_SENDMAIL_PATH is empty', () => {
  assert.equal(resolveSendmailPath({ PLATO_SENDMAIL_PATH: '' }), null);
});

test('resolveSendmailPath: honors PLATO_SENDMAIL_PATH when set', () => {
  assert.equal(
    resolveSendmailPath({ PLATO_SENDMAIL_PATH: '/usr/sbin/sendmail' }),
    '/usr/sbin/sendmail',
  );
});

test('resolveSendmailPath: rejects non-string override', () => {
  assert.throws(() => resolveSendmailPath({ PLATO_SENDMAIL_PATH: 42 }), /must be a string/);
});

test('createMailerTransport: returns null when PLATO_SENDMAIL_PATH unset', () => {
  assert.equal(createMailerTransport({}), null);
});

test('createMailerTransport: returns sendmail transport when path is set', () => {
  const t = createMailerTransport({ PLATO_SENDMAIL_PATH: '/usr/sbin/sendmail' });
  assert.notEqual(t, null);
  assert.equal(t.transporter.name, 'Sendmail');
  assert.equal(t.transporter.path, '/usr/sbin/sendmail');
  assert.equal(typeof t.sendMail, 'function');
});

test('createMailerTransport: honors any path the operator supplies', () => {
  const t = createMailerTransport({ PLATO_SENDMAIL_PATH: '/opt/bin/msmtp' });
  assert.equal(t.transporter.path, '/opt/bin/msmtp');
});

test('createMailerTransport: produces unix-newline transport', () => {
  const t = createMailerTransport({ PLATO_SENDMAIL_PATH: '/usr/sbin/sendmail' });
  assert.equal(t.transporter.options.newline, 'unix');
});

test('createMailerTransport: returned transport exposes nodemailer surface', () => {
  const t = createMailerTransport({ PLATO_SENDMAIL_PATH: '/usr/sbin/sendmail' });
  assert.equal(typeof t.sendMail, 'function');
  assert.equal(typeof t.close, 'function');
});
