import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, PAYMENTS_LIVE } from '../src/lib/billing.ts';

test('exactly three plans: basic/pro/enterprise', () => {
  assert.equal(PLANS.length, 3);
  assert.deepEqual(PLANS.map((p) => p.id), ['basic', 'pro', 'enterprise']);
});

test('every plan has required display fields', () => {
  for (const p of PLANS) {
    assert.ok(p.name && p.price && p.desc && p.cta && p.href);
    assert.ok(Array.isArray(p.features) && p.features.length > 0);
  }
});

test('real payments are OFF by default (activation gated)', () => {
  assert.equal(PAYMENTS_LIVE, false);
});
