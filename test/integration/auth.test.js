import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../../src/auth/index.js';

function fakeEnv(overrides = {}) {
  return {
    KNOWLESS_SECRET: randomBytes(32).toString('hex'),
    KNOWLESS_BASE_URL: 'http://localhost:8080',
    KNOWLESS_FROM: 'auth@test.local',
    ...overrides,
  };
}

test('createAuth: throws when KNOWLESS_SECRET missing', () => {
  const env = fakeEnv();
  delete env.KNOWLESS_SECRET;
  assert.throws(() => createAuth(env), /KNOWLESS_SECRET is required/);
});

test('createAuth: throws when KNOWLESS_BASE_URL missing', () => {
  const env = fakeEnv();
  delete env.KNOWLESS_BASE_URL;
  assert.throws(() => createAuth(env), /KNOWLESS_BASE_URL is required/);
});

test('createAuth: throws when KNOWLESS_FROM missing', () => {
  const env = fakeEnv();
  delete env.KNOWLESS_FROM;
  assert.throws(() => createAuth(env), /KNOWLESS_FROM is required/);
});

test('createAuth: returns object with expected handler methods', () => {
  const auth = createAuth(fakeEnv(), { dbPath: ':memory:' });
  try {
    for (const method of ['login', 'callback', 'verify', 'logout', 'loginForm', 'handleFromRequest', 'startLogin', 'deriveHandle', 'close']) {
      assert.equal(typeof auth[method], 'function', `auth.${method} should be a function`);
    }
  } finally {
    auth.close();
  }
});

test('createAuth: accepts a bare KNOWLESS_FROM with a fromName display name', () => {
  const auth = createAuth(fakeEnv(), { dbPath: ':memory:', fromName: 'terribic' });
  try {
    assert.equal(typeof auth.login, 'function');
  } finally {
    auth.close();
  }
});

test('createAuth: rejects a display-format KNOWLESS_FROM at boot (knowless bare-address contract)', () => {
  // knowless ≥1.1.9 fails fast when `from` carries a display name; plato
  // must keep KNOWLESS_FROM bare and route the name through fromName.
  const env = fakeEnv({ KNOWLESS_FROM: 'terribic <auth@test.local>' });
  assert.throws(() => createAuth(env, { dbPath: ':memory:' }), /bare address/);
});

test('deriveHandle: deterministic per secret, 64-char hex', () => {
  const env = fakeEnv();
  const a = createAuth(env, { dbPath: ':memory:' });
  const b = createAuth(env, { dbPath: ':memory:' });
  try {
    const h1 = a.deriveHandle('alice@example.com');
    const h2 = b.deriveHandle('alice@example.com');
    assert.equal(h1, h2, 'same secret → same handle');
    assert.equal(h1.length, 64, 'HMAC-SHA256 hex is 64 chars');
    assert.match(h1, /^[0-9a-f]{64}$/, 'lowercase hex');
  } finally {
    a.close();
    b.close();
  }
});

test('deriveHandle: different secrets produce different handles for same email', () => {
  const a = createAuth(fakeEnv(), { dbPath: ':memory:' });
  const b = createAuth(fakeEnv(), { dbPath: ':memory:' });
  try {
    assert.notEqual(
      a.deriveHandle('alice@example.com'),
      b.deriveHandle('alice@example.com'),
      'different secrets → different handles (forking property)'
    );
  } finally {
    a.close();
    b.close();
  }
});

test('deriveHandle: email normalization (case + trim)', () => {
  const auth = createAuth(fakeEnv(), { dbPath: ':memory:' });
  try {
    const h1 = auth.deriveHandle('Alice@Example.com');
    const h2 = auth.deriveHandle('  alice@example.com  ');
    assert.equal(h1, h2, 'knowless normalizes email before HMAC');
  } finally {
    auth.close();
  }
});

test('createAuth: overrides win over env config', () => {
  const env = fakeEnv();
  const auth = createAuth(env, {
    dbPath: ':memory:',
    baseUrl: 'http://override.local',
  });
  try {
    assert.equal(auth.config.baseUrl, 'http://override.local');
  } finally {
    auth.close();
  }
});

test('createAuth: openRegistration is true (forum default)', () => {
  const auth = createAuth(fakeEnv(), { dbPath: ':memory:' });
  try {
    assert.equal(auth.config.openRegistration, true);
  } finally {
    auth.close();
  }
});

test('createAuth: cookieSecure defaults true, "false" env disables', () => {
  const a = createAuth(fakeEnv(), { dbPath: ':memory:' });
  const b = createAuth(fakeEnv({ KNOWLESS_COOKIE_SECURE: 'false' }), { dbPath: ':memory:' });
  try {
    assert.equal(a.config.cookieSecure, true);
    assert.equal(b.config.cookieSecure, false);
  } finally {
    a.close();
    b.close();
  }
});

test('handleFromRequest: returns null for request without cookie', () => {
  const auth = createAuth(fakeEnv(), { dbPath: ':memory:' });
  try {
    const fakeReq = { headers: {} };
    assert.equal(auth.handleFromRequest(fakeReq), null);
  } finally {
    auth.close();
  }
});
