// 감사로그 검색 필터·보존정책 — 순수 모듈(DB·next 의존 없음, process.env 는 인자로만).
//
// ── 검색 ────────────────────────────────────────────────────────────────────
// `/api/audit` 는 지금까지 「최근 100건」만 돌려주고 화면이 그 안에서만 걸렀다. 이 모듈은 쿼리스트링을
// 안전한 필터로 바꾼다 — 라우트는 여기서 나온 값만 SQL 조건에 넣는다(날짜는 실존 여부까지 검사, limit 상한 500).
//
// ── 보존정책 ──────────────────────────────────────────────────────────────────
// 보존 일수는 `AUDIT_RETENTION_DAYS` 로만 바꾼다. 미설정이면 **기본 365일**을 쓰되 응답·화면에
// `decided:false`(「운영 확정 전 기본값」)를 함께 내보낸다 — 수치가 결정된 것처럼 보이지 않게 한다.
// **삭제 작업은 이 저장소에 없다.** 기준일(cutoff)은 표시·점검용이고, 실제 정리는 소유자 확정 뒤 별도 승인 [확인 필요].

export const AUDIT_RETENTION_ENV = 'AUDIT_RETENTION_DAYS';
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
export const MIN_AUDIT_RETENTION_DAYS = 30;
export const MAX_AUDIT_RETENTION_DAYS = 3650;

export const AUDIT_LIMIT_DEFAULT = 100;
export const AUDIT_LIMIT_MAX = 500;

/** 동작 분류 — 이벤트명 끝 토큰(`TASKS_CREATE` → CREATE). ACCESS 는 관리 기능 열람(auditAccess). */
export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'ACCESS', 'AUTH'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = { CREATE: '생성', UPDATE: '수정', DELETE: '삭제', ACCESS: '열람', AUTH: '인증' };

type EnvLike = Record<string, string | undefined>;

export interface AuditFilters {
  /** 행위자(users.id). */
  actorId: number | null;
  action: AuditAction | null;
  entity: string | null;
  entityId: string | null;
  /** YYYY-MM-DD(포함). */
  from: string | null;
  /** YYYY-MM-DD(포함 — 라우트는 다음날 0시 미만으로 바꿔 쓴다). */
  to: string | null;
  /** 이벤트명·대상 부분 일치 검색어(소문자화). */
  q: string | null;
  limit: number;
  /** 커서(이 id 미만). */
  cursor: number | null;
  problems: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isRealDate(s: unknown): boolean {
  const v = String(s ?? '');
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 다음날 0시(UTC 기준 날짜 문자열 → Date). to 포함 범위를 `<` 조건으로 바꾼다. */
export function dayAfter(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1));
}
export function dayStart(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

type ParamsLike = { get(name: string): string | null } | Record<string, string | undefined | null>;
function getParam(p: ParamsLike, name: string): string {
  if (typeof (p as any).get === 'function') return String((p as any).get(name) ?? '').trim();
  return String((p as Record<string, unknown>)[name] ?? '').trim();
}

/** 쿼리스트링 → 필터. 못 읽는 값은 버리고 problems 에 적는다(요청을 거절하지 않는다). */
export function parseAuditFilters(params: ParamsLike): AuditFilters {
  const problems: string[] = [];
  const actorRaw = getParam(params, 'actor');
  let actorId: number | null = null;
  if (actorRaw) {
    if (/^\d+$/.test(actorRaw) && Number(actorRaw) > 0) actorId = Number(actorRaw);
    else problems.push('actor 는 양의 정수여야 합니다');
  }
  const actionRaw = getParam(params, 'action').toUpperCase();
  let action: AuditAction | null = null;
  if (actionRaw) {
    if ((AUDIT_ACTIONS as readonly string[]).includes(actionRaw)) action = actionRaw as AuditAction;
    else problems.push(`action 은 ${AUDIT_ACTIONS.join('/')} 중 하나여야 합니다`);
  }
  const entityRaw = getParam(params, 'entity');
  let entity: string | null = null;
  if (entityRaw) {
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(entityRaw)) entity = entityRaw;
    else problems.push('entity 형식이 올바르지 않습니다');
  }
  const entityIdRaw = getParam(params, 'entityId');
  let entityId: string | null = null;
  if (entityIdRaw) {
    if (/^[A-Za-z0-9_.:-]{1,64}$/.test(entityIdRaw)) entityId = entityIdRaw;
    else problems.push('entityId 형식이 올바르지 않습니다');
  }
  const fromRaw = getParam(params, 'from');
  let from: string | null = null;
  if (fromRaw) { if (isRealDate(fromRaw)) from = fromRaw; else problems.push('from 은 YYYY-MM-DD 실제 날짜여야 합니다'); }
  const toRaw = getParam(params, 'to');
  let to: string | null = null;
  if (toRaw) { if (isRealDate(toRaw)) to = toRaw; else problems.push('to 는 YYYY-MM-DD 실제 날짜여야 합니다'); }
  if (from && to && from > to) { problems.push('from 이 to 보다 늦습니다 — 기간을 무시합니다'); from = null; to = null; }
  const qRaw = getParam(params, 'q');
  const q = qRaw ? qRaw.slice(0, 80).toLowerCase() : null;
  const limitRaw = getParam(params, 'limit');
  let limit = AUDIT_LIMIT_DEFAULT;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isInteger(n) && n >= 1) limit = Math.min(n, AUDIT_LIMIT_MAX);
    else problems.push('limit 은 1 이상 정수여야 합니다');
  }
  const cursorRaw = getParam(params, 'cursor');
  let cursor: number | null = null;
  if (cursorRaw) {
    if (/^\d+$/.test(cursorRaw) && Number(cursorRaw) > 0) cursor = Number(cursorRaw);
    else problems.push('cursor 는 양의 정수여야 합니다');
  }
  return { actorId, action, entity, entityId, from, to, q, limit, cursor, problems };
}

/** 필터가 하나라도 걸려 있는가(화면 「전체」 표시 판단). */
export function hasActiveFilter(f: AuditFilters): boolean {
  return !!(f.actorId || f.action || f.entity || f.entityId || f.from || f.to || f.q);
}

/** 이벤트명 → 동작 분류. `admin.audit.view` 같은 열람 이벤트는 ACCESS, AUTH_* 는 AUTH. */
export function actionOfEvent(event: unknown): AuditAction | null {
  const e = String(event ?? '');
  if (!e) return null;
  if (/^AUTH_/.test(e)) return 'AUTH';
  if (/^admin\./.test(e)) return 'ACCESS';
  const tail = e.split('_').pop() ?? '';
  return (AUDIT_ACTIONS as readonly string[]).includes(tail) ? (tail as AuditAction) : null;
}

/** LIKE 패턴(와일드카드 이스케이프). action 필터를 SQL 로 옮길 때 쓴다. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** action → 이벤트명 LIKE 패턴들(OR). */
export function actionPatterns(action: AuditAction): string[] {
  if (action === 'AUTH') return ['AUTH\\_%'];
  if (action === 'ACCESS') return ['admin.%'];
  return [`%\\_${action}`];
}

/** detail JSON → 객체(깨졌으면 null). 화면 상세 서랍용. */
export function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }; } catch { return { raw: s }; }
}

// ── 보존정책 ──────────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  days: number;
  /** env 에서 왔으면 true — false 면 **운영 확정 전 기본값**이다. */
  decided: boolean;
  source: 'env' | 'default';
  note: string;
}

export const RETENTION_PENDING_NOTE = '보존 기간은 운영 확정 전 기본값입니다. 확정 후 AUDIT_RETENTION_DAYS 로 설정하세요 [확인 필요]. 자동 삭제는 수행하지 않습니다.';
export const RETENTION_SET_NOTE = '환경변수로 설정된 보존 기간입니다. 자동 삭제는 수행하지 않습니다 — 정리 작업은 별도 승인 대상입니다.';

export function auditRetentionPolicy(env: EnvLike | null | undefined): RetentionPolicy {
  const raw = String(env?.[AUDIT_RETENTION_ENV] ?? '').trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= MIN_AUDIT_RETENTION_DAYS && n <= MAX_AUDIT_RETENTION_DAYS) return { days: n, decided: true, source: 'env', note: RETENTION_SET_NOTE };
  }
  return { days: DEFAULT_AUDIT_RETENTION_DAYS, decided: false, source: 'default', note: RETENTION_PENDING_NOTE };
}

/** 보존 기준일 — 이보다 오래된 기록이 정리 후보다(표시용). */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export function auditRetentionStatus(env: EnvLike | null | undefined, now: Date = new Date()): RetentionPolicy & { cutoff: string } {
  const p = auditRetentionPolicy(env);
  return { ...p, cutoff: retentionCutoff(now, p.days).toISOString().slice(0, 10) };
}
