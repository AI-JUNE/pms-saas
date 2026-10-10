// incidentEvidence.ts — RUNBOOK §3 1단계(손상 범위·손상 시각 T 특정)의 **근거를 지키는** 순수 모듈.
// DB·next·fs 의존 없음, `process.env` 미접근(필요한 값은 인자로만 받는다). 신규 조회·쓰기·DDL 0.
//
// ── 왜 필요한가 ───────────────────────────────────────────────────────────────
// §3 1단계는 「감사로그(`/api/audit`)로 T 직전 관리 작업 이력을 확인한다」고 지시한다. 그런데
//
//  (1) **그 조회가 조용히 잘린다.** `/api/audit` 는 `cursor` 를 받지만 응답에 다음 커서도,
//      더 있는지 여부도 담지 않았다. 화면(`app/audit/page.tsx`)은 `limit=200` 한 번만 호출하고
//      페이징이 없다. 정렬이 `desc(audit_log.id)` 이므로 잘려 나가는 쪽은 **가장 오래된 쪽** —
//      즉 1단계가 보라고 한 「T 직전」이다. 대량 삭제는 CRUD DELETE 1건당 감사 1행이라 200건을
//      쉽게 넘기므로, 담당자는 손상의 **원인 작업을 구조적으로 못 보면서** 화면에는 아무 경고도
//      없이 「최근 200건」만 본다.
//
//  (2) **그 근거가 복구로 함께 사라진다.** `audit_log` 는 복구 대상과 같은 DB·같은 브랜치에
//      있다. 3단계에서 T-ε 브랜치를 만들고 5단계에서 전환하면 `created_at > T-ε` 인 감사 기록이
//      전부 없어진다 — 손상을 일으킨 작업의 기록, 차단 전까지 들어온 쓰기의 흔적, 1단계 조사
//      자체의 열람 이력까지. 그런데 `lib/recoveryVerify.ts` 의 `CORE_TABLE_ROLES` 는 이 테이블을
//      「사후 조사·법적 보존 대상이라 재생성이 불가능하다」고 스스로 선언해 두었고, §3 8단계는
//      사건·조치 기록을, §6 표는 사건 기록을 그 이력 위에서 하라고 한다. 전환 후에 열어 보면
//      그 구간은 **비어 있는 것이 아니라 「아무 일도 없었던 것처럼」** 보인다(조용한 소실).
//
// 그래서 이 모듈은 (a) 조회 결과가 잘렸는지를 **판정해 드러내고**, (b) 전환이 지울 감사 이력
// 구간을 **수치로** 적어 주고, (c) 감사로그가 보장하지 **못하는** 것을 `EVIDENCE_LIMITS` 로 함께
// 내보낸다. 보존(내보내기) 실행과 보관 위치는 사람 몫이다 — 코드가 보존을 했다고 단정하지 않는다.

export const EVIDENCE_TABLE = 'audit_log';

/* ─────────────────────────── 조회 완전성(절단) 판정 ─────────────────────────── */

export const CAPTURE_VERDICTS = ['complete', 'truncated', 'empty', 'unreadable'] as const;
export type CaptureVerdict = (typeof CAPTURE_VERDICTS)[number];

export const ACTION_CAPTURE_COMPLETE =
  '지정한 조건 범위의 기록을 모두 받았습니다. 전환(RUNBOOK §3 5단계) 전에 DB 밖으로 내보내 보관하세요.';
export const ACTION_CAPTURE_TRUNCATED =
  '결과가 limit 에서 잘렸습니다 — 빠진 쪽은 가장 오래된 기록, 즉 사건 직전입니다. nextCursor 로 끝까지 페이징하거나 기간(from·to)을 좁혀 다시 조회하세요.';
export const ACTION_CAPTURE_EMPTY =
  '조건에 맞는 기록이 없습니다. 「일어나지 않았다」는 뜻이 아닙니다 — 기간·조직 스코프·보존 기간을 먼저 확인하세요.';
export const ACTION_CAPTURE_UNREADABLE =
  '건수·limit 을 읽을 수 없어 완전성을 판정하지 않습니다(「전부 받았다」로 올리지 않습니다).';

export const CAVEAT_UNBOUNDED =
  '기간(from·to)을 지정하지 않아 최신 쪽만 남았습니다. 사건 시각 T 를 포함하는 기간을 지정해 다시 조회하세요.';
export const CAVEAT_NO_CURSOR =
  '다음 커서를 산출할 수 없어(행 id 판독 실패) 페이징으로 이어 받을 수 없습니다. 기간을 좁혀 다시 조회하세요.';
export const CAVEAT_DISCARDED_BY_SWITCH =
  '이 기록은 복구 대상과 같은 DB 에 있습니다. RUNBOOK §3 5단계 전환은 복구 시점 이후의 감사 이력을 함께 되돌립니다 — 전환 전에 내보내지 않으면 사후 조사 근거가 남지 않습니다(§3-5).';

/** 감사로그가 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다(한계를 숨기지 않는다). */
export const EVIDENCE_LIMITS: readonly string[] = [
  '앱을 거친 변경만 남습니다 — `DATABASE_URL` 로 직접 붙은 쓰기(psql·Neon 콘솔)·DDL 은 기록되지 않습니다.',
  '기록은 대상(entity·entityId)만 남고 값의 이전/이후를 남기지 않습니다 — 「무엇이 어떻게 바뀌었는지」는 복구 브랜치와 대조해야 알 수 있습니다.',
  '감사 기록 자체의 실패는 본 요청을 깨뜨리지 않고 흡수됩니다(`lib/audit.ts`) — 기록이 없는 것이 「일어나지 않았다」는 증거는 아닙니다.',
  '`/api/audit` 는 조직 스코프입니다. `/api/admin/security-events` 는 보안·인증 이벤트만 봅니다 — 다른 조직의 업무 데이터 변경 이력을 보는 경로는 아직 없습니다(전 테넌트 손상 범위는 이 화면으로 특정할 수 없습니다).',
  '보존 기간(`AUDIT_RETENTION_DAYS`) 표기 밖의 기록은 조회 대상에서 빠집니다.',
  CAVEAT_DISCARDED_BY_SWITCH,
];

export interface CaptureInput {
  /** 이번 응답 행 수. */
  rowCount: unknown;
  /** 실제로 적용된 limit. */
  limit: unknown;
  /** 이번 응답에서 가장 작은 id(= `desc(id)` 정렬의 마지막 행). 다음 커서가 된다. */
  oldestId?: unknown;
  /** 기간(from·to)이 하나라도 지정됐는가. */
  bounded?: unknown;
}

export interface CaptureAssessment {
  verdict: CaptureVerdict;
  rowCount: number | null;
  limit: number | null;
  /** 건수가 limit 에 닿았다 = 더 있을 수 있다(없다고 단정하지 않는다). */
  reachedLimit: boolean;
  /** 이어 받을 커서(`?cursor=` 에 넣는다). 더 없으면 null. */
  nextCursor: number | null;
  /** 잘린 쪽. `desc(id)` 정렬이라 항상 가장 오래된 쪽이다. */
  droppedEnd: 'oldest' | null;
  bounded: boolean;
  action: string;
  caveats: string[];
}

function posInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}
function nonNegInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 조회 결과가 잘렸는지 판정한다.
 * - `rowCount >= limit` 이면 `truncated` — **더 있는지 모른다**(한 건 더일 수도, 수만 건일 수도 있다).
 *   "없다"로 올리지 않는 쪽이 사후 조사에서 안전하다.
 * - 수치를 읽을 수 없으면 `unreadable` — 추측해서 `complete` 로 만들지 않는다.
 */
export function assessCapture(input: CaptureInput): CaptureAssessment {
  const rowCount = nonNegInt(input?.rowCount);
  const limit = posInt(input?.limit);
  const bounded = input?.bounded === true;
  const base = { rowCount, limit, bounded } as const;

  if (rowCount === null || limit === null) {
    return { ...base, verdict: 'unreadable', reachedLimit: false, nextCursor: null, droppedEnd: null, action: ACTION_CAPTURE_UNREADABLE, caveats: [] };
  }
  if (rowCount === 0) {
    return { ...base, verdict: 'empty', reachedLimit: false, nextCursor: null, droppedEnd: null, action: ACTION_CAPTURE_EMPTY, caveats: bounded ? [] : [CAVEAT_UNBOUNDED] };
  }
  if (rowCount >= limit) {
    const cursor = posInt(input?.oldestId);
    const caveats: string[] = [];
    if (!cursor) caveats.push(CAVEAT_NO_CURSOR);
    if (!bounded) caveats.push(CAVEAT_UNBOUNDED);
    caveats.push(CAVEAT_DISCARDED_BY_SWITCH);
    return { ...base, verdict: 'truncated', reachedLimit: true, nextCursor: cursor, droppedEnd: 'oldest', action: ACTION_CAPTURE_TRUNCATED, caveats };
  }
  return { ...base, verdict: 'complete', reachedLimit: false, nextCursor: null, droppedEnd: null, action: ACTION_CAPTURE_COMPLETE, caveats: [CAVEAT_DISCARDED_BY_SWITCH] };
}

/** 응답에 실어 보내는 형태 — 판정 + 한계 목록. */
export function captureStatus(input: CaptureInput): CaptureAssessment & { table: string; limits: readonly string[] } {
  return { ...assessCapture(input), table: EVIDENCE_TABLE, limits: EVIDENCE_LIMITS };
}

/**
 * 행 목록에서 다음 커서(가장 작은 id)를 구한다. `desc(id)` 정렬을 가정하지 않고 실제 최소값을 쓴다
 * (정렬이 바뀌어도 커서가 어긋나지 않게 — 정렬 자체는 테스트가 라우트 원문에서 고정한다).
 */
export function oldestIdOf(rows: unknown): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let min: number | null = null;
  for (const r of rows) {
    const id = posInt((r as { id?: unknown } | null)?.id);
    if (id === null) continue;
    if (min === null || id < min) min = id;
  }
  return min;
}

/* ─────────────────────── 전환이 지울 감사 이력 구간 ─────────────────────── */

export type DiscardVerdict = 'ok' | 'future' | 'invalid';

export interface DiscardWindow {
  verdict: DiscardVerdict;
  /** 복구 시점 이후 경과 시간(올림). 판정 불가면 null. */
  hours: number | null;
  days: number | null;
  /** 정규화된 복구 시점(ISO). 판독 실패면 null — 지어내지 않는다. */
  restorePoint: string | null;
  text: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** 엄격 파서 — 형식 밖·비실존 날짜는 null. 타임존 없는 값은 UTC 로 읽는다. */
export function parseInstant(v: unknown): Date | null {
  const s = String(v ?? '').trim();
  if (!ISO_RE.test(s)) return null;
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(s);
  const hasTime = /[T ]\d{2}:\d{2}/.test(s);
  const norm = hasTime ? s.replace(' ', 'T') + (hasZone ? '' : 'Z') : s + 'T00:00:00Z';
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return null;
  // 비실존 날짜(2026-02-30 등)를 Date 가 굴려서 받아 주는 것을 막는다.
  // ※ 판정은 **표기된 날짜 자체**로 한다 — UTC 변환 결과와 비교하면 타임존이 붙은 정상 시각
  //   (`2026-10-09T03:05:00+09:00` → UTC 로는 전날)을 「비실존」으로 잘못 거절한다.
  //   RUNBOOK 은 타임존을 붙여 적으라고 지시하므로 그 쪽이 정상 입력이다.
  const [y, mo, da] = norm.slice(0, 10).split('-').map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== mo || probe.getUTCDate() !== da) return null;
  return d;
}

/**
 * 복구 시점 T-ε 으로 전환하면 **함께 사라지는 감사 이력 구간**을 수치로 돌려준다.
 * RUNBOOK §3-5 가 고지 문구를 만들 때 쓴다. 임의 추정 없음 — 못 읽으면 `invalid`.
 */
export function discardWindow(restorePoint: unknown, now: Date = new Date()): DiscardWindow {
  const rp = parseInstant(restorePoint);
  if (!rp) {
    return { verdict: 'invalid', hours: null, days: null, restorePoint: null,
      text: `복구 시점을 읽을 수 없습니다(YYYY-MM-DD 또는 ISO 시각). ${EVIDENCE_TABLE} 소실 구간을 산출하지 않습니다.` };
  }
  const iso = rp.toISOString();
  const diff = now.getTime() - rp.getTime();
  if (diff < 0) {
    return { verdict: 'future', hours: null, days: null, restorePoint: iso,
      text: `복구 시점(${iso})이 현재보다 미래입니다. 구간을 산출하지 않습니다 — 값을 다시 확인하세요.` };
  }
  const hours = Math.ceil(diff / 3_600_000);
  const days = Math.ceil(diff / 86_400_000);
  return { verdict: 'ok', hours, days, restorePoint: iso,
    text: `복구 시점 ${iso} 이후의 ${EVIDENCE_TABLE} 기록(약 ${hours}시간분)은 전환과 함께 사라집니다. 전환 전에 내보내 DB 밖에 보관하세요(RUNBOOK §3-5).` };
}

/* ──────────────────────────── 배선 정적 점검 ──────────────────────────── */

/**
 * `app/api/audit/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 커서 페이징은 `desc(audit_log.id)` 정렬에 기대고 있으므로 정렬도 함께 고정한다
 * (정렬을 `createdAt` 으로 바꾸면 커서가 조용히 어긋나 사후 조사에서 행이 빠진다).
 */
export function auditAuditRouteWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/incidentEvidence['"]/.test(s)) problems.push('incidentEvidence 를 import 하지 않는다');
  const at = s.indexOf('captureStatus(');
  if (at < 0) { problems.push('captureStatus() 를 호출하지 않는다 — 절단 여부를 판정하지 않는다'); return problems; }
  // 판정 결과가 **응답에 실려야** 화면이 절단을 알 수 있다. 인라인이든 `capture` 변수 경유든 허용하되,
  // 판정만 하고 버리는 꼴(다른 이름에 받아 두고 응답에 넣지 않음)은 걸러낸다.
  const inline = /capture:\s*captureStatus\(/.test(s);
  const viaVar = /(?:const|let)\s+capture\s*=\s*captureStatus\(/.test(s) && /\bok\(\{[^)]*\bcapture\b/.test(s);
  if (!inline && !viaVar) problems.push('판정 결과를 응답의 capture 필드로 내보내지 않는다');
  const arg = s.slice(at, at + 400);
  if (!/rowCount:/.test(arg)) problems.push('captureStatus 에 rowCount 를 넘기지 않는다');
  if (!/limit:\s*f\.limit/.test(arg)) problems.push('captureStatus 에 실제 적용된 limit(f.limit)을 넘기지 않는다');
  if (!/oldestId:/.test(arg)) problems.push('captureStatus 에 oldestId 를 넘기지 않는다 — 다음 커서를 낼 수 없다');
  if (!/bounded:/.test(arg)) problems.push('captureStatus 에 bounded(기간 지정 여부)를 넘기지 않는다');
  if (!/orderBy\(desc\(auditLog\.id\)\)/.test(s)) problems.push('정렬이 desc(auditLog.id) 가 아니다 — 커서 페이징이 조용히 어긋난다');
  if (!/eq\(auditLog\.orgId/.test(s)) problems.push('조직 스코프 조건이 없다');
  return problems;
}

/**
 * `app/audit/page.tsx` 원문 점검 — 절단을 **사람에게 드러내고** 이어 받을 수 있는지.
 * 단발 조회(limit 고정 + 커서 없음)로 되돌아가면 CI 를 실패시킨다: 화면은 그대로 돌기 때문에
 * 사람 눈으로는 「최근 200건」과 「잘린 200건」을 구분할 수 없는 회귀다.
 */
export function auditAuditScreenWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/\bcapture\b/.test(s)) problems.push('응답의 capture 블록을 읽지 않는다');
  if (!/truncated/.test(s)) problems.push("절단 판정('truncated')을 화면에 드러내지 않는다");
  if (!/nextCursor/.test(s)) problems.push('nextCursor 를 쓰지 않는다 — 잘린 뒤를 이어 받을 수 없다');
  if (!/set\(\s*['"]cursor['"]/.test(s)) problems.push('조회에 cursor 를 넘기지 않는다(단발 조회)');
  if (!/role=["']alert["']/.test(s)) problems.push('절단 경고가 alert 역할로 알려지지 않는다');
  return problems;
}

/** 화면·문서에 쓸 한 줄 요약(수치·판정만 — 행 내용·PII 없음). */
export function evidenceLogLine(a: CaptureAssessment): string {
  const parts = [`verdict=${a.verdict}`, `rows=${a.rowCount ?? '?'}`, `limit=${a.limit ?? '?'}`, `bounded=${a.bounded}`];
  if (a.nextCursor) parts.push(`nextCursor=${a.nextCursor}`);
  if (a.droppedEnd) parts.push(`dropped=${a.droppedEnd}`);
  return `[evidence] ${parts.join(' ')}`;
}
