// 파트너(채널) 개념 — 순수 모듈(DB·next·환경 의존 0, env 는 인자로 주입).
//
// 배경: 계약·서비스 주체는 고원, 파트너(예: 제이투모로우원)는 영업·운영을 대행하고 수익을 배분한다.
// 향후 리셀러(파트너 명의 계약)로 전환될 수 있으므로 지금은 **2계층으로 확장 가능한 형태로만** 열어둔다.
//  - tier 'agency'   : 운영 대행. 계약 주체 = 고원 (현재)
//  - tier 'reseller' : 파트너 명의 계약. 계약 주체 = 파트너 (향후, 화이트라벨은 구현하지 않음)
//
// build now, activate on approval:
//  - PARTNER_CHANNEL_ENABLED=true 여야만 파트너 필드가 해석·노출된다. 기본 OFF → resolvePartnerId 는 항상 null.
//  - 스키마 DDL 은 아래 PARTNER_MIGRATION_DDL **초안**으로만 둔다. lib/migrate.ts 의 MIGRATION_DDL 은 서버 부팅 시
//    자동 실행(instrumentation.ts → ensureSchema)되므로 거기에 넣으면 배포 즉시 라이브 DB 에 DDL 이 적용된다.
//    → 적용은 [승인 필요]. tests/partner.test.ts 가 "MIGRATION_DDL 에 partner DDL 이 섞이지 않았음"을 검사한다.
//  - drizzle schema.ts 의 organizations 에 partnerId 컬럼은 **DDL 적용 후에** 추가한다. 미적용 상태에서 컬럼을 선언하면
//    organizations 전체 select 가 "column partner_id does not exist" 로 깨진다. 적용 후 추가할 선언:
//      partnerId: integer('partner_id'),   // nullable. null = 직접 계약
//
// 이 모듈이 담당하는 것: 파트너 식별·티어·계약 주체 판정, 조회 계층에 나중에 끼어들 파트너 스코프 seam.
// 담당하지 않는 것(후속 항목): 매출 귀속 기록, partner_admin 역할, 정산 리포트·수수료율.

export type PartnerTier = 'agency' | 'reseller';
export type PartnerStatus = 'active' | 'suspended' | 'ended';
export type ContractParty = 'gowon' | 'partner';

export interface Partner {
  id: number;
  code: string;            // 대문자 식별 코드(예: J2M1). 정산·유입 경로 표기에 사용
  name: string;
  tier: PartnerTier;
  status: PartnerStatus;
  contactName?: string | null;
  contactEmail?: string | null;
}

// 조직(테넌트)에서 파트너 판정에 필요한 최소 형태. partnerId 는 DDL 적용 전까지 실제 row 에 없을 수 있다.
export interface PartnerLinkedOrg { id: number; partnerId?: number | null }

export const PARTNER_TIERS: PartnerTier[] = ['agency', 'reseller'];
export const PARTNER_STATUSES: PartnerStatus[] = ['active', 'suspended', 'ended'];

// 마이그레이션 SQL 초안 — 멱등. **MIGRATION_DDL 에 넣지 말 것**(부팅 자동 실행). 적용은 [승인 필요].
export const PARTNER_MIGRATION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS partners (id serial PRIMARY KEY, code text NOT NULL, name text NOT NULL, tier text DEFAULT 'agency' NOT NULL, status text DEFAULT 'active' NOT NULL, contact_name text, contact_email text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS partners_code_idx ON partners (code)`,
  // 조직 → 파트너. NULL = 직접 계약. 파트너 삭제 시 직접 계약으로 되돌림(고객 데이터는 보존)
  `ALTER TABLE IF EXISTS organizations ADD COLUMN IF NOT EXISTS partner_id integer REFERENCES partners(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS orgs_partner_idx ON organizations (partner_id)`,
];

// 활성화 스위치. env 를 인자로 받아 테스트 가능. 기본 OFF.
export function partnerChannelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_CHANNEL_ENABLED === 'true';
}

// 파트너 코드 정규화: 대문자 A-Z·0-9·하이픈, 2~20자. 그 외는 null.
export function normalizePartnerCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,18}[A-Z0-9]$/.test(s) ? s : null;
}

export function parsePartnerTier(v: unknown): PartnerTier {
  return v === 'reseller' ? 'reseller' : 'agency';
}

export function parsePartnerStatus(v: unknown): PartnerStatus {
  return v === 'suspended' || v === 'ended' ? v : 'active';
}

// 계약 주체. 운영 대행(agency)은 고원, 리셀러는 파트너 명의.
export function contractParty(tier: PartnerTier): ContractParty {
  return tier === 'reseller' ? 'partner' : 'gowon';
}

// 조직의 파트너 id 해석. 스위치 OFF·값 없음·양의 정수 아님 → null(직접 계약).
export function resolvePartnerId(org: PartnerLinkedOrg | null | undefined, enabled: boolean): number | null {
  if (!enabled || !org) return null;
  const v = org.partnerId;
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
  return v;
}

export function isDirectContract(org: PartnerLinkedOrg | null | undefined, enabled: boolean): boolean {
  return resolvePartnerId(org, enabled) === null;
}

// 조회 계층 seam — 테넌트 목록 조회에 나중에 파트너 필터가 끼어들 자리.
//  'all'     : 제한 없음(슈퍼관리자·스위치 OFF)
//  'partner' : 해당 파트너를 통해 유입된 조직만(후속: partner_admin 역할)
export type PartnerScope = { kind: 'all' } | { kind: 'partner'; partnerId: number };

export function partnerScopeFor(viewer: { isSuperadmin: boolean; partnerId?: number | null }, enabled: boolean): PartnerScope {
  if (!enabled || viewer.isSuperadmin) return { kind: 'all' };
  const pid = viewer.partnerId;
  if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) return { kind: 'partner', partnerId: pid };
  return { kind: 'all' };
}

// 순수 필터. DB 쿼리 수준 필터는 DDL 적용 후 동일 의미로 배선한다.
export function filterOrgsByScope<T extends PartnerLinkedOrg>(rows: T[], scope: PartnerScope, enabled: boolean): T[] {
  if (scope.kind === 'all') return rows;
  return rows.filter((r) => resolvePartnerId(r, enabled) === scope.partnerId);
}

// 화면·API 노출용 — 담당자 연락처는 제외(최소 노출 원칙)
export function publicPartner(p: Partner): { id: number; code: string; name: string; tier: PartnerTier; status: PartnerStatus; contractParty: ContractParty } {
  return { id: p.id, code: p.code, name: p.name, tier: p.tier, status: p.status, contractParty: contractParty(p.tier) };
}

// 관리 화면 상태 요약(임의 수치 없음)
export function partnerChannelStatus(env: Record<string, string | undefined> = process.env) {
  const enabled = partnerChannelEnabled(env);
  return {
    enabled,
    tiersSupported: PARTNER_TIERS,
    resellerActive: false,                 // 2계층(리셀러 명의 계약)은 형태만 준비, 미활성
    ddlDraftStatements: PARTNER_MIGRATION_DDL.length,
    ddlApplied: 'unknown' as const,        // 라이브 DB 확인은 사람 몫 [승인 필요]
    note: enabled ? '파트너 채널 활성' : '파트너 채널 비활성(기본). PARTNER_CHANNEL_ENABLED=true 는 승인 후',
  };
}
