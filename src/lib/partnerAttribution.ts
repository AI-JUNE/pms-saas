// 매출 귀속 근거(파트너 유입 기록) — 순수 모듈(DB·next·환경 의존 0, env 는 인자로 주입).
//
// 목적: "어떤 고객사가 어느 파트너를 통해, 언제, 누구의 소개로 유입됐는가"를 **변경 불가능한 근거**로 남겨
// 정산 분쟁을 예방한다. 조직의 현재 partner_id(lib/partner.ts)는 '현재 소속'이고, 이 모듈의 귀속 기록은
// '역사(이벤트 로그)'다. 파트너가 바뀌거나 직접 계약으로 전환되어도 과거 기록은 지우지 않고 종료일만 닫는다.
//
// build now, activate on approval:
//  - PARTNER_ATTRIBUTION_DDL 은 초안이며 lib/migrate.ts MIGRATION_DDL 에 넣지 않는다(부팅 자동 실행 → 라이브 DDL).
//    partners 테이블(PARTNER_MIGRATION_DDL)이 먼저 적용된 뒤에만 적용 가능. 적용은 [승인 필요].
//  - 기록 API·화면 배선은 DDL 적용 후 진행. 지금은 입력 정규화·검증·유효성 판정·정산 근거 요약만 제공한다.
//  - 담당자 연락처·고객 개인정보는 기록하지 않는다(담당자는 이름/사번 수준의 표시자만).

import { normalizePartnerCode } from './partner.ts';

// 유입 경로. 정산 근거로 쓰이므로 폐쇄 목록(자유 문자열 금지).
export type AttributionSource = 'partner_sales' | 'partner_referral' | 'partner_event' | 'direct' | 'migration';
export const ATTRIBUTION_SOURCES: AttributionSource[] = ['partner_sales', 'partner_referral', 'partner_event', 'direct', 'migration'];

// 귀속 종료 사유. 종료된 기록은 삭제하지 않고 endedAt·endReason 으로 닫는다.
export type AttributionEndReason = 'partner_changed' | 'converted_direct' | 'contract_ended' | 'correction';
export const ATTRIBUTION_END_REASONS: AttributionEndReason[] = ['partner_changed', 'converted_direct', 'contract_ended', 'correction'];

export interface PartnerAttribution {
  id?: number;
  orgId: number;
  partnerId: number | null;        // null = 직접 계약 근거(파트너 없음을 명시적으로 기록)
  partnerCode?: string | null;     // 기록 시점 코드 스냅샷(파트너 개명·삭제 후에도 근거 유지)
  source: AttributionSource;
  contractDate: string;            // YYYY-MM-DD. 계약(또는 유입 확정)일
  ownerRef?: string | null;        // 파트너 측 담당자 표시자(이름·사번). 연락처 금지
  memo?: string | null;
  endedAt?: string | null;         // YYYY-MM-DD. null = 현재 유효
  endReason?: AttributionEndReason | null;
  recordedBy?: number | null;      // 기록한 사용자 id
}

// 마이그레이션 SQL 초안 — 멱등. **MIGRATION_DDL 에 넣지 말 것**. partners 테이블 이후 적용. [승인 필요]
export const PARTNER_ATTRIBUTION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS partner_attributions (id serial PRIMARY KEY, org_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, partner_id integer REFERENCES partners(id) ON DELETE SET NULL, partner_code text, source text NOT NULL, contract_date date NOT NULL, owner_ref text, memo text, ended_at date, end_reason text, recorded_by integer, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS partner_attr_org_idx ON partner_attributions (org_id)`,
  `CREATE INDEX IF NOT EXISTS partner_attr_partner_idx ON partner_attributions (partner_id)`,
  // 조직당 '현재 유효' 기록은 1건만
  `CREATE UNIQUE INDEX IF NOT EXISTS partner_attr_active_idx ON partner_attributions (org_id) WHERE ended_at IS NULL`,
];

// 기록 기능 스위치. 기본 OFF. (파트너 채널 스위치와 별개 — 채널이 켜져도 기록은 따로 승인)
export function attributionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_ATTRIBUTION_ENABLED === 'true';
}

export function parseAttributionSource(v: unknown): AttributionSource | null {
  return typeof v === 'string' && (ATTRIBUTION_SOURCES as string[]).includes(v) ? (v as AttributionSource) : null;
}

export function parseEndReason(v: unknown): AttributionEndReason | null {
  return typeof v === 'string' && (ATTRIBUTION_END_REASONS as string[]).includes(v) ? (v as AttributionEndReason) : null;
}

// YYYY-MM-DD 이고 실제 존재하는 날짜만 통과(2026-02-30 거부). UTC 기준.
export function normalizeIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s ? s : null;
}

// 담당자 표시자: 이메일·전화번호 형태는 거부(연락처 미기록 원칙). 1~40자.
export function normalizeOwnerRef(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 40) return null;
  if (/@/.test(s) || /\d[\d\s-]{6,}\d/.test(s)) return null;
  return s;
}

export interface AttributionInput {
  orgId?: unknown; partnerId?: unknown; partnerCode?: unknown; source?: unknown; contractDate?: unknown;
  ownerRef?: unknown; memo?: unknown; recordedBy?: unknown;
}
export interface AttributionFieldError { field: string; code: string; message: string }

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

// 입력 검증·정규화. 성공 시 저장 가능한 레코드(endedAt=null), 실패 시 필드별 오류.
export function validateAttribution(input: AttributionInput, today: string): { ok: true; value: PartnerAttribution } | { ok: false; errors: AttributionFieldError[] } {
  const errors: AttributionFieldError[] = [];
  const orgId = posInt(input.orgId);
  if (!orgId) errors.push({ field: 'orgId', code: 'REQUIRED', message: '조직 id 필요' });
  const source = parseAttributionSource(input.source);
  if (!source) errors.push({ field: 'source', code: 'ENUM', message: `유입 경로는 ${ATTRIBUTION_SOURCES.join('/')} 중 하나` });
  const contractDate = normalizeIsoDate(input.contractDate);
  if (!contractDate) errors.push({ field: 'contractDate', code: 'DATE', message: 'YYYY-MM-DD 형식' });
  else if (contractDate > today) errors.push({ field: 'contractDate', code: 'FUTURE', message: '계약일은 미래일 수 없음' });

  let partnerId: number | null = null;
  let partnerCode: string | null = null;
  if (input.partnerId !== undefined && input.partnerId !== null) {
    partnerId = posInt(input.partnerId);
    if (!partnerId) errors.push({ field: 'partnerId', code: 'INVALID', message: '파트너 id는 양의 정수' });
  }
  if (input.partnerCode !== undefined && input.partnerCode !== null && input.partnerCode !== '') {
    partnerCode = normalizePartnerCode(input.partnerCode);
    if (!partnerCode) errors.push({ field: 'partnerCode', code: 'FORMAT', message: '파트너 코드 형식 오류' });
  }
  // 파트너 경로인데 파트너가 없거나, 직접 계약인데 파트너가 있으면 근거가 모순
  if (source && source !== 'direct' && source !== 'migration' && !partnerId) {
    errors.push({ field: 'partnerId', code: 'REQUIRED', message: '파트너 경로는 파트너 id 필요' });
  }
  if (source === 'direct' && partnerId) errors.push({ field: 'partnerId', code: 'CONFLICT', message: '직접 계약에는 파트너를 지정할 수 없음' });

  let ownerRef: string | null = null;
  if (input.ownerRef !== undefined && input.ownerRef !== null && input.ownerRef !== '') {
    ownerRef = normalizeOwnerRef(input.ownerRef);
    if (!ownerRef) errors.push({ field: 'ownerRef', code: 'PII', message: '담당자는 이름/사번만(연락처 불가, 40자 이내)' });
  }
  let memo: string | null = null;
  if (typeof input.memo === 'string' && input.memo.trim()) {
    memo = input.memo.trim().slice(0, 500);
  }
  const recordedBy = input.recordedBy === undefined || input.recordedBy === null ? null : posInt(input.recordedBy);

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { orgId: orgId!, partnerId, partnerCode, source: source!, contractDate: contractDate!, ownerRef, memo, endedAt: null, endReason: null, recordedBy } };
}

// 기록 종료(닫기). 기존 기록은 수정하지 않고 종료일·사유만 채운 새 객체를 돌려준다.
export function closeAttribution(a: PartnerAttribution, endedAt: string, reason: AttributionEndReason): { ok: true; value: PartnerAttribution } | { ok: false; code: string } {
  if (a.endedAt) return { ok: false, code: 'ALREADY_ENDED' };
  const d = normalizeIsoDate(endedAt);
  if (!d) return { ok: false, code: 'DATE' };
  if (d < a.contractDate) return { ok: false, code: 'BEFORE_CONTRACT' };
  return { ok: true, value: { ...a, endedAt: d, endReason: reason } };
}

// 특정 일자에 유효한 귀속(정산 기준일 판정). contractDate ≤ day, endedAt 없거나 day < endedAt.
export function isActiveOn(a: PartnerAttribution, day: string): boolean {
  if (a.contractDate > day) return false;
  if (a.endedAt && a.endedAt <= day) return false;
  return true;
}

export function activeAttribution(rows: PartnerAttribution[], day: string): PartnerAttribution | null {
  const hits = rows.filter((r) => isActiveOn(r, day));
  if (hits.length === 0) return null;
  // 동일 일자에 복수면 계약일이 가장 늦은 것(가장 최근 근거)
  return hits.sort((x, y) => (x.contractDate < y.contractDate ? 1 : x.contractDate > y.contractDate ? -1 : 0))[0];
}

// 기록 무결성 점검 — 조직당 열린 기록 1건, 기간 겹침 없음. 정산 전 사전 점검용(임의 수치 없음).
export function auditAttributionRows(rows: PartnerAttribution[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const byOrg = new Map<number, PartnerAttribution[]>();
  for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
  for (const [orgId, list] of byOrg) {
    const open = list.filter((r) => !r.endedAt);
    if (open.length > 1) problems.push(`org ${orgId}: 열린 귀속 기록 ${open.length}건(1건이어야 함)`);
    const sorted = [...list].sort((a, b) => (a.contractDate < b.contractDate ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (!prev.endedAt || prev.endedAt > sorted[i].contractDate) problems.push(`org ${orgId}: ${prev.contractDate}~${prev.endedAt ?? '진행'} 과 ${sorted[i].contractDate} 기간 겹침`);
    }
    for (const r of list) {
      if (r.endedAt && r.endedAt < r.contractDate) problems.push(`org ${orgId}: 종료일이 계약일보다 앞섬`);
      if (r.endedAt && !r.endReason) problems.push(`org ${orgId}: 종료 사유 누락`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// 정산 근거 요약(파트너 id별 유효 조직 목록). 금액·수수료는 후속 항목(정산 리포트)에서 설정값으로 계산.
export function attributionEvidence(rows: PartnerAttribution[], day: string): Array<{ partnerId: number | null; partnerCode: string | null; orgIds: number[] }> {
  const byOrg = new Map<number, PartnerAttribution[]>();
  for (const r of rows) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
  const groups = new Map<string, { partnerId: number | null; partnerCode: string | null; orgIds: number[] }>();
  for (const [orgId, list] of byOrg) {
    const a = activeAttribution(list, day);
    if (!a) continue;
    const key = String(a.partnerId ?? 'direct');
    const g = groups.get(key) ?? { partnerId: a.partnerId, partnerCode: a.partnerCode ?? null, orgIds: [] };
    g.orgIds.push(orgId);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, orgIds: [...g.orgIds].sort((x, y) => x - y) }));
}

// 화면·API 노출용 — memo·recordedBy 제외
export function publicAttribution(a: PartnerAttribution) {
  return { id: a.id ?? null, orgId: a.orgId, partnerId: a.partnerId, partnerCode: a.partnerCode ?? null, source: a.source, contractDate: a.contractDate, ownerRef: a.ownerRef ?? null, endedAt: a.endedAt ?? null, endReason: a.endReason ?? null };
}
