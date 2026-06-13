import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signAdminSession,
  verifyAdminSession,
  isAdminSessionValid,
  getAdminSessionTtlSeconds,
} from '../src/lib/admin/session.ts';

const secret = 'unit-test-secret-please-ignore';

test('signAdminSession + verifyAdminSession roundtrips with the same secret', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, secret, { now: 1_700_000_030 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.v, 1);
    assert.equal(result.payload.exp, 1_700_000_060);
  }
});

test('verifyAdminSession rejects an empty cookie', async () => {
  const result = await verifyAdminSession('', secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'missing');
  }
});

test('verifyAdminSession rejects a literal "1" cookie (the old bypass)', async () => {
  // The old admin auth code accepted `cookie === "1"`. The new verifier must
  // reject it. The cookie "1" has no dot separator, so it is structurally
  // malformed; we assert it is rejected for any reason.
  const result = await verifyAdminSession('1', secret);
  assert.equal(result.ok, false);
});

test('verifyAdminSession rejects a cookie with tampered payload', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  const [body, sig] = cookie.split('.');
  const tampered = `${body.slice(0, -1)}A.${sig}`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'bad-signature');
  }
});

test('verifyAdminSession rejects a cookie with tampered signature', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  const [body, sig] = cookie.split('.');
  const tampered = `${body}.${sig.slice(0, -1)}A`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'bad-signature');
  }
});

test('verifyAdminSession rejects an expired cookie', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, secret, { now: 1_700_000_061 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'expired');
  }
});

test('verifyAdminSession rejects a cookie signed with a different secret', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, 'a-different-secret');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'bad-signature');
  }
});

test('verifyAdminSession rejects a cookie with no version', async () => {
  const fakeBody = Buffer.from(JSON.stringify({ exp: 1_700_000_060 })).toString('base64url');
  const keyMaterial = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const realSig = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(fakeBody)),
  );
  const sigB64 = Buffer.from(realSig).toString('base64url');
  const result = await verifyAdminSession(`${fakeBody}.${sigB64}`, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'bad-version');
  }
});

test('isAdminSessionValid mirrors verifyAdminSession boolean', async () => {
  const cookie = await signAdminSession(secret, { now: 1_700_000_000, ttlSeconds: 60 });
  assert.equal(await isAdminSessionValid(cookie, secret, { now: 1_700_000_030 }), true);
  assert.equal(await isAdminSessionValid(cookie, secret, { now: 1_700_000_061 }), false);
  assert.equal(await isAdminSessionValid('1', secret), false);
  assert.equal(await isAdminSessionValid(undefined, secret), false);
});

test('getAdminSessionTtlSeconds is positive', () => {
  assert.ok(getAdminSessionTtlSeconds() > 0);
});
