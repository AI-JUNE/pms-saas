// 요금제 카드 문구(billing.ts PLANS.features)와 실제 엔타이틀먼트 정책(entitlements.ts)의
// **정합성 단일 소스** — 순수 모듈(DB·환경 의존은 아래 env 로더 1개뿐).
//
// 왜 필요한가: 가격 페이지는 마케팅 문구, 차단 판정은 FEATURES/SEAT_LIMIT 가 한다.
// 두 곳이 어긋나면 "결제했는데 못 쓰는" 또는 "약속하지 않은 걸 열어주는" 상용 사고가 된다.
// 여기서 문구 ↔ 기능 id 를 명시적으로 묶고, 테스트가 매번 대조한다.
//
// build now, activate on approval:
//  - 무료 체험 좌석 수는 **env `PRICING_FREE_TRIAL_SEATS` 만 인정**한다. 미설정이면 문구를 만들지 않는다.
//    (코드·화면에 임의 좌석 수를 넣지 않는다 — 근거 없는 상용 약속 금지)

import { PLANS, type PlanId } from './billing.ts';
import { FEATURES, SEAT_LIMIT, hasFeature, type FeatureId } from './entitlements.ts';

/** 문구 한 줄이 무엇을 약속하는가. */
export type ClaimKind =
  | 'feature'      // 기능 게이팅으로 검증 가능
  | 'inherit'      // "Basic 전체 포함" 류 — 하위 플랜 기능 승계
  | 'unverifiable'; // 계약·운영 조건(SLA·조달·전용 인프라) — 코드로 검증 불가, 사람 확인 몫

export interface ClaimSpec {
  kind: ClaimKind;
  /** kind==='feature' 일 때 이 문구가 약속하는 기능 id(복수 가능). */
  features?: FeatureId[];
  /** kind==='inherit' 일 때 승계 대상 플랜. */
  inheritsFrom?: PlanId;
}

/**
 * 문구 → 약속 내용 레지스트리. **카드 문구를 바꾸면 여기도 바꿔야 한다**(테스트가 미등록 문구를 막는다).
 * 'unverifiable' 은 코드가 보증하지 않는 계약 조건이라는 뜻이며, 실제 이행은 사람 몫이다.
 */
export const CLAIM_REGISTRY: Record<string, ClaimSpec> = {
  // Basic
  '프로젝트·단계·WBS': { kind: 'feature', features: ['core'] },
  '이슈/결함·리스크': { kind: 'feature', features: ['core'] },
  '기본 간트·칸반·캘린더': { kind: 'feature', features: ['core'] },
  '멤버·권한(RBAC)': { kind: 'feature', features: ['core'] },
  // Pro
  'Basic 전체 포함': { kind: 'inherit', inheritsFrom: 'basic' },
  'EVM 성과관리(SPI·CPI·PV·EV·AC)': { kind: 'feature', features: ['evm'] },
  '요구사항 추적(RTM)·산출물 전자결재': { kind: 'feature', features: ['rtm', 'approval'] },
  '테스트 관리·실행 리포트': { kind: 'feature', features: ['testMgmt'] },
  '인터랙티브 간트(베이스라인·임계경로·의존성)': { kind: 'feature', features: ['ganttAdvanced'] },
  '대시보드 집계·주간보고·⌘K 전역검색': { kind: 'feature', features: ['core'] },
  // Enterprise
  'Pro 전체 포함': { kind: 'inherit', inheritsFrom: 'pro' },
  'SSO·상세 감사로그·데이터 접근 통제': { kind: 'feature', features: ['sso', 'auditLog'] },
  '전용 DB·전용 리전·온프레미스 옵션': { kind: 'unverifiable' },
  '전담 지원·SLA·교육': { kind: 'unverifiable' },
  '공공 조달(GS인증·CSAP) 대응': { kind: 'unverifiable' },
};

export function claimSpec(text: unknown): ClaimSpec | null {
  const k = typeof text === 'string' ? text.trim() : '';
  return Object.prototype.hasOwnProperty.call(CLAIM_REGISTRY, k) ? CLAIM_REGISTRY[k] : null;
}

export type ClaimIssueCode =
  | 'unmapped'       // 레지스트리에 없는 문구 — 무엇을 약속하는지 불명
  | 'over_promised'  // 상위 플랜 전용 기능을 이 플랜 카드가 약속
  | 'bad_inherit';   // 승계 대상이 실제로 상위 플랜(또는 자기 자신)

export interface ClaimIssue {
  plan: PlanId;
  claim: string;
  code: ClaimIssueCode;
  feature?: FeatureId;
  message: string;
}

export interface ClaimAudit {
  issues: ClaimIssue[];
  /** 코드가 보증하지 않는 문구(계약·운영 조건) — 사람 확인 필요. */
  unverifiable: { plan: PlanId; claim: string }[];
  /** 플랜이 쓸 수 있는데 카드에 안 적힌 기능 — 정보성(과장이 아니므로 issue 아님). */
  unclaimed: { plan: PlanId; feature: FeatureId; label: string }[];
}

const RANK: Record<PlanId, number> = { basic: 1, pro: 2, enterprise: 3 };

/**
 * 가격표 문구 ↔ 엔타이틀먼트 대조. **과장(over_promise)만 오류로 본다** —
 * 카드에 안 적힌 기능을 더 주는 것은 상용 사고가 아니라 정보 누락이므로 unclaimed 로만 보고한다.
 */
export function auditPlanClaims(plans: readonly { id: PlanId; features: readonly string[] }[] = PLANS): ClaimAudit {
  const issues: ClaimIssue[] = [];
  const unverifiable: { plan: PlanId; claim: string }[] = [];

  for (const plan of plans) {
    for (const raw of plan.features) {
      const claim = typeof raw === 'string' ? raw.trim() : String(raw);
      const spec = claimSpec(claim);
      if (!spec) {
        issues.push({ plan: plan.id, claim, code: 'unmapped', message: `등록되지 않은 요금제 문구: "${claim}" — CLAIM_REGISTRY 에 약속 내용을 명시하라` });
        continue;
      }
      if (spec.kind === 'unverifiable') { unverifiable.push({ plan: plan.id, claim }); continue; }
      if (spec.kind === 'inherit') {
        const from = spec.inheritsFrom;
        if (!from || RANK[from] >= RANK[plan.id]) {
          issues.push({ plan: plan.id, claim, code: 'bad_inherit', message: `"${claim}" 의 승계 대상(${from ?? '없음'})이 ${plan.id} 보다 하위가 아니다` });
        }
        continue;
      }
      for (const f of spec.features ?? []) {
        if (!hasFeature(plan.id, f)) {
          const meta = FEATURES.find((x) => x.id === f);
          issues.push({
            plan: plan.id, claim, code: 'over_promised', feature: f,
            message: `${plan.id} 카드가 "${claim}"(기능 ${f})을 약속하지만 실제로는 ${meta?.minPlan ?? '상위'} 플랜부터 허용된다`,
          });
        }
      }
    }
  }

  // 카드에 안 적힌 사용 가능 기능
  const unclaimed: { plan: PlanId; feature: FeatureId; label: string }[] = [];
  for (const plan of plans) {
    const claimed = new Set<FeatureId>();
    for (const raw of plan.features) {
      const spec = claimSpec(raw);
      if (spec?.kind === 'feature') for (const f of spec.features ?? []) claimed.add(f);
      if (spec?.kind === 'inherit' && spec.inheritsFrom) {
        for (const f of FEATURES) if (hasFeature(spec.inheritsFrom, f.id)) claimed.add(f.id);
      }
    }
    for (const f of FEATURES) {
      if (hasFeature(plan.id, f.id) && !claimed.has(f.id)) unclaimed.push({ plan: plan.id, feature: f.id, label: f.label });
    }
  }

  return { issues, unverifiable, unclaimed };
}

/** 좌석 상한 문구를 SEAT_LIMIT 에서 파생한다(화면이 인원수를 하드코딩하지 않게). */
export function seatClaim(plan: unknown): string {
  const id = (typeof plan === 'string' ? plan.trim().toLowerCase() : '') as PlanId;
  if (!Object.prototype.hasOwnProperty.call(SEAT_LIMIT, id)) return '좌석 정책 미정';
  const limit = SEAT_LIMIT[id];
  if (limit === null) return '좌석 수 무제한';
  return `최대 ${limit.toLocaleString('ko-KR')}명`;
}

/**
 * 무료 체험 좌석 수 — **env 만 인정**. 미설정·형식 밖·Basic 좌석 상한 초과는 null(문구 없음).
 * 임의 기본값을 두지 않는다(테스트가 모듈에 좌석 리터럴이 없음을 검사).
 */
export function freeTrialSeats(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.PRICING_FREE_TRIAL_SEATS ?? '').trim();
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  const cap = SEAT_LIMIT.basic;
  if (cap !== null && n > cap) return null; // Basic 상한보다 많은 무료 좌석은 모순 → 문구 생략
  return n;
}

/** 무료 체험 안내 문구. 근거(env)가 없으면 null — 화면은 아무 약속도 하지 않는다. */
export function freeTrialClaim(env: Record<string, string | undefined> = process.env): string | null {
  const n = freeTrialSeats(env);
  return n === null ? null : `${n.toLocaleString('ko-KR')}명까지 무료로 체험할 수 있습니다`;
}

export interface PlanClaimsStatus {
  plans: number;
  issues: number;
  unverifiable: number;
  unclaimed: number;
  freeTrialSeats: number | null;
  consistent: boolean;
}

/** 관측용 요약(시크릿 없음). */
export function planClaimsStatus(env: Record<string, string | undefined> = process.env): PlanClaimsStatus {
  const a = auditPlanClaims();
  return {
    plans: PLANS.length,
    issues: a.issues.length,
    unverifiable: a.unverifiable.length,
    unclaimed: a.unclaimed.length,
    freeTrialSeats: freeTrialSeats(env),
    consistent: a.issues.length === 0,
  };
}
