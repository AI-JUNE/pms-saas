import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendError, ok, handle, ApiError, ERROR, requestContext } from '../src/lib/http.ts';

test('sendError returns standard shape { ok:false, code, message }', async () => {
  const res = sendError(ERROR.VALIDATION, 'missing field', { field: 'email' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(
    { ok: body.ok, code: body.code, message: body.message, field: body.field },
    { ok: false, code: 'VALIDATION', message: 'missing field', field: 'email' },
  );
});

test('429 sendError sets Retry-After header from retryAfterSec', async () => {
  const res = sendError(ERROR.TOO_MANY, 'try later', { retryAfterSec: 42 });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '42');
});

test('ok() defaults to 200 with body', async () => {
  const res = ok({ hello: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hello: 1 });
});

test('handle converts ApiError to standard response', async () => {
  const res = await handle(async () => { throw new ApiError(ERROR.FORBIDDEN, 'no permission'); });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'FORBIDDEN');
});

test('handle maps pg unique-violation 23505 to 409 CONFLICT', async () => {
  const res = await handle(async () => { const e = new Error('dup') as any; e.code = '23505'; throw e; });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'CONFLICT');
});

test('handle hides unknown errors behind 500 SERVER (no leak)', async () => {
  const res = await handle(async () => { throw new Error('secret internal detail'); });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, 'SERVER');
  assert.ok(!String(body.message).includes('secret'));
});

test('ERROR table covers all launch-required codes', () => {
  const codes = Object.values(ERROR).map((e) => e.code);
  for (const c of ['VALIDATION','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','TOO_MANY','SERVER'])
    assert.ok(codes.includes(c), c);
});

test('requestContext extracts method and pathname only (no query string)', () => {
  const req = new Request('https://x.test/api/issues?q=secret@mail.com', { method: 'POST' });
  const ctx = requestContext(req);
  assert.equal(ctx.method, 'POST');
  assert.equal(ctx.path, '/api/issues');
  assert.ok(!JSON.stringify(ctx).includes('secret@mail.com'));
  assert.ok(ctx.requestId.length > 0);
});

test('requestContext propagates a safe incoming x-request-id', () => {
  const req = new Request('https://x.test/api/a', { headers: { 'x-request-id': 'trace-42' } });
  assert.equal(requestContext(req).requestId, 'trace-42');
});

test('handle attaches x-request-id to successful responses', async () => {
  const req = new Request('https://x.test/api/a', { headers: { 'x-request-id': 'trace-99' } });
  const res = await handle(async () => ok({ ok: true }), req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id'), 'trace-99');
});

test('handle still maps ApiError and pg codes when req is passed', async () => {
  const req = new Request('https://x.test/api/a');
  const res = await handle(async () => { throw new ApiError(ERROR.NOT_FOUND, '없음'); }, req);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'NOT_FOUND');

  const dup = await handle(async () => { throw Object.assign(new Error('dup'), { code: '23505' }); }, req);
  assert.equal(dup.status, 409);
});

test('handle without req keeps legacy behaviour', async () => {
  const res = await handle(async () => ok({ ok: true }));
  assert.equal(res.status, 200);
});
