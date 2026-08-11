import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_APPLY_LIVE, parsePaymentId, parseCustomData, buildCustomData,
  normalizeEventType, decideWebhookAction,
} from '../src/lib/billingWebhook.ts';

test('plan apply is OFF by default (activation gated)', () => {
  assert.equal(BILLING_APPLY_LIVE, false);
});

test('parsePaymentId: valid checkout format only', () => {
  assert.equal(parsePaymentId('pms_pro_1723400000000_a1b2c3'), 'pro');
  assert.equal(parsePaymentId('pms_basic_1_00ff'), 'basic');
  assert.equal(parsePaymentId('pms_free_1_00ff'), null);
  assert.equal(parsePaymentId('evil_pro_1_00ff'), null);
  assert.equal(parsePaymentId(''), null);
  assert.equal(parsePaymentId(null), null);
  assert.equal(parsePaymentId('pms_pro_1_ZZZZ'), null);
});

test('customData roundtrip + rejects malformed', () => {
  const raw = buildCustomData({ orgId: 7, userId: 3, planId: 'pro' });
  assert.deepEqual(parseCustomData(raw), { orgId: 7, userId: 3, planId: 'pro' });
  assert.equal(parseCustomData('not-json'), null);
  assert.equal(parseCustomData(''), null);
  assert.equal(parseCustomData(undefined), null);
  assert.equal(parseCustomData(JSON.stringify({ orgId: 0, userId: 1, planId: 'pro' })), null);
  assert.equal(parseCustomData(JSON.stringify({ orgId: 7, userId: 3, planId: 'vip' })), null);
});

test('normalizeEventType', () => {
  assert.equal(normalizeEventType('Transaction.Paid'), 'paid');
  assert.equal(normalizeEventType('payment.completed'), 'paid');
  assert.equal(normalizeEventType('Transaction.Cancelled'), 'cancelled');
  assert.equal(normalizeEventType('Transaction.Failed'), 'failed');
  assert.equal(normalizeEventType('ping'), 'other');
  assert.equal(normalizeEventType(undefined), 'other');
});

const base = {
  type: 'Transaction.Paid',
  paymentId: 'pms_pro_1723400000000_a1b2c3',
  customData: buildCustomData({ orgId: 7, userId: 3, planId: 'pro' }),
  verified: true, live: true, applyEnabled: true,
};

test('never applies without verified signature', () => {
  const d = decideWebhookAction({ ...base, verified: false });
  assert.equal(d.action, 'ignore');
  assert.match((d as any).reason, /unverified/);
});

test('never applies while flags are OFF (approval-required)', () => {
  let d = decideWebhookAction({ ...base, applyEnabled: false });
  assert.equal(d.action, 'ignore');
  assert.match((d as any).reason, /approval-required/);
  d = decideWebhookAction({ ...base, live: false });
  assert.equal(d.action, 'ignore');
  assert.match((d as any).reason, /approval-required/);
});

test('cancel/fail/other events never auto-apply', () => {
  for (const type of ['Transaction.Cancelled', 'Transaction.Failed', 'ping']) {
    const d = decideWebhookAction({ ...base, type });
    assert.equal(d.action, 'ignore');
  }
});

test('invalid paymentId / customData / plan mismatch are rejected', () => {
  assert.equal(decideWebhookAction({ ...base, paymentId: 'bogus' }).action, 'ignore');
  assert.equal(decideWebhookAction({ ...base, customData: undefined }).action, 'ignore');
  const mismatch = decideWebhookAction({ ...base, customData: buildCustomData({ orgId: 7, userId: 3, planId: 'basic' }) });
  assert.equal(mismatch.action, 'ignore');
  assert.match((mismatch as any).reason, /plan-mismatch/);
});

test('enterprise is never auto-applied', () => {
  const d = decideWebhookAction({
    ...base,
    paymentId: 'pms_enterprise_1723400000000_a1b2c3',
    customData: buildCustomData({ orgId: 7, userId: 3, planId: 'enterprise' }),
  });
  assert.equal(d.action, 'ignore');
  assert.match((d as any).reason, /enterprise/);
});

test('applies only when everything is valid AND both flags ON', () => {
  const d = decideWebhookAction(base);
  assert.deepEqual(d, { action: 'apply', planId: 'pro', orgId: 7, userId: 3 });
});
