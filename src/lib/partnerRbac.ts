// 파트너 역할 권한(partner_admin) — 순수 모듈(DB·next·환경 의존 0, env 는 인자로 주입).
//
// 배경: 파트너(예: 제이투모로우원) 담당자는 **자기가 유치한 고객사만** 조회할 수 있어야 한다.
// 고객사 내부 업무 데이터(업무·이슈·요구사항·산출물·인원 PII)는 파트너에게 열지 않는다.
// 파트너가 보는 것은 계약·이용 수준 정보(조직 요약·구독/플랜·정산 근거)뿐이다.
//
// 설계 요지
//  1) 파트너 담당자는 고객사의 조직 멤버가 아니다. 소속은 partner_members(파트너↔사용자)로 별도 관리한다.
//     memberships.role 에 'partner_admin' 이 들어오는 경로도 fail-closed 로 막는다(아래 partnerCanAccess).
//  2) 권한은 **읽기 전용 화이트리스트**. 목록에 없는 resource, read 이외의 action 은 전부 거부.
//  3) 조회 범위는 매출 귀속 기록(partner_attributions)에서 파생한다 — 별도 소유권 테이블을 만들지 않는다.
//     귀속이 종료된 고객사는 종료일부터 보이지 않는다(반개구간, partnerAttribution.isActiveOn 과 동일 의미).
//
// build now, activate on approval:
//  - PARTNER_ROLE_ENABLED=true 여야만 partner_admin 이 어떤 권한이라도 갖는다. 기본 OFF → 전부 거부.
//  - DDL 은 PARTNER_RBAC_DDL 초안으로만 둔다. lib/migrate.ts 의 MIGRATION_DDL(부팅 자동 실행)에 넣지 않는다.
//    tests/partnerRbac.test.ts 가 혼입 여부를 매번 검사한다. 적용은 [승인 필요].

import { isActiveOn, type PartnerAttribution } from './partnerAttribution.ts';

export const PARTNER_ROLE = 'partner_admin' as const;
export type PartnerMemberStatus = 'active' | 'suspended';

export interface PartnerMember {
  id?: number;
  partnerId: number;
  userId: number;
  role: typeof PARTNER_ROLE;
  status: PartnerMemberStatus;
}

// 파트너에게 열어주는 resource 화이트리스트(읽기 전용).
//  - organization : 고객사 식별·플랜 등 계약 수준 요약(상세 데이터 아님)
//  - subscription : 구독 상태·플랜·좌석 수
//  - attribution  : 자기 매출 귀속 근거
//  - settlement   : 정산 리포트(후속 항목에서 구현)
// 고객사 내부 업무 데이터(project/task/issue/requirement/member/document ...)는 의도적으로 제외한다.
export const PARTNER_READABLE_RESOURCES: readonly string[] = ['organization', 'subscription', 'attribution', 'settlement'];

// 마이그레이션 SQL 초안 — 멱등. partners 테이블 이후 적용. **MIGRATION_DDL 에 넣지 말 것**. [승인 필요]
export const PARTNER_RBAC_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS partner_members (id serial PRIMARY KEY, partner_id integer NOT NULL REFERENCES partners(id) ON DELETE CASCADE, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, role text DEFAULT 'partner_admin' NOT NULL, status text DEFAULT 'active' NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS partner_members_uniq_idx ON partner_members (partner_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS partner_members_user_idx ON partner_members (user_id)`,
];

// 활성화 스위치. 기본 OFF. (채널·귀속 스위치와 별개 — 역할 활성화는 따로 승인)
export function partnerRoleEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_ROLE_ENABLED === 'true';
}

export function isPartnerRole(role: unknown): boolean {
  return role === PARTNER_ROLE;
}

export function parsePartnerMemberStatus(v: unknown): PartnerMemberStatus {
  return v === 'suspended' ? 'suspended' : 'active';
}

/**
 * partner_admin 의 권한 판정. fail-closed.
 * 스위치 OFF → 무조건 false. 읽기(read) 이외 액션·화이트리스트 밖 resource → false.
 */
export function partnerCanAccess(resource: unknown, action: unknown, enabled: boolean): boolean {
  if (!enabled) return false;
  if (action !== 'read') return false;
  return typeof resource === 'string' && PARTNER_READABLE_RESOURCES.includes(resource);
}

/** 파트너 담당자의 유효 파트너 id. 스위치 OFF·정지 상태·형식 오류 → null. */
export function partnerIdOfMember(m: PartnerMember | null | undefined, enabled: boolean): number | null {
  if (!enabled || !m) return null;
  if (m.status !== 'active' || !isPartnerRole(m.role)) return null;
  const pid = m.partnerId;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

/** 해당 파트너가 기준일에 조회 가능한 조직 id 목록(귀속 기록 기반, 중복 제거·오름차순). */
export function visibleOrgIds(partnerId: number | null, rows: readonly PartnerAttribution[], day: string): number[] {
  if (partnerId === null) return [];
  const set = new Set<number>();
  for (const r of rows) {
    if (r.partnerId === partnerId && isActiveOn(r, day)) set.add(r.orgId);
  }
  return [...set].sort((a, b) => a - b);
}

/** 단건 판정 — 파트너가 기준일에 이 조직을 볼 수 있는가. */
export function canViewOrg(partnerId: number | null, orgId: number, rows: readonly PartnerAttribution[], day: string): boolean {
  if (partnerId === null) return false;
  return rows.some((r) => r.orgId === orgId && r.partnerId === partnerId && isActiveOn(r, day));
}

/** 목록 필터 — 조직 배열을 파트너 가시 범위로 좁힌다. */
export function filterVisibleOrgs<T extends { id: number }>(
  rows: readonly T[], partnerId: number | null, attributions: readonly PartnerAttribution[], day: string,
): T[] {
  const allowed = new Set(visibleOrgIds(partnerId, attributions, day));
  return rows.filter((o) => allowed.has(o.id));
}

export type PartnerAccessDecision = { allow: boolean; code: string; message: string };

/**
 * 라우트 배선용 통합 판정(순수). code 는 표준 에러 코드 문자열과 맞춘다.
 * DISABLED(스위치 OFF) / FORBIDDEN(권한·범위 밖) / OK.
 */
export function decidePartnerAccess(args: {
  member: PartnerMember | null | undefined;
  resource: string;
  action: string;
  orgId?: number | null;
  attributions?: readonly PartnerAttribution[];
  day: string;
  enabled: boolean;
}): PartnerAccessDecision {
  if (!args.enabled) return { allow: false, code: 'DISABLED', message: '파트너 역할이 비활성 상태입니다' };
  const pid = partnerIdOfMember(args.member, args.enabled);
  if (pid === null) return { allow: false, code: 'FORBIDDEN', message: '파트너 담당자가 아닙니다' };
  if (!partnerCanAccess(args.resource, args.action, args.enabled)) {
    return { allow: false, code: 'FORBIDDEN', message: `파트너 권한 범위를 벗어났습니다 (${args.resource}:${args.action})` };
  }
  if (args.orgId != null && !canViewOrg(pid, args.orgId, args.attributions ?? [], args.day)) {
    return { allow: false, code: 'FORBIDDEN', message: '담당 고객사가 아닙니다' };
  }
  return { allow: true, code: 'OK', message: '' };
}

/** 관리 화면 상태 요약(임의 수치 없음) */
export function partnerRoleStatus(env: Record<string, string | undefined> = process.env) {
  const enabled = partnerRoleEnabled(env);
  return {
    enabled,
    role: PARTNER_ROLE,
    readableResources: PARTNER_READABLE_RESOURCES,
    writeAllowed: false,               // 파트너는 읽기 전용. 쓰기 경로는 만들지 않는다
    scopeSource: 'partner_attributions' as const,
    ddlDraftStatements: PARTNER_RBAC_DDL.length,
    ddlApplied: 'unknown' as const,    // 라이브 DB 확인은 사람 몫 [승인 필요]
    note: enabled ? '파트너 역할 활성' : '파트너 역할 비활성(기본). PARTNER_ROLE_ENABLED=true 는 승인 후',
  };
}
