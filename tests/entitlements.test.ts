import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES, SEAT_LIMIT, resolvePlan, planRank, hasFeature, featuresFor,
  seatLimit, seatUsage, checkFeature, checkSeat, summarizeEntitlements,
} from '../src/lib/entitlements.ts';
import { PLANS } from '../src/lib/billing.ts';

test('resolvePlan normalizes known/legacy/unknown values', () => {
  assert.equal(resolvePlan('pro'), 'pro');
  assert.equal(resolvePlan(' ENTERPRISE '), 'enterprise');
  assert.equal(resolvePlan('free'), 'basic');
  assert.equal(resolvePlan('trial'), 'basic');
  assert.equal(resolvePlan('team'), 'pro');
  assert.equal(resolvePlan('business'), 'pro');
  // 미지·누락은 최소 권한(basic)으로 떨어진다
  assert.equal(resolvePlan('platinum'), 'basic');
  assert.equal(resolvePlan(undefined), 'basic');
  assert.equal(resolvePlan(null), 'basic');
  assert.equal(resolvePlan(42), 'basic');
});

test('plan rank is strictly increasing', () => {
  assert.ok(planRank('basic') < planRank('pro'));
  assert.ok(planRank('pro') < planRank('enterprise'));
});

test('every feature minPlan is a real plan id', () => {
  const ids = new Set(PLANS.map((p) => p.id));
  for (const f of FEATURES) {
    assert.ok(ids.has(f.minPlan), `${f.id} minPlan invalid`);
    assert.ok(f.label.length > 0);
  }
  assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length);
});

test('hasFeature gates by plan rank, unknown feature denied', () => {
  assert.equal(hasFeature('basic', 'core'), true);
  assert.equal(hasFeature('basic', 'evm'), false);
  assert.equal(hasFeature('pro', 'evm'), true);
  assert.equal(hasFeature('pro', 'sso'), false);
  assert.equal(hasFeature('enterprise', 'sso'), true);
  assert.equal(hasFeature('enterprise', 'nope'), false);
  assert.equal(hasFeature('basic', undefined), false);
});

test('featuresFor is monotonic across plans', () => {
  const b = featuresFor('basic'), p = featuresFor('pro'), e = featuresFor('enterprise');
  for (const f of b) assert.ok(p.includes(f));
  for (const f of p) assert.ok(e.includes(f));
  assert.equal(e.length, FEATURES.length);
  assert.ok(b.length < p.length && p.length < e.length);
});

test('seat limits: enterprise unlimited, others bounded', () => {
  assert.equal(seatLimit('basic'), SEAT_LIMIT.basic);
  assert.equal(seatLimit('enterprise'), null);
  assert.ok((SEAT_LIMIT.basic as number) < (SEAT_LIMIT.pro as number));
});

test('seatUsage computes remaining/exceeded and sanitizes input', () => {
  const u = seatUsage('basic', 3);
  assert.equal(u.used, 3);
  assert.equal(u.remaining, (SEAT_LIMIT.basic as number) - 3);
  assert.equal(u.exceeded, false);
  assert.equal(u.canAddOne, true);

  const full = seatUsage('basic', SEAT_LIMIT.basic as number);
  assert.equal(full.canAddOne, false);
  assert.equal(full.exceeded, false); // 정확히 한도면 초과는 아님
  assert.equal(full.remaining, 0);

  const over = seatUsage('basic', (SEAT_LIMIT.basic as number) + 5);
  assert.equal(over.exceeded, true);
  assert.equal(over.remaining, 0);

  const bad = seatUsage('basic', -7);
  assert.equal(bad.used, 0);
  assert.equal(seatUsage('basic', 2.9).used, 2);
  assert.equal(seatUsage('basic', NaN).used, 0);
  assert.equal(seatUsage('basic', 'x').used, 0);

  const ent = seatUsage('enterprise', 99999);
  assert.equal(ent.limit, null);
  assert.equal(ent.remaining, null);
  assert.equal(ent.canAddOne, true);
});

test('checkFeature: allowed passes, denial carries required plan and message', () => {
  const okD = checkFeature({ plan: 'pro', feature: 'evm', enforce: true });
  assert.equal(okD.allowed, true);
  assert.equal(okD.enforced, false);
  assert.equal(okD.reason, null);

  const deny = checkFeature({ plan: 'basic', feature: 'evm', enforce: true });
  assert.equal(deny.allowed, false);
  assert.equal(deny.enforced, true);
  assert.equal(deny.reason, 'plan_required');
  assert.equal(deny.requiredPlan, 'pro');
  assert.ok((deny.message ?? '').includes('Pro'));

  const unknown = checkFeature({ plan: 'enterprise', feature: 'ghost' });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.reason, 'unknown_feature');
});

test('default is observe-only: enforce omitted never blocks', () => {
  const d = checkFeature({ plan: 'basic', feature: 'sso' });
  assert.equal(d.allowed, false);
  assert.equal(d.enforced, false); // 관측 모드 — 호출부는 막지 않아야 한다
  const s = checkSeat({ plan: 'basic', used: 999 });
  assert.equal(s.allowed, false);
  assert.equal(s.enforced, false);
});

test('checkSeat suggests the next plan up, enterprise never blocked', () => {
  const b = checkSeat({ plan: 'basic', used: SEAT_LIMIT.basic as number, enforce: true });
  assert.equal(b.allowed, false);
  assert.equal(b.reason, 'seat_limit');
  assert.equal(b.requiredPlan, 'pro');

  const p = checkSeat({ plan: 'pro', used: SEAT_LIMIT.pro as number, enforce: true });
  assert.equal(p.requiredPlan, 'enterprise');

  const e = checkSeat({ plan: 'enterprise', used: 100000, enforce: true });
  assert.equal(e.allowed, true);
});

test('summarizeEntitlements exposes only display-safe fields', () => {
  const s = summarizeEntitlements({ plan: 'pro', seatsUsed: 4, enforce: false });
  assert.equal(s.plan, 'pro');
  assert.equal(s.enforced, false);
  assert.equal(s.seats.used, 4);
  assert.equal(s.features.length, FEATURES.length);
  assert.equal(s.features.find((f) => f.id === 'evm')?.enabled, true);
  assert.equal(s.features.find((f) => f.id === 'sso')?.enabled, false);
  const json = JSON.stringify(s);
  assert.ok(!/secret|token|key=/i.test(json));
});
