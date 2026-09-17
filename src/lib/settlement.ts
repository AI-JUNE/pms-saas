// 파트너 정산 리포트 — 순수 모듈(DB·next·환경 의존 0, env 는 인자로 주입).
//
// 목적: 파트너별 «계약(귀속 근거) → 이용 실적(청구 내역) → 수수료 산출»을 한 줄기로 재현 가능하게 만든다.
// 정산 분쟁의 핵심은 "왜 이 금액인가"이므로, 모든 행이 근거(귀속 기록·청구 라인)까지 되짚어진다.
//
// 설계 원칙
//  - **수수료율 하드코딩 금지**: 요율·반올림·산정기준은 전부 설정값(env)에서 읽는다. 미설정이면 계산하지 않고
//    `rate_unconfigured` 로 표시한다(임의 기본 요율을 쓰지 않는다 — 계약서보다 앞설 수 없다).
//  - **일자 단위 귀속**: 청구 라인은 '청구일에 유효한 귀속 기록'의 파트너에 붙는다. 기간 중 파트너가 바뀌어도
//    기간을 쪼개 정확히 나뉜다(lib/partnerAttribution.ts 의 반개구간 판정 재사용).
//  - **임의 수치 없음**: 목표 요율·예상 매출 같은 가공 수치를 만들어내지 않는다. 입력에 없는 값은 null.
//
// build now, activate on approval:
//  - 스위치 `PARTNER_SETTLEMENT_ENABLED` 기본 OFF. 조회 API·화면 배선은 partners·partner_attributions DDL
//    적용 이후 **[승인 필요]**. 이 모듈은 DDL 을 정의하지 않는다(신규 테이블 없음 — 기존 청구 내역에서 집계).
//  - 실제 지급(송금·세금계산서)은 코드 범위 밖이다. 리포트는 '지급 근거 자료'까지만 생성한다.

import { activeAttribution, type PartnerAttribution } from './partnerAttribution.ts';
import { normalizePartnerCode } from './partner.ts';

/* ── 스위치 ──────────────────────────────────────────────────────── */

export function settlementEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PARTNER_SETTLEMENT_ENABLED === 'true';
}

/* ── 수수료 설정(하드코딩 금지) ──────────────────────────────────── */

export type RoundingMode = 'floor' | 'round' | 'ceil';
export type CommissionBasis = 'net' | 'gross';

export const ROUNDING_MODES: RoundingMode[] = ['floor', 'round', 'ceil'];
export const COMMISSION_BASES: CommissionBasis[] = ['net', 'gross'];

export interface CommissionConfig {
  /** 파트너 코드(대문자) → 요율(0~1). 'DEFAULT' 키는 코드별 지정이 없는 파트너에 적용 */
  rates: Record<string, number>;
  rounding: RoundingMode;
  /** net = 환불 차감 후 금액 기준(기본), gross = 청구 총액 기준 */
  basis: CommissionBasis;
}

export interface ConfigError { field: string; code: string; message: string }

/** 요율 표기 파싱: 0.25 / '0.25' / '25%' → 0.25. 범위 밖·형식 오류는 null */
export function parseRate(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (s.endsWith('%')) {
      const p = Number(s.slice(0, -1).trim());
      n = Number.isFinite(p) ? p / 100 : null;
    } else {
      const p = Number(s);
      n = Number.isFinite(p) ? p : null;
    }
  }
  if (n === null || !Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;             // 100% 초과·음수 요율은 계약상 있을 수 없다
  return Math.round(n * 1e6) / 1e6;            // 소수 6자리까지(0.0001% 단위)
}

/**
 * 설정 로드. 요율은 `PARTNER_COMMISSION_RATES` 에서 읽는다.
 *   JSON  : {"DEFAULT":"20%","J2M1":0.25}
 *   또는   : "DEFAULT=20%,J2M1=0.25"
 * 미설정이면 rates 는 비어 있고(오류 아님) 산출은 rate_unconfigured 가 된다.
 */
export function loadCommissionConfig(env: Record<string, string | undefined> = process.env): { ok: true; value: CommissionConfig } | { ok: false; errors: ConfigError[] } {
  const errors: ConfigError[] = [];
  const rates: Record<string, number> = {};
  const raw = (env.PARTNER_COMMISSION_RATES ?? '').trim();

  if (raw) {
    let entries: Array<[string, unknown]> = [];
    if (raw.startsWith('{')) {
      try {
        const obj = JSON.parse(raw) as unknown;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) entries = Object.entries(obj as Record<string, unknown>);
        else errors.push({ field: 'PARTNER_COMMISSION_RATES', code: 'FORMAT', message: 'JSON 객체여야 함' });
      } catch {
        errors.push({ field: 'PARTNER_COMMISSION_RATES', code: 'JSON', message: 'JSON 파싱 실패' });
      }
    } else {
      for (const part of raw.split(',')) {
        const s = part.trim();
        if (!s) continue;
        const i = s.indexOf('=');
        if (i <= 0) { errors.push({ field: 'PARTNER_COMMISSION_RATES', code: 'FORMAT', message: `'코드=요율' 형식 아님: ${s}` }); continue; }
        entries.push([s.slice(0, i), s.slice(i + 1)]);
      }
    }
    for (const [k, v] of entries) {
      const key = k.trim().toUpperCase();
      const code = key === 'DEFAULT' ? 'DEFAULT' : normalizePartnerCode(key);
      if (!code) { errors.push({ field: 'PARTNER_COMMISSION_RATES', code: 'CODE', message: `파트너 코드 형식 오류: ${k}` }); continue; }
      const rate = parseRate(v);
      if (rate === null) { errors.push({ field: 'PARTNER_COMMISSION_RATES', code: 'RATE', message: `요율은 0~1 또는 0~100%: ${k}` }); continue; }
      rates[code] = rate;
    }
  }

  const roundingRaw = (env.PARTNER_COMMISSION_ROUNDING ?? '').trim();
  let rounding: RoundingMode = 'floor';         // 미설정 기본: 내림(과다지급 방지)
  if (roundingRaw) {
    if ((ROUNDING_MODES as string[]).includes(roundingRaw)) rounding = roundingRaw as RoundingMode;
    else errors.push({ field: 'PARTNER_COMMISSION_ROUNDING', code: 'ENUM', message: `${ROUNDING_MODES.join('/')} 중 하나` });
  }

  const basisRaw = (env.PARTNER_COMMISSION_BASIS ?? '').trim();
  let basis: CommissionBasis = 'net';           // 미설정 기본: 환불 차감 후
  if (basisRaw) {
    if ((COMMISSION_BASES as string[]).includes(basisRaw)) basis = basisRaw as CommissionBasis;
    else errors.push({ field: 'PARTNER_COMMISSION_BASIS', code: 'ENUM', message: `${COMMISSION_BASES.join('/')} 중 하나` });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { rates, rounding, basis } };
}

/** 파트너에 적용할 요율. 코드별 지정 → DEFAULT → 없으면 null(계산하지 않음) */
export function rateFor(config: CommissionConfig, partnerCode: string | null | undefined): number | null {
  if (partnerCode) {
    const code = normalizePartnerCode(partnerCode);
    if (code && config.rates[code] !== undefined) return config.rates[code];
  }
  return config.rates.DEFAULT !== undefined ? config.rates.DEFAULT : null;
}

export function applyRounding(amount: number, mode: RoundingMode): number {
  if (!Number.isFinite(amount)) return 0;
  return mode === 'ceil' ? Math.ceil(amount) : mode === 'round' ? Math.round(amount) : Math.floor(amount);
}

/* ── 정산 기간 ───────────────────────────────────────────────────── */

export interface SettlementPeriod { period: string; start: string; endExclusive: string }

/** 'YYYY-MM' → 해당 월 [1일, 다음달 1일). 형식·월 범위 오류는 null */
export function parsePeriod(v: unknown): SettlementPeriod | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { period: `${m[1]}-${m[2]}`, start: start.toISOString().slice(0, 10), endExclusive: end.toISOString().slice(0, 10) };
}

export function inPeriod(dayISO: string, p: SettlementPeriod): boolean {
  return dayISO >= p.start && dayISO < p.endExclusive;
}

/* ── 이용 실적(청구 라인) ────────────────────────────────────────── */

export type RevenueStatus = 'paid' | 'refunded' | 'failed' | 'pending';

export interface RevenueLine {
  orgId: number;
  /** YYYY-MM-DD (청구 확정일) */
  chargedAt: string;
  /** 원화 정수. 청구 총액 */
  amountKRW: number;
  /** 원화 정수. 해당 라인에서 환불된 금액(부분환불 포함) */
  refundKRW?: number;
  status: RevenueStatus;
  planId?: string | null;
  seats?: number | null;
  /** PG 거래 식별자 등 근거 참조 */
  ref?: string | null;
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 정산 대상 라인인지: 상태가 paid/refunded 이고 기간 안이며 금액이 정상 */
export function isBillableLine(l: RevenueLine, p: SettlementPeriod): boolean {
  if (l.status !== 'paid' && l.status !== 'refunded') return false;
  if (!isPosInt(l.orgId) || !isNonNegInt(l.amountKRW)) return false;
  if (typeof l.chargedAt !== 'string' || !inPeriod(l.chargedAt, p)) return false;
  return true;
}

/** 입력 무결성 점검. 계산 전 사전 점검용(문제는 리포트 warnings 로 노출) */
export function auditRevenueLines(lines: RevenueLine[], p: SettlementPeriod): string[] {
  const problems: string[] = [];
  for (const l of lines) {
    if (!isPosInt(l.orgId)) { problems.push(`조직 id 오류: ${String(l.orgId)}`); continue; }
    if (typeof l.chargedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.chargedAt)) { problems.push(`org ${l.orgId}: 청구일 형식 오류`); continue; }
    if (!inPeriod(l.chargedAt, p)) { problems.push(`org ${l.orgId}: ${l.chargedAt} 은 정산기간(${p.period}) 밖 — 제외`); continue; }
    if (!isNonNegInt(l.amountKRW)) { problems.push(`org ${l.orgId}: 금액은 0 이상 정수`); continue; }
    const refund = l.refundKRW ?? 0;
    if (!isNonNegInt(refund)) problems.push(`org ${l.orgId}: 환불액은 0 이상 정수`);
    else if (refund > l.amountKRW) problems.push(`org ${l.orgId}: 환불액(${refund})이 청구액(${l.amountKRW}) 초과`);
  }
  return problems;
}

/* ── 리포트 ──────────────────────────────────────────────────────── */

export interface SettlementOrgRow {
  orgId: number;
  lineCount: number;
  grossKRW: number;
  refundKRW: number;
  netKRW: number;
}

export type SettlementRowStatus = 'ok' | 'rate_unconfigured';

export interface SettlementPartnerRow {
  /** null = 직접 계약(파트너 없음). 수수료 대상 아님 */
  partnerId: number | null;
  partnerCode: string | null;
  orgCount: number;
  orgs: SettlementOrgRow[];
  lineCount: number;
  grossKRW: number;
  refundKRW: number;
  netKRW: number;
  /** 산정 기준액(basis 에 따라 net 또는 gross) */
  baseKRW: number;
  rate: number | null;
  commissionKRW: number | null;
  status: SettlementRowStatus;
}

export interface SettlementReport {
  period: string;
  start: string;
  endExclusive: string;
  basis: CommissionBasis;
  rounding: RoundingMode;
  partners: SettlementPartnerRow[];
  /** 귀속 기록이 없어 어느 파트너에도 붙지 않은 매출(직접 계약과 구분) */
  unattributed: { lineCount: number; grossKRW: number; refundKRW: number; netKRW: number; orgIds: number[] };
  totals: { grossKRW: number; refundKRW: number; netKRW: number; commissionKRW: number; partnersWithoutRate: number };
  warnings: string[];
}

const emptyOrgRow = (orgId: number): SettlementOrgRow => ({ orgId, lineCount: 0, grossKRW: 0, refundKRW: 0, netKRW: 0 });

/**
 * 파트너별 정산 리포트 생성.
 * 각 청구 라인은 '청구일에 유효한 귀속 기록'으로 파트너를 정한다(기간 중 파트너 변경 시 자동 분할).
 * 귀속 기록 자체가 없는 조직의 매출은 unattributed 로 분리한다(직접 계약 = partnerId null 과 구분).
 */
export function buildSettlement(input: {
  period: unknown;
  lines: RevenueLine[];
  attributions: PartnerAttribution[];
  config: CommissionConfig;
}): { ok: true; value: SettlementReport } | { ok: false; code: string; message: string } {
  const p = parsePeriod(input.period);
  if (!p) return { ok: false, code: 'PERIOD', message: '정산 기간은 YYYY-MM 형식' };

  const warnings = auditRevenueLines(input.lines, p);

  const byOrgAttr = new Map<number, PartnerAttribution[]>();
  for (const a of input.attributions) byOrgAttr.set(a.orgId, [...(byOrgAttr.get(a.orgId) ?? []), a]);

  const groups = new Map<string, SettlementPartnerRow>();
  const unattributed = { lineCount: 0, grossKRW: 0, refundKRW: 0, netKRW: 0, orgIds: [] as number[] };
  const unattributedOrgs = new Set<number>();

  for (const l of input.lines) {
    if (!isBillableLine(l, p)) continue;
    const gross = l.amountKRW;
    const refund = isNonNegInt(l.refundKRW) ? Math.min(l.refundKRW, gross) : 0;
    const net = gross - refund;

    const attr = activeAttribution(byOrgAttr.get(l.orgId) ?? [], l.chargedAt);
    if (!attr) {
      unattributed.lineCount += 1;
      unattributed.grossKRW += gross;
      unattributed.refundKRW += refund;
      unattributed.netKRW += net;
      unattributedOrgs.add(l.orgId);
      continue;
    }

    const key = attr.partnerId === null ? 'direct' : `p${attr.partnerId}`;
    const row = groups.get(key) ?? {
      partnerId: attr.partnerId, partnerCode: attr.partnerCode ?? null, orgCount: 0, orgs: [],
      lineCount: 0, grossKRW: 0, refundKRW: 0, netKRW: 0, baseKRW: 0, rate: null, commissionKRW: null, status: 'ok' as SettlementRowStatus,
    };
    if (!row.partnerCode && attr.partnerCode) row.partnerCode = attr.partnerCode;
    let org = row.orgs.find((o) => o.orgId === l.orgId);
    if (!org) { org = emptyOrgRow(l.orgId); row.orgs.push(org); }
    org.lineCount += 1; org.grossKRW += gross; org.refundKRW += refund; org.netKRW += net;
    row.lineCount += 1; row.grossKRW += gross; row.refundKRW += refund; row.netKRW += net;
    groups.set(key, row);
  }

  const partners: SettlementPartnerRow[] = [];
  let commissionTotal = 0;
  let withoutRate = 0;

  for (const row of groups.values()) {
    row.orgs.sort((a, b) => a.orgId - b.orgId);
    row.orgCount = row.orgs.length;
    row.baseKRW = input.config.basis === 'gross' ? row.grossKRW : row.netKRW;
    if (row.partnerId === null) {
      // 직접 계약: 수수료 대상 아님(요율 미조회). status 는 ok
      row.rate = null; row.commissionKRW = null;
    } else {
      const rate = rateFor(input.config, row.partnerCode);
      if (rate === null) {
        row.status = 'rate_unconfigured';
        withoutRate += 1;
        warnings.push(`파트너 ${row.partnerCode ?? row.partnerId}: 수수료율 미설정 — PARTNER_COMMISSION_RATES 확인 [승인 필요]`);
      } else {
        row.rate = rate;
        row.commissionKRW = applyRounding(row.baseKRW * rate, input.config.rounding);
        commissionTotal += row.commissionKRW;
      }
    }
    partners.push(row);
  }

  partners.sort((a, b) => {
    if (a.partnerId === null) return 1;
    if (b.partnerId === null) return -1;
    return b.netKRW - a.netKRW || a.partnerId - b.partnerId;
  });

  unattributed.orgIds = [...unattributedOrgs].sort((a, b) => a - b);
  if (unattributed.lineCount > 0) warnings.push(`귀속 기록 없는 매출 ${unattributed.lineCount}건(조직 ${unattributed.orgIds.length}곳) — 정산 제외`);

  const totals = {
    grossKRW: partners.reduce((s, r) => s + r.grossKRW, 0) + unattributed.grossKRW,
    refundKRW: partners.reduce((s, r) => s + r.refundKRW, 0) + unattributed.refundKRW,
    netKRW: partners.reduce((s, r) => s + r.netKRW, 0) + unattributed.netKRW,
    commissionKRW: commissionTotal,
    partnersWithoutRate: withoutRate,
  };

  return {
    ok: true,
    value: { period: p.period, start: p.start, endExclusive: p.endExclusive, basis: input.config.basis, rounding: input.config.rounding, partners, unattributed, totals, warnings },
  };
}

/** 특정 파트너의 산출 근거만 추림(파트너 담당자 조회용 — partnerRbac 의 가시 범위와 함께 쓴다) */
export function partnerSettlementView(report: SettlementReport, partnerId: number): SettlementPartnerRow | null {
  return report.partners.find((r) => r.partnerId === partnerId) ?? null;
}

/* ── 내보내기(CSV) ───────────────────────────────────────────────── */

/** CSV 셀 이스케이프 + 수식 인젝션 방어(=,+,-,@ 로 시작하면 앞에 작은따옴표) */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export const SETTLEMENT_CSV_HEADER = ['기간', '파트너ID', '파트너코드', '고객사수', '청구건수', '청구총액', '환불액', '순매출', '산정기준액', '요율', '수수료', '상태'];

/** 파트너 단위 요약 CSV. 엑셀 한글 깨짐 방지를 위해 BOM 포함. */
export function toSettlementCsv(report: SettlementReport): string {
  const lines = [csvRow(SETTLEMENT_CSV_HEADER)];
  for (const r of report.partners) {
    lines.push(csvRow([
      report.period,
      r.partnerId ?? '',
      r.partnerId === null ? '직접계약' : (r.partnerCode ?? ''),
      r.orgCount, r.lineCount, r.grossKRW, r.refundKRW, r.netKRW, r.baseKRW,
      r.rate === null ? '' : `${Math.round(r.rate * 1e6) / 1e4}%`,
      r.commissionKRW === null ? '' : r.commissionKRW,
      r.partnerId === null ? '수수료대상아님' : (r.status === 'ok' ? '정상' : '요율미설정'),
    ]));
  }
  if (report.unattributed.lineCount > 0) {
    lines.push(csvRow([report.period, '', '귀속없음', report.unattributed.orgIds.length, report.unattributed.lineCount, report.unattributed.grossKRW, report.unattributed.refundKRW, report.unattributed.netKRW, '', '', '', '정산제외']));
  }
  lines.push(csvRow([report.period, '', '합계', '', '', report.totals.grossKRW, report.totals.refundKRW, report.totals.netKRW, '', '', report.totals.commissionKRW, '']));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 고객사(조직) 단위 상세 CSV — 분쟁 시 라인 근거로 내려가기 전 단계 */
export const SETTLEMENT_DETAIL_CSV_HEADER = ['기간', '파트너ID', '파트너코드', '고객사ID', '청구건수', '청구총액', '환불액', '순매출'];

export function toSettlementDetailCsv(report: SettlementReport): string {
  const lines = [csvRow(SETTLEMENT_DETAIL_CSV_HEADER)];
  for (const r of report.partners) {
    for (const o of r.orgs) {
      lines.push(csvRow([report.period, r.partnerId ?? '', r.partnerId === null ? '직접계약' : (r.partnerCode ?? ''), o.orgId, o.lineCount, o.grossKRW, o.refundKRW, o.netKRW]));
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 내보내기 파일명(경로 문자 제거) */
export function settlementFilename(report: SettlementReport, kind: 'summary' | 'detail' = 'summary'): string {
  const safe = report.period.replace(/[^0-9-]/g, '');
  return `settlement_${safe}_${kind}.csv`;
}

/* ── 관리 화면 상태(임의 수치 없음) ──────────────────────────────── */

export function settlementStatus(env: Record<string, string | undefined> = process.env) {
  const cfg = loadCommissionConfig(env);
  const enabled = settlementEnabled(env);
  return {
    enabled,
    configOk: cfg.ok,
    configErrors: cfg.ok ? [] : cfg.errors,
    ratesConfigured: cfg.ok ? Object.keys(cfg.value.rates).length : 0,
    hasDefaultRate: cfg.ok ? cfg.value.rates.DEFAULT !== undefined : false,
    rounding: cfg.ok ? cfg.value.rounding : null,
    basis: cfg.ok ? cfg.value.basis : null,
    note: enabled ? '정산 리포트 활성' : '정산 리포트 비활성(기본). PARTNER_SETTLEMENT_ENABLED=true 는 승인 후',
  };
}
