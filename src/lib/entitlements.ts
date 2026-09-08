// 요금제별 기능 제한(엔타이틀먼트) 단일 소스 — 순수 모듈(DB·환경 의존 없음).
//
// build now, activate on approval:
//  - 기본은 **관측 모드**(ENTITLEMENTS_ENFORCE 미설정) — 판정 결과만 돌려주고 실제로 막지 않는다.
//  - ENTITLEMENTS_ENFORCE=true 로 설정해야 강제(차단)가 켜진다. [활성화 승인 필요]
// 정책은 전부 이 파일의 상수로 두어, 화면·API가 각자 하드코딩하지 않도록 한다.

import { PLANS, type PlanId } from './billing.ts';

export type FeatureId =
  | 'core'          // 프로젝트·단계·WBS·이슈·리스크·기본 뷰
  | 'evm'           // EVM 성과관리(SPI·CPI·PV·EV·AC)
  | 'rtm'           // 요구사항 추적
  | 'approval'      // 산출물 전자결재
  | 'testMgmt'      // 테스트 관리·실행 리포트
  | 'ganttAdvanced' // 베이스라인·임계경로·의존성
  | 'customForms'   // 커스텀 산출물 양식
  | 'auditLog'      // 상세 감사로그 열람
  | 'sso'           // SSO
  | 'apiAccess';    // 외부 API 연동

export interface FeatureMeta { id: FeatureId; label: string; minPlan: PlanId }

// 기능별 최소 요구 플랜. 표시 문구는 pricing 카드(billing.ts)와 의미가 어긋나지 않게 유지한다.
export const FEATURES: FeatureMeta[] = [
  { id: 'core', label: '프로젝트·WBS·이슈·리스크', minPlan: 'basic' },
  { id: 'evm', label: 'EVM 성과관리', minPlan: 'pro' },
  { id: 'rtm', label: '요구사항 추적(RTM)', minPlan: 'pro' },
  { id: 'approval', label: '산출물 전자결재', minPlan: 'pro' },
  { id: 'testMgmt', label: '테스트 관리·실행 리포트', minPlan: 'pro' },
  { id: 'ganttAdvanced', label: '인터랙티브 간트(베이스라인·임계경로)', minPlan: 'pro' },
  { id: 'customForms', label: '커스텀 산출물 양식', minPlan: 'pro' },
  { id: 'auditLog', label: '상세 감사로그 열람', minPlan: 'enterprise' },
  { id: 'sso', label: 'SSO', minPlan: 'enterprise' },
  { id: 'apiAccess', label: '외부 API 연동', minPlan: 'enterprise' },
];

// 플랜 서열. 높을수록 상위.
const PLAN_RANK: Record<PlanId, number> = { basic: 1, pro: 2, enterprise: 3 };

// 좌석 상한(멤버십 수 기준). null = 무제한.
export const SEAT_LIMIT: Record<PlanId, number | null> = { basic: 10, pro: 100, enterprise: null };

const KNOWN_PLANS = new Set<string>(PLANS.map((p) => p.id));

/** 조직에 저장된 plan 문자열을 알려진 PlanId로 정규화한다. 미지/누락은 basic(최소 권한). */
export function resolvePlan(raw: unknown): PlanId {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (KNOWN_PLANS.has(v)) return v as PlanId;
  // 과거 데이터 호환: free/trial 은 basic 취급, team/business 는 pro 취급.
  if (v === 'free' || v === 'trial' || v === '') return 'basic';
  if (v === 'team' || v === 'business') return 'pro';
  return 'basic';
}

export function planRank(plan: unknown): number { return PLAN_RANK[resolvePlan(plan)]; }

export function featureMeta(feature: unknown): FeatureMeta | null {
  return FEATURES.find((f) => f.id === feature) ?? null;
}

/** 해당 플랜이 기능을 쓸 수 있는가. 미지의 기능 id는 false(기본 거부). */
export function hasFeature(plan: unknown, feature: unknown): boolean {
  const meta = featureMeta(feature);
  if (!meta) return false;
  return planRank(plan) >= PLAN_RANK[meta.minPlan];
}

/** 플랜이 쓸 수 있는 기능 id 목록. */
export function featuresFor(plan: unknown): FeatureId[] {
  return FEATURES.filter((f) => hasFeature(plan, f.id)).map((f) => f.id);
}

export function seatLimit(plan: unknown): number | null { return SEAT_LIMIT[resolvePlan(plan)]; }

export interface SeatUsage {
  plan: PlanId;
  used: number;
  limit: number | null;
  remaining: number | null; // 무제한이면 null
  exceeded: boolean;        // 이미 상한 초과
  canAddOne: boolean;       // 1명 더 추가 가능한가
}

/** 좌석 사용 현황. used 가 음수·비정수면 0으로 본다. */
export function seatUsage(plan: unknown, used: unknown): SeatUsage {
  const p = resolvePlan(plan);
  const n = Number.isFinite(used as number) ? Math.max(0, Math.floor(used as number)) : 0;
  const limit = SEAT_LIMIT[p];
  if (limit === null) return { plan: p, used: n, limit: null, remaining: null, exceeded: false, canAddOne: true };
  return { plan: p, used: n, limit, remaining: Math.max(0, limit - n), exceeded: n > limit, canAddOne: n < limit };
}

export type DenyReason = 'plan_required' | 'seat_limit' | 'unknown_feature';

export interface EntitlementDecision {
  allowed: boolean;          // 강제 모드에서 통과 여부(관측 모드에서도 판정값은 동일)
  enforced: boolean;         // 실제로 차단할 것인지(강제 스위치 ON일 때만 true)
  reason: DenyReason | null;
  requiredPlan: PlanId | null;
  message: string | null;
}

const ALLOW: EntitlementDecision = { allowed: true, enforced: false, reason: null, requiredPlan: null, message: null };

/**
 * 기능 접근 판정. enforce=false(기본)면 판정 결과만 담고 enforced=false 로 돌려준다 —
 * 호출부는 enforced 가 true 일 때만 실제로 거절해야 한다.
 */
export function checkFeature(input: { plan: unknown; feature: unknown; enforce?: boolean }): EntitlementDecision {
  const enforce = input.enforce === true;
  const meta = featureMeta(input.feature);
  if (!meta) {
    return { allowed: false, enforced: enforce, reason: 'unknown_feature', requiredPlan: null, message: '알 수 없는 기능입니다' };
  }
  if (hasFeature(input.plan, meta.id)) return ALLOW;
  const planName = PLANS.find((p) => p.id === meta.minPlan)?.name ?? meta.minPlan;
  return {
    allowed: false,
    enforced: enforce,
    reason: 'plan_required',
    requiredPlan: meta.minPlan,
    message: `${meta.label} 기능은 ${planName} 플랜부터 사용할 수 있습니다`,
  };
}

/** 멤버 1명 추가 가능 여부 판정. */
export function checkSeat(input: { plan: unknown; used: unknown; enforce?: boolean }): EntitlementDecision {
  const enforce = input.enforce === true;
  const usage = seatUsage(input.plan, input.used);
  if (usage.canAddOne) return ALLOW;
  const next = usage.plan === 'basic' ? 'pro' : usage.plan === 'pro' ? 'enterprise' : null;
  return {
    allowed: false,
    enforced: enforce,
    reason: 'seat_limit',
    requiredPlan: next,
    message: `현재 플랜의 좌석 한도(${usage.limit}명)를 모두 사용했습니다`,
  };
}

export interface EntitlementSummary {
  plan: PlanId;
  enforced: boolean;
  seats: SeatUsage;
  features: { id: FeatureId; label: string; minPlan: PlanId; enabled: boolean }[];
}

/** 화면·API 노출용 요약(시크릿 없음). */
export function summarizeEntitlements(input: { plan: unknown; seatsUsed: unknown; enforce?: boolean }): EntitlementSummary {
  const plan = resolvePlan(input.plan);
  return {
    plan,
    enforced: input.enforce === true,
    seats: seatUsage(plan, input.seatsUsed),
    features: FEATURES.map((f) => ({ id: f.id, label: f.label, minPlan: f.minPlan, enabled: hasFeature(plan, f.id) })),
  };
}
