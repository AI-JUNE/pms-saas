// 백업·복구 리허설 추적 순수 로직 단일 소스.
//
// RUNBOOK.md §6 「복구 리허설 기록」은 사람이 실제 리허설을 수행한 뒤 손으로 채우는 표다.
// 이 모듈은 그 기록을 **읽고 판정만** 한다 — 기록을 만들거나 추측하지 않는다.
// 목적: "리허설 미실시"가 조용히 잊히지 않도록 신선도를 기계적으로 드러내는 것.
//
// 원칙
// - 임의 수치 금지: RTO/RPO·주기 기본값을 실측처럼 표기하지 않는다. 주기는 설정값(env)이다.
// - fail-safe: 값이 없거나 형식이 틀리면 'ok'로 올라가지 않고 'unknown'/'missing'으로 남긴다.
// - 공개 노출: 담당자 이름·비고 등 사람 식별 정보는 publicRehearsal()로 제거한 뒤 내보낸다.

export type RehearsalKind = 'periodic' | 'incident' | 'unknown';
export type RehearsalResult = 'pass' | 'fail' | 'partial' | 'unknown';

export interface RehearsalRecord {
  /** YYYY-MM-DD (실존 날짜만) */
  date: string;
  kind: RehearsalKind;
  /** 복구 대상 시점(자유 문자열, 파싱하지 않음) */
  target: string;
  /** 소요시간(분). 파싱 불가면 null */
  durationMin: number | null;
  result: RehearsalResult;
  owner: string;
  note: string;
}

/** 표 행 무결성 문제 */
export interface RehearsalIssue {
  row: number;
  code: 'BAD_DATE' | 'FUTURE_DATE' | 'UNKNOWN_RESULT' | 'NO_OWNER';
  message: string;
}

export type RehearsalHealth = 'missing' | 'stale' | 'failing' | 'ok';

export interface RehearsalFreshness {
  status: RehearsalHealth;
  /** 마지막 리허설 일자(없으면 null) */
  lastDate: string | null;
  lastResult: RehearsalResult | null;
  /** 마지막 리허설 이후 경과 일수(없으면 null) */
  ageDays: number | null;
  /** 다음 리허설 기한(없으면 null) */
  dueDate: string | null;
  /** 판정에 쓴 주기(일). 설정되지 않았으면 null → stale 판정을 하지 않는다 */
  intervalDays: number | null;
  /** 사람이 해야 할 일 한 줄 */
  action: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DAY = 86400000;

/** YYYY-MM-DD 엄격 파싱. 형식 밖·비실존 날짜(2026-02-30 등)는 null. */
export function parseRehearsalDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // 롤오버(2026-02-30 → 3-02) 거부
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() + 1 !== Number(mo) || dt.getUTCDate() !== Number(d)) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

function isoOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** n일 뒤 날짜(YYYY-MM-DD). */
export function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`).getTime() + days * MS_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

export function normalizeKind(raw: unknown): RehearsalKind {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('정기') || s === 'periodic' || s.includes('scheduled')) return 'periodic';
  if (s.includes('사건') || s.includes('장애') || s === 'incident') return 'incident';
  return 'unknown';
}

export function normalizeResult(raw: unknown): RehearsalResult {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('부분') || s === 'partial') return 'partial';
  if (s.includes('실패') || s.includes('불가') || s === 'fail' || s === 'failed') return 'fail';
  if (s.includes('정상') || s.includes('성공') || s.includes('통과') || s === 'pass' || s === 'ok') return 'pass';
  return 'unknown';
}

/** "42분" · "1시간 30분" · "90" → 분. 판정 불가는 null(추측하지 않는다). */
export function parseDurationMin(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const h = /(\d+(?:\.\d+)?)\s*(?:시간|h|hr|hours?)/i.exec(s);
  const m = /(\d+(?:\.\d+)?)\s*(?:분|m|min|minutes?)/i.exec(s);
  if (h || m) {
    const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
    return total > 0 ? Math.round(total) : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n > 0 ? Math.round(n) : null;
  }
  return null;
}

function isPlaceholder(cell: string): boolean {
  const s = cell.trim();
  if (!s) return true;
  // 문서에 남겨둔 미실시/확인필요 표시는 기록이 아니다.
  return /^\(?\s*(미실시|미수행|해당\s*없음|없음|n\/?a|tbd|-{1,3})\s*\)?$/i.test(s) || /\[확인\s*필요\]/.test(s);
}

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * RUNBOOK.md 본문에서 §6 리허설 표를 읽어 기록만 추려낸다.
 * 표가 비어 있거나 placeholder 행만 있으면 빈 배열(= 미실시)을 돌려준다.
 */
export function parseRehearsalTable(markdown: string): RehearsalRecord[] {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const out: RehearsalRecord[] = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = splitRow(line);
    if (isSeparator(cells)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue; // 헤더 행
    const date = parseRehearsalDate(cells[0]);
    if (!date) continue; // placeholder·빈 행·다른 표는 건너뛴다
    out.push({
      date,
      kind: normalizeKind(cells[1]),
      target: isPlaceholder(cells[2] ?? '') ? '' : (cells[2] ?? '').trim(),
      durationMin: parseDurationMin(cells[3]),
      result: normalizeResult(cells[4]),
      owner: isPlaceholder(cells[5] ?? '') ? '' : (cells[5] ?? '').trim(),
      note: isPlaceholder(cells[6] ?? '') ? '' : (cells[6] ?? '').trim(),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 표 무결성 점검(미실시 자체는 문제로 보지 않는다 — 신선도 판정의 몫). */
export function auditRehearsalRows(rows: RehearsalRecord[], now: Date = new Date()): RehearsalIssue[] {
  const today = isoOf(now);
  const issues: RehearsalIssue[] = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    if (!parseRehearsalDate(r.date)) {
      issues.push({ row, code: 'BAD_DATE', message: `일자 형식이 YYYY-MM-DD 가 아니다: ${r.date}` });
      return;
    }
    if (r.date > today) {
      issues.push({ row, code: 'FUTURE_DATE', message: `미래 일자는 기록이 아니다: ${r.date}` });
    }
    if (r.result === 'unknown') {
      issues.push({ row, code: 'UNKNOWN_RESULT', message: `검증 결과를 판독할 수 없다(${r.date})` });
    }
    if (!r.owner) {
      issues.push({ row, code: 'NO_OWNER', message: `담당자가 비어 있다(${r.date})` });
    }
  });
  return issues;
}

/** 가장 최근(과거 또는 오늘) 기록. 미래 일자는 제외한다. */
export function latestRehearsal(rows: RehearsalRecord[], now: Date = new Date()): RehearsalRecord | null {
  const today = isoOf(now);
  const past = rows.filter((r) => parseRehearsalDate(r.date) && r.date <= today);
  if (past.length === 0) return null;
  return past.reduce((a, b) => (a.date >= b.date ? a : b));
}

/**
 * 리허설 주기(일). `RECOVERY_REHEARSAL_INTERVAL_DAYS` 설정값만 인정한다.
 * 미설정이면 null — 임의 기본 주기를 만들지 않고 stale 판정을 보류한다.
 */
export function rehearsalIntervalDays(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.RECOVERY_REHEARSAL_INTERVAL_DAYS ?? '').trim();
  if (!raw) return null;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 3650 ? n : null;
}

/**
 * 신선도 판정.
 * - 기록 없음 → 'missing'
 * - 마지막 결과가 fail/partial → 'failing'
 * - 주기 설정 + 기한 초과 → 'stale'
 * - 그 외 → 'ok'
 */
export function rehearsalFreshness(args: {
  rows: RehearsalRecord[];
  now?: Date;
  intervalDays?: number | null;
}): RehearsalFreshness {
  const now = args.now || new Date();
  const interval = args.intervalDays ?? null;
  const last = latestRehearsal(args.rows, now);
  if (!last) {
    return {
      status: 'missing',
      lastDate: null,
      lastResult: null,
      ageDays: null,
      dueDate: null,
      intervalDays: interval,
      action: 'RUNBOOK.md 6절 절차로 복구 리허설을 1회 수행하고 표에 기록한다.',
    };
  }
  const ageDays = Math.max(0, dayIndex(isoOf(now)) - dayIndex(last.date));
  const dueDate = interval ? addDays(last.date, interval) : null;
  if (last.result === 'fail' || last.result === 'partial') {
    return {
      status: 'failing',
      lastDate: last.date,
      lastResult: last.result,
      ageDays,
      dueDate,
      intervalDays: interval,
      action: '마지막 리허설이 완전 통과가 아니다. 실패 항목을 조치하고 재리허설한다.',
    };
  }
  if (dueDate && isoOf(now) > dueDate) {
    return {
      status: 'stale',
      lastDate: last.date,
      lastResult: last.result,
      ageDays,
      dueDate,
      intervalDays: interval,
      action: `리허설 기한(${dueDate})이 지났다. 재리허설 후 표에 기록한다.`,
    };
  }
  return {
    status: 'ok',
    lastDate: last.date,
    lastResult: last.result,
    ageDays,
    dueDate,
    intervalDays: interval,
    action: dueDate ? `다음 리허설 기한: ${dueDate}` : '주기(RECOVERY_REHEARSAL_INTERVAL_DAYS) 설정 후 기한을 관리한다.',
  };
}

/**
 * 런타임(서버리스)에서는 저장소 파일을 읽지 않고 env 스냅샷으로 판정한다.
 * `RECOVERY_LAST_REHEARSAL`(YYYY-MM-DD) + `RECOVERY_LAST_REHEARSAL_RESULT`(정상/부분/실패).
 * 미설정이면 기록 없음으로 본다 — 사람이 실제로 수행했을 때만 채우는 값이다.
 */
export function rehearsalFromEnv(env: Record<string, string | undefined> = process.env): RehearsalRecord[] {
  const date = parseRehearsalDate(env.RECOVERY_LAST_REHEARSAL);
  if (!date) return [];
  return [
    {
      date,
      kind: normalizeKind(env.RECOVERY_LAST_REHEARSAL_KIND),
      target: '',
      durationMin: null,
      result: normalizeResult(env.RECOVERY_LAST_REHEARSAL_RESULT),
      // env 에는 담당자를 담지 않는다(PII). 무결성 점검은 RUNBOOK 표를 대상으로 한다.
      owner: '',
      note: '',
    },
  ];
}

/** 공개 응답용: 사람 식별 정보·자유 메모를 제거한다. */
export function publicRehearsal(f: RehearsalFreshness): Omit<RehearsalFreshness, 'action'> & { action: string } {
  return {
    status: f.status,
    lastDate: f.lastDate,
    lastResult: f.lastResult,
    ageDays: f.ageDays,
    dueDate: f.dueDate,
    intervalDays: f.intervalDays,
    action: f.action,
  };
}

/**
 * /api/health 용 체크. **required: false** — 리허설 미실시로 서비스를 down 처리하지 않는다.
 * 미실시·기한초과는 degraded(200)로만 드러난다.
 */
export function recoveryCheck(args?: { env?: Record<string, string | undefined>; now?: Date }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const env = args?.env ?? process.env;
  const f = rehearsalFreshness({
    rows: rehearsalFromEnv(env),
    now: args?.now,
    intervalDays: rehearsalIntervalDays(env),
  });
  return { ok: f.status === 'ok', required: false, detail: { rehearsal: publicRehearsal(f) } };
}

/** 배선 상태 요약(문서·보고용). */
export function recoveryStatus(env: Record<string, string | undefined> = process.env): {
  intervalConfigured: boolean;
  intervalDays: number | null;
  snapshotConfigured: boolean;
  note: string;
} {
  const interval = rehearsalIntervalDays(env);
  return {
    intervalConfigured: interval !== null,
    intervalDays: interval,
    snapshotConfigured: rehearsalFromEnv(env).length > 0,
    note: '리허설 수행·기록은 사람 몫. 이 모듈은 판정만 한다.',
  };
}
