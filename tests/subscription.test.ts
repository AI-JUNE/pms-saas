import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceKRW, monthlyUnitPrice, monthlyAmount,
  addMonthsClamped, daysBetween, nextBillingDate, currentPeriod,
  refundQuote, parseAction, gateSubscriptionAction,
  parseCancelMode, planCancellation,
  newBillingKeyIssueId, BILLING_KEY_ISSUE_ID_RE, maskBillingKey,
  summarizeSubscription,
} from '../src/lib/subscription.ts';

test('parsePriceKRW: 통화·구분자 제거, 견적은 null', () => {
  assert.equal(parsePriceKRW('₩9,900'), 9900);
  assert.equal(parsePriceKRW('₩16,900'), 16900);
  assert.equal(parsePriceKRW('견적'), null);
  assert.equal(parsePriceKRW(''), null);
  assert.equal(parsePriceKRW(undefined), null);
});

test('monthlyUnitPrice / monthlyAmount: enterprise·잘못된 좌석수는 null', () => {
  assert.equal(monthlyUnitPrice('basic'), 9900);
  assert.equal(monthlyUnitPrice('enterprise'), null);
  assert.equal(monthlyUnitPrice('nope'), null);
  assert.equal(monthlyAmount('pro', 3), 50700);
  assert.equal(monthlyAmount('pro', 0), null);
  assert.equal(monthlyAmount('pro', 1.5), null);
  assert.equal(monthlyAmount('enterprise', 3), null);
});

test('addMonthsClamped: 말일 보정', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29'); // 윤년
  assert.equal(addMonthsClamped('2026-03-15', 12), '2027-03-15');
  assert.equal(addMonthsClamped('2026-12-31', 1), '2027-01-31');
  assert.equal(addMonthsClamped('bad', 1), null);
  assert.equal(addMonthsClamped('2026-02-30', 1), null); // 존재하지 않는 날짜
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-01-01', '2026-02-01'), 31);
  assert.equal(daysBetween('2026-02-01', '2026-01-01'), -31);
  assert.equal(daysBetween('2026-01-01', 'x'), null);
});

test('nextBillingDate: anchor 이전이면 anchor, 이후면 다음 청구일', () => {
  assert.equal(nextBillingDate('2026-01-10', '2025-12-01'), '2026-01-10');
  assert.equal(nextBillingDate('2026-01-10', '2026-01-10'), '2026-01-10');
  assert.equal(nextBillingDate('2026-01-10', '2026-01-11'), '2026-02-10');
  assert.equal(nextBillingDate('2026-01-31', '2026-02-01'), '2026-02-28');
});

test('currentPeriod: asOf가 속한 주기 [start,end)', () => {
  assert.deepEqual(currentPeriod('2026-01-10', '2026-01-10'), { start: '2026-01-10', end: '2026-02-10' });
  assert.deepEqual(currentPeriod('2026-01-10', '2026-02-09'), { start: '2026-01-10', end: '2026-02-10' });
  assert.deepEqual(currentPeriod('2026-01-10', '2026-02-10'), { start: '2026-02-10', end: '2026-03-10' });
  assert.equal(currentPeriod('2026-01-10', '2025-12-31'), null);
});

test('refundQuote: 일할 계산·절사·경계', () => {
  const period = { start: '2026-01-01', end: '2026-02-01' }; // 31일
  const q = refundQuote({ amount: 31000, period, cancelAt: '2026-01-11' }) as any;
  assert.equal(q.periodDays, 31);
  assert.equal(q.usedDays, 10);
  assert.equal(q.remainDays, 21);
  assert.equal(q.refund, 21000);
  // 주기 시작 전 취소 → 전액, 종료 후 → 0
  assert.equal((refundQuote({ amount: 31000, period, cancelAt: '2025-12-20' }) as any).refund, 31000);
  assert.equal((refundQuote({ amount: 31000, period, cancelAt: '2026-03-01' }) as any).refund, 0);
  // 절사(내림) 확인: 9900 × 21/31 = 6706.45…
  assert.equal((refundQuote({ amount: 9900, period, cancelAt: '2026-01-11' }) as any).refund, 6706);
  assert.deepEqual(refundQuote({ amount: 'x', period, cancelAt: '2026-01-11' }), { error: 'invalid-amount' });
  assert.deepEqual(refundQuote({ amount: -1, period, cancelAt: '2026-01-11' }), { error: 'invalid-amount' });
  assert.deepEqual(refundQuote({ amount: 100, period: { start: '2026-02-01', end: '2026-01-01' }, cancelAt: '2026-01-11' }), { error: 'invalid-period' });
  assert.deepEqual(refundQuote({ amount: 100, period, cancelAt: 'nope' }), { error: 'invalid-cancel-date' });
});

test('parseAction: 화이트리스트 외 거부', () => {
  assert.equal(parseAction('cancel'), 'cancel');
  assert.equal(parseAction('issue_billing_key'), 'issue_billing_key');
  assert.equal(parseAction('drop_table'), null);
  assert.equal(parseAction(undefined), null);
});

test('gateSubscriptionAction: 기본은 scaffold, 둘 다 ON일 때만 execute', () => {
  const base = { action: 'cancel' as const, isOrgAdmin: true, planId: 'pro' };
  assert.deepEqual(gateSubscriptionAction({ ...base, live: false, applyEnabled: false }),
    { mode: 'scaffold', reason: 'payments-not-live(approval-required)' });
  assert.deepEqual(gateSubscriptionAction({ ...base, live: true, applyEnabled: false }),
    { mode: 'scaffold', reason: 'apply-disabled(approval-required)' });
  assert.deepEqual(gateSubscriptionAction({ ...base, live: true, applyEnabled: true }), { mode: 'execute' });
});

test('gateSubscriptionAction: 관리자 아님·enterprise·비청구 플랜은 deny', () => {
  assert.deepEqual(
    gateSubscriptionAction({ action: 'cancel', isOrgAdmin: false, live: true, applyEnabled: true, planId: 'pro' }),
    { mode: 'deny', reason: 'org-admin-required' });
  assert.deepEqual(
    gateSubscriptionAction({ action: 'issue_billing_key', isOrgAdmin: true, live: false, applyEnabled: false, planId: 'enterprise' }),
    { mode: 'deny', reason: 'enterprise-manual-only' });
  assert.deepEqual(
    gateSubscriptionAction({ action: 'issue_billing_key', isOrgAdmin: true, live: false, applyEnabled: false, planId: 'free' }),
    { mode: 'deny', reason: 'plan-not-auto-billable' });
  // 해지·환불은 플랜 제약 없이 게이트만 적용
  assert.equal(gateSubscriptionAction({ action: 'refund', isOrgAdmin: true, live: false, applyEnabled: false, planId: 'free' }).mode, 'scaffold');
});

test('해지 정책: 기본은 주기 종료, 즉시 해지만 환불 동반', () => {
  assert.equal(parseCancelMode('immediate'), 'immediate');
  assert.equal(parseCancelMode('anything'), 'period_end');
  assert.equal(parseCancelMode(undefined), 'period_end');
  const period = { start: '2026-01-01', end: '2026-02-01' };
  const a = planCancellation('period_end', period, '2026-01-11') as any;
  assert.equal(a.effectiveAt, '2026-02-01');
  assert.equal(a.refundExpected, false);
  const b = planCancellation('immediate', period, '2026-01-11') as any;
  assert.equal(b.effectiveAt, '2026-01-11');
  assert.equal(b.refundExpected, true);
  assert.deepEqual(planCancellation('period_end', { start: 'x', end: 'y' }, '2026-01-11'), { error: 'invalid-period' });
});

test('빌링키 식별자·마스킹', () => {
  const id = newBillingKeyIssueId(7);
  assert.match(id, BILLING_KEY_ISSUE_ID_RE);
  assert.match(newBillingKeyIssueId(-1), /^bk_0_/);
  assert.notEqual(newBillingKeyIssueId(7), newBillingKeyIssueId(7));
  assert.equal(maskBillingKey('billing-key-abcd1234'), '••••1234');
  assert.equal(maskBillingKey('ab'), '••••');
  assert.equal(maskBillingKey(null), '');
});

test('summarizeSubscription: 화면 요약', () => {
  const s = summarizeSubscription({ planId: 'pro', seats: 4, anchorISO: '2026-01-10', asOfISO: '2026-02-01' });
  assert.equal(s.planName, 'Pro');
  assert.equal(s.unitPrice, 16900);
  assert.equal(s.amount, 67600);
  assert.equal(s.autoBillable, true);
  assert.deepEqual(s.period, { start: '2026-01-10', end: '2026-02-10' });
  assert.equal(s.nextChargeAt, '2026-02-10');
  const f = summarizeSubscription({ planId: 'free', seats: 1, anchorISO: '2026-01-10', asOfISO: '2026-02-01' });
  assert.equal(f.autoBillable, false);
  assert.equal(f.amount, null);
});
