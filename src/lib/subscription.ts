// 구독 수명주기(빌링키 등록·정기청구·해지·환불) 판정 순수모듈.
// build now, activate on approval:
//  - 이 모듈은 계산·판정만 담당한다(DB·네트워크·next 의존 0 → 단위테스트 가능).
//  - 실제 빌링키 발급·정기청구·환불 실행은 PAYMENTS_LIVE=true + BILLING_APPLY_LIVE=true
//    승격 이후에만 가능하며, 기본값은 둘 다 OFF다. → [승인 필요]
import crypto from 'crypto';
import { PLANS, type PlanId } from './billing.ts';

/* ── 금액 ────────────────────────────────────────────────────────── */

// '₩9,900' → 9900, '견적'·빈값 → null(자동 청구 불가 플랜)
export function parsePriceKRW(price: unknown): number | null {
  if (typeof price !== 'string') return null;
  const digits = price.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function monthlyUnitPrice(planId: string): number | null {
  const p = PLANS.find((x) => x.id === planId);
  return p ? parsePriceKRW(p.price) : null;
}

// 좌석 수 기준 월 청구액. 자동청구 불가 플랜(enterprise)·잘못된 좌석 수는 null.
export function monthlyAmount(planId: string, seats: number): number | null {
  const unit = monthlyUnitPrice(planId);
  if (unit === null) return null;
  if (!Number.isInteger(seats) || seats <= 0 || seats > 100000) return null;
  return unit * seats;
}

/* ── 날짜 ────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

function toUTCDate(iso: unknown): Date | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function fmtDate(dt: Date): string { return dt.toISOString().slice(0, 10); }

// 말일 보정 월 가산: 2026-01-31 +1개월 → 2026-02-28
export function addMonthsClamped(iso: string, months: number): string | null {
  const dt = toUTCDate(iso);
  if (!dt || !Number.isInteger(months)) return null;
  const day = dt.getUTCDate();
  const base = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return fmtDate(base);
}

export function daysBetween(fromISO: string, toISO: string): number | null {
  const a = toUTCDate(fromISO), b = toUTCDate(toISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// 구독 시작일(anchor) 기준으로 asOf 이후 최초 청구일. asOf가 청구일 당일이면 그날을 반환.
export function nextBillingDate(anchorISO: string, asOfISO: string): string | null {
  const anchor = toUTCDate(anchorISO), asOf = toUTCDate(asOfISO);
  if (!anchor || !asOf) return null;
  if (asOf.getTime() <= anchor.getTime()) return fmtDate(anchor);
  let cur = anchorISO.slice(0, 10);
  // 월 단위로 전진(최대 1200개월 = 100년 방어).
  for (let i = 0; i < 1200; i++) {
    const next = addMonthsClamped(anchorISO, i);
    if (!next) return null;
    cur = next;
    if (toUTCDate(next)!.getTime() >= asOf.getTime()) return next;
  }
  return cur;
}

export interface BillingPeriod { start: string; end: string }

// asOf가 속한 청구 주기 [start, end) — end는 다음 청구일.
export function currentPeriod(anchorISO: string, asOfISO: string): BillingPeriod | null {
  const anchor = toUTCDate(anchorISO), asOf = toUTCDate(asOfISO);
  if (!anchor || !asOf) return null;
  if (asOf.getTime() < anchor.getTime()) return null;
  for (let i = 0; i < 1200; i++) {
    const start = addMonthsClamped(anchorISO, i);
    const end = addMonthsClamped(anchorISO, i + 1);
    if (!start || !end) return null;
    if (asOf.getTime() < toUTCDate(end)!.getTime()) return { start, end };
  }
  return null;
}

/* ── 환불(일할 계산) ─────────────────────────────────────────────── */

export interface RefundQuote {
  amount: number;        // 원 결제 금액
  periodDays: number;    // 주기 총 일수
  usedDays: number;      // 사용 일수
  remainDays: number;    // 잔여 일수
  refund: number;        // 환불 예정액(원 단위 절사)
  reason?: string;
}

// 일할 환불액 = 결제액 × 잔여일수 / 주기일수 (원 미만 절사, 음수 방지, 결제액 초과 방지).
export function refundQuote(input: { amount: unknown; period: BillingPeriod; cancelAt: string }): RefundQuote | { error: string } {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) return { error: 'invalid-amount' };
  const periodDays = daysBetween(input.period.start, input.period.end);
  if (periodDays === null || periodDays <= 0) return { error: 'invalid-period' };
  const used = daysBetween(input.period.start, input.cancelAt);
  if (used === null) return { error: 'invalid-cancel-date' };
  const usedDays = Math.min(Math.max(used, 0), periodDays);
  const remainDays = periodDays - usedDays;
  const refund = Math.min(amount, Math.floor((amount * remainDays) / periodDays));
  return { amount, periodDays, usedDays, remainDays, refund };
}

/* ── 게이트·판정 ─────────────────────────────────────────────────── */

export type SubscriptionAction = 'issue_billing_key' | 'delete_billing_key' | 'cancel' | 'resume' | 'refund';

const ACTIONS: SubscriptionAction[] = ['issue_billing_key', 'delete_billing_key', 'cancel', 'resume', 'refund'];

export function parseAction(raw: unknown): SubscriptionAction | null {
  const s = String(raw ?? '');
  return (ACTIONS as string[]).includes(s) ? (s as SubscriptionAction) : null;
}

export interface GateInput {
  action: SubscriptionAction;
  live: boolean;          // PAYMENTS_LIVE
  applyEnabled: boolean;  // BILLING_APPLY_LIVE
  isOrgAdmin: boolean;
  planId?: string;
}

export type GateDecision =
  | { mode: 'execute' }
  | { mode: 'scaffold'; reason: string }
  | { mode: 'deny'; reason: string };

// 판정 규칙(순서 중요 — 안전 게이트 우선):
//  1) 조직 관리자만 구독을 변경할 수 있다.
//  2) enterprise는 수동 계약 → 자동 빌링키·정기청구 대상 아님.
//  3) 실행(execute)은 PAYMENTS_LIVE·BILLING_APPLY_LIVE 둘 다 ON일 때만. 기본 OFF → scaffold.
//     scaffold 는 어떤 외부 호출·DB 변경도 하지 않고 파라미터·견적만 돌려준다.
export function gateSubscriptionAction(input: GateInput): GateDecision {
  if (!input.isOrgAdmin) return { mode: 'deny', reason: 'org-admin-required' };
  const needsPlan = input.action === 'issue_billing_key' || input.action === 'resume';
  if (needsPlan && input.planId === 'enterprise') return { mode: 'deny', reason: 'enterprise-manual-only' };
  if (needsPlan && input.planId && monthlyUnitPrice(input.planId) === null) {
    return { mode: 'deny', reason: 'plan-not-auto-billable' };
  }
  if (!input.live) return { mode: 'scaffold', reason: 'payments-not-live(approval-required)' };
  if (!input.applyEnabled) return { mode: 'scaffold', reason: 'apply-disabled(approval-required)' };
  return { mode: 'execute' };
}

// 해지 정책: 즉시 해지는 잔여기간 환불을 동반하므로 사람 승인 대상.
// 기본은 '주기 종료 시 해지'(period_end) — 데이터 접근을 즉시 끊지 않는다.
export type CancelMode = 'period_end' | 'immediate';

export function parseCancelMode(raw: unknown): CancelMode {
  return String(raw ?? '') === 'immediate' ? 'immediate' : 'period_end';
}

export interface CancelPlan {
  mode: CancelMode;
  effectiveAt: string;     // 서비스 종료 예정일
  refundExpected: boolean; // 환불 발생 여부
  note: string;
}

export function planCancellation(mode: CancelMode, period: BillingPeriod, asOfISO: string): CancelPlan | { error: string } {
  if (daysBetween(period.start, period.end) === null) return { error: 'invalid-period' };
  if (toUTCDate(asOfISO) === null) return { error: 'invalid-date' };
  if (mode === 'immediate') {
    return {
      mode, effectiveAt: asOfISO.slice(0, 10), refundExpected: true,
      note: '즉시 해지 — 잔여 기간 일할 환불이 발생합니다. 환불 실행은 [승인 필요].',
    };
  }
  return {
    mode, effectiveAt: period.end, refundExpected: false,
    note: '현재 청구 주기 종료일에 해지됩니다. 그때까지 서비스는 그대로 이용할 수 있습니다.',
  };
}

/* ── 식별자 ──────────────────────────────────────────────────────── */

// 빌링키 발급 요청 식별자(멱등키). 실제 빌링키 값은 서버가 PG에서 받아 저장하며 절대 클라이언트로 내보내지 않는다.
export function newBillingKeyIssueId(orgId: number): string {
  const safe = Number.isInteger(orgId) && orgId > 0 ? orgId : 0;
  return `bk_${safe}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

export const BILLING_KEY_ISSUE_ID_RE = /^bk_\d+_\d+_[0-9a-f]{12}$/;

// 저장된 빌링키의 화면 표시용 마스킹(뒤 4자리만 노출).
export function maskBillingKey(key: unknown): string {
  const s = typeof key === 'string' ? key : '';
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

/* ── 요약(화면용) ────────────────────────────────────────────────── */

export interface SubscriptionSummary {
  planId: string;
  planName: string;
  seats: number;
  unitPrice: number | null;
  amount: number | null;
  autoBillable: boolean;
  period: BillingPeriod | null;
  nextChargeAt: string | null;
}

export function summarizeSubscription(input: { planId: string; seats: number; anchorISO: string; asOfISO: string }): SubscriptionSummary {
  const plan = PLANS.find((p) => p.id === input.planId);
  const unitPrice = monthlyUnitPrice(input.planId);
  const period = currentPeriod(input.anchorISO, input.asOfISO);
  return {
    planId: input.planId,
    planName: plan?.name ?? input.planId,
    seats: input.seats,
    unitPrice,
    amount: monthlyAmount(input.planId, input.seats),
    autoBillable: unitPrice !== null,
    period,
    nextChargeAt: period ? period.end : null,
  };
}

export type { PlanId };
