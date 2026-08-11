// 웹훅 → 구독 플랜 반영 판정 순수모듈 (build now, activate on approval).
// 실제 organizations.plan 반영은 BILLING_APPLY_LIVE=true + PAYMENTS_LIVE=true 승격 후에만 → [승인 필요].
// 이 모듈은 판정 로직만 담당한다(DB·네트워크 접근 없음 → 단위테스트 가능).
import type { PlanId } from './billing';

// 반영 활성 플래그. 기본 OFF — 'true' 문자열만 ON(오설정 '1'/'yes'는 OFF 유지).
export const BILLING_APPLY_LIVE = process.env.BILLING_APPLY_LIVE === 'true';

// checkout이 발급하는 paymentId 형식: pms_<planId>_<ts>_<hex>
const PAYMENT_ID_RE = /^pms_(basic|pro|enterprise)_\d+_[0-9a-f]+$/;

export function parsePaymentId(paymentId: unknown): PlanId | null {
  if (typeof paymentId !== 'string') return null;
  const m = PAYMENT_ID_RE.exec(paymentId);
  return m ? (m[1] as PlanId) : null;
}

// PG가 웹훅으로 되돌려주는 customData(체크아웃에서 발급). 조직 바인딩의 단일 소스.
export interface CheckoutCustomData { orgId: number; userId: number; planId: PlanId }

export function buildCustomData(d: CheckoutCustomData): string {
  return JSON.stringify({ orgId: d.orgId, userId: d.userId, planId: d.planId });
}

export function parseCustomData(raw: unknown): CheckoutCustomData | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const o = JSON.parse(raw);
    const orgId = Number(o?.orgId), userId = Number(o?.userId);
    const planId = String(o?.planId || '');
    if (!Number.isInteger(orgId) || orgId <= 0) return null;
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (planId !== 'basic' && planId !== 'pro' && planId !== 'enterprise') return null;
    return { orgId, userId, planId: planId as PlanId };
  } catch { return null; }
}

// 이벤트 타입 정규화: 'Transaction.Paid' | 'payment.paid' 등 → 'paid' / 'cancel' / 'fail' / 'other'
export function normalizeEventType(type: unknown): 'paid' | 'cancelled' | 'failed' | 'other' {
  const t = String(type ?? '').toLowerCase();
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('fail')) return 'failed';
  if (t.includes('paid') || t.includes('complete')) return 'paid';
  return 'other';
}

export interface WebhookDecisionInput {
  type: unknown;            // 원본 이벤트 타입
  paymentId: unknown;       // 원본 paymentId
  customData?: unknown;     // PG가 echo한 customData(JSON 문자열)
  verified: boolean;        // 서명 검증 통과 여부
  live: boolean;            // PAYMENTS_LIVE
  applyEnabled: boolean;    // BILLING_APPLY_LIVE
}

export type WebhookDecision =
  | { action: 'apply'; planId: PlanId; orgId: number; userId: number }
  | { action: 'ignore'; reason: string };

// 판정 규칙(순서 중요 — 안전 게이트 우선):
//  1) 서명 미검증이면 절대 반영하지 않는다.
//  2) 반영 플래그(BILLING_APPLY_LIVE)·실결제(PAYMENTS_LIVE) 둘 다 ON일 때만 반영. 기본 OFF → [승인 필요].
//  3) paid 계열 이벤트만 반영(취소·실패·기타는 무시 — 자동 다운그레이드 금지, 사람 개입).
//  4) paymentId 형식·customData(orgId·userId·planId) 검증, 두 planId 불일치 시 거부.
//  5) enterprise는 자동 반영 금지(도입 문의·수동 계약).
export function decideWebhookAction(input: WebhookDecisionInput): WebhookDecision {
  if (!input.verified) return { action: 'ignore', reason: 'unverified-signature' };
  if (!input.applyEnabled) return { action: 'ignore', reason: 'apply-disabled(approval-required)' };
  if (!input.live) return { action: 'ignore', reason: 'payments-not-live(approval-required)' };

  const kind = normalizeEventType(input.type);
  if (kind === 'cancelled') return { action: 'ignore', reason: 'cancel-requires-human(approval-required)' };
  if (kind !== 'paid') return { action: 'ignore', reason: `event-not-paid(${kind})` };

  const planFromId = parsePaymentId(input.paymentId);
  if (!planFromId) return { action: 'ignore', reason: 'invalid-payment-id' };

  const cd = parseCustomData(input.customData);
  if (!cd) return { action: 'ignore', reason: 'missing-or-invalid-custom-data' };
  if (cd.planId !== planFromId) return { action: 'ignore', reason: 'plan-mismatch' };
  if (cd.planId === 'enterprise') return { action: 'ignore', reason: 'enterprise-manual-only' };

  return { action: 'apply', planId: cd.planId, orgId: cd.orgId, userId: cd.userId };
}
