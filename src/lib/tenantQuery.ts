// 테넌트 조회 계층 정리 — 순수 모듈(DB·drizzle·next·환경 의존 0).
//
// 목적(COMMERCIAL_READINESS «2계층 확장 여지 확보»):
//   지금까지 각 라우트가 `eq(t.orgId, ctx.orgId)` 를 직접 조립했다. 그래서 나중에 파트너(리셀러) 뷰처럼
//   **여러 조직을 한 번에 읽는 스코프**가 생기면 라우트를 전수 수정해야 한다.
//   이 모듈은 "이 요청이 읽을 수 있는 조직은 무엇인가"를 **한 곳에서** 결정하고,
//   그 결과를 drizzle 에 독립적인 서술자(TenantFilter)로 넘긴다. 쿼리 빌더는 서술자만 해석하면 되므로
//   파트너 필터는 `resolveReadScope` 한 군데만 바뀌면 끼어든다.
//
// 지금 구현하지 않는 것(의도적):
//   - 화이트라벨 / 파트너 명의 화면
//   - 실제 다중 조직 조회 배선(inArray 승격) — 파트너 DDL 적용 후 [승인 필요]
//
// 안전 원칙: **fail-closed**. 스코프를 정할 수 없으면 "조건 없음"이 아니라 `deny`(0건)이다.
//   조건이 사라져 전체 테넌트가 노출되는 사고를 타입 차원에서 막는다.

export type TenantReadScope =
  | { kind: 'org'; orgId: number }                       // 현재 기본: 활성 조직 1건
  | { kind: 'orgs'; orgIds: number[]; via: 'partner' }   // 향후: 파트너가 유치한 고객사 다건(읽기 전용)
  | { kind: 'none'; reason: string };                    // 읽을 수 있는 조직 없음 → 0건

// drizzle 에 의존하지 않는 조건 서술자. 어댑터가 eq / inArray / false 로 번역한다.
export type TenantFilter =
  | { op: 'eq'; column: 'orgId'; orgId: number }
  | { op: 'in'; column: 'orgId'; orgIds: number[] }
  | { op: 'deny'; reason: string };

// 스코프 결정에 필요한 최소 입력. TenantContext 전체를 받지 않아 테스트가 쉽다.
export interface ReadScopeInput {
  orgId?: number | null;                 // requireTenant 가 확정한 활성 조직
  partnerOrgIds?: readonly number[] | null;  // partnerRbac.visibleOrgIds 결과(파트너 역할일 때만)
  partnerRole?: boolean;                 // 뷰어가 partner_admin 인가
  partnerEnabled?: boolean;              // PARTNER_ROLE_ENABLED 해석 결과
}

function positiveIds(v: readonly number[] | null | undefined): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const n of v) if (typeof n === 'number' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  return out.sort((a, b) => a - b);
}

function validOrgId(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * 조회 스코프 결정 — 유일한 진입점.
 * 우선순위: 활성 조직(일반 사용자) → 파트너 다중 조직(스위치 ON + partner_admin) → deny.
 * 파트너 스위치가 OFF 면 partnerOrgIds 는 무시된다(현재 운영 상태 = 기존 동작과 동일).
 */
export function resolveReadScope(input: ReadScopeInput): TenantReadScope {
  const orgId = validOrgId(input.orgId);
  if (orgId !== null) return { kind: 'org', orgId };
  if (input.partnerEnabled && input.partnerRole) {
    const ids = positiveIds(input.partnerOrgIds);
    if (ids.length === 1) return { kind: 'org', orgId: ids[0] };
    if (ids.length > 1) return { kind: 'orgs', orgIds: ids, via: 'partner' };
    return { kind: 'none', reason: '파트너에 귀속된 고객사가 없습니다' };
  }
  return { kind: 'none', reason: '활성 조직이 없습니다' };
}

/** 스코프 → 조건 서술자. */
export function tenantFilter(scope: TenantReadScope): TenantFilter {
  if (scope.kind === 'org') return { op: 'eq', column: 'orgId', orgId: scope.orgId };
  if (scope.kind === 'orgs') {
    const ids = positiveIds(scope.orgIds);
    if (!ids.length) return { op: 'deny', reason: '조직 목록이 비었습니다' };
    return ids.length === 1 ? { op: 'eq', column: 'orgId', orgId: ids[0] } : { op: 'in', column: 'orgId', orgIds: ids };
  }
  return { op: 'deny', reason: scope.reason };
}

/** 스코프에 포함된 조직 id 목록. deny 면 빈 배열. */
export function scopeOrgIds(scope: TenantReadScope): number[] {
  if (scope.kind === 'org') return [scope.orgId];
  if (scope.kind === 'orgs') return positiveIds(scope.orgIds);
  return [];
}

/** 런타임 가드 — 이 스코프가 해당 조직 행을 읽어도 되는가. */
export function scopeAllows(scope: TenantReadScope, orgId: unknown): boolean {
  const id = validOrgId(orgId);
  if (id === null) return false;
  return scopeOrgIds(scope).includes(id);
}

/**
 * 단일 조직 id 를 요구하는 기존 쿼리용 어댑터.
 * 현재 모든 라우트가 이 경로를 쓴다(활성 조직 1건). 다중 조직 스코프는 `tenantFilter` 의 'in' 으로
 * 승격해야 하며, 그 배선은 파트너 DDL 적용 후 [승인 필요] — 그때까지는 명시적으로 거절한다.
 */
export function soleOrgId(scope: TenantReadScope): number {
  const f = tenantFilter(scope);
  if (f.op === 'eq') return f.orgId;
  if (f.op === 'in') throw new TenantScopeError('MULTI_ORG_SCOPE_NOT_WIRED', '다중 조직 조회는 아직 배선되지 않았습니다');
  throw new TenantScopeError('NO_TENANT_SCOPE', f.reason);
}

export class TenantScopeError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'TenantScopeError'; }
}

/** 쓰기 경로 가드 — 파트너 역할은 읽기 전용이므로 다중 조직 스코프로는 쓰지 못한다. */
export function writableOrgId(scope: TenantReadScope): number {
  if (scope.kind !== 'org') throw new TenantScopeError('READ_ONLY_SCOPE', '이 스코프는 읽기 전용입니다');
  return scope.orgId;
}

/** 관리 화면·문서용 상태 요약(임의 수치 없음). */
export function tenantQueryStatus(scope: TenantReadScope) {
  const f = tenantFilter(scope);
  return {
    scopeKind: scope.kind,
    filterOp: f.op,
    orgCount: scopeOrgIds(scope).length,
    multiOrgWired: false,          // 2계층 조회 배선은 미활성(형태만 준비)
    whitelabel: false,             // 화이트라벨 미구현(범위 밖)
  };
}
