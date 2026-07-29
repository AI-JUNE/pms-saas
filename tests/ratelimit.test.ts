import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, clientIp, enforceRateLimit, RL } from '../src/lib/ratelimit.ts';
import { ApiError } from '../src/lib/http.ts';

test('rateLimit allows up to limit then blocks within window', () => {
  const opts = { key: 't:basic', limit: 3, windowMs: 60_000 };
  const id = 'ip-1';
  for (let i = 1; i <= 3; i++) {
    const r = rateLimit(id, opts);
    assert.equal(r.ok, true, `hit ${i} should pass`);
    assert.equal(r.remaining, 3 - i);
  }
  const r4 = rateLimit(id, opts);
  assert.equal(r4.ok, false);
  assert.equal(r4.remaining, 0);
  assert.ok(r4.retryAfterSec >= 1 && r4.retryAfterSec <= 60);
});

test('rateLimit buckets are isolated per id and per key', () => {
  const opts = { key: 't:iso', limit: 1, windowMs: 60_000 };
  assert.equal(rateLimit('a', opts).ok, true);
  assert.equal(rateLimit('a', opts).ok, false);
  // different IP unaffected
  assert.equal(rateLimit('b', opts).ok, true);
  // same IP, different route key unaffected
  assert.equal(rateLimit('a', { key: 't:iso2', limit: 1, windowMs: 60_000 }).ok, true);
});

test('rateLimit window resets after windowMs', async () => {
  const opts = { key: 't:reset', limit: 1, windowMs: 40 };
  assert.equal(rateLimit('x', opts).ok, true);
  assert.equal(rateLimit('x', opts).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rateLimit('x', opts).ok, true, 'window elapsed -> allowed again');
});

test('clientIp prefers x-forwarded-for first hop, falls back to anon', () => {
  const mk = (h) => new Request('http://x/', { headers: h });
  assert.equal(clientIp(mk({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIp(mk({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
  assert.equal(clientIp(mk({})), 'anon');
});

test('enforceRateLimit throws standard 429 ApiError with retryAfterSec', () => {
  const opts = { key: 't:enforce', limit: 1, windowMs: 60_000 };
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9' } });
  enforceRateLimit(req, opts); // 1st ok
  try {
    enforceRateLimit(req, opts); // 2nd should throw
    assert.fail('expected ApiError');
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.equal((e as ApiError).err.status, 429);
    assert.equal((e as ApiError).err.code, 'TOO_MANY');
    assert.equal(typeof (e as ApiError).extra?.retryAfterSec, 'number');
  }
});

test('presets: login/register limits are sane for brute-force defense', () => {
  assert.ok(RL.authLogin.limit <= 10 && RL.authLogin.windowMs >= 30_000);
  assert.ok(RL.authRegister.limit <= RL.authLogin.limit);
});
