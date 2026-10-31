/**
 * rehearsalLedger.ts — 리허설 근거의 **두 기록**(§6 표 ↔ env) 대조 (RUNBOOK §6 · §6-4). 2026-10-20
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6-2 는 리허설이 **어느 절차 단위**를 검증했는지를, §6-3 은 그 단위에서 **무엇을 읽는지**를
 * 기계화했다. 둘 다 전제는 하나다 — 「리허설 기록이 있다」. 그 기록은 **두 군데**에 있다:
 * 저장소에 남는 §6 표(일자·유형·복구 대상 시점·소요시간·검증 결과·담당·비고)와, 판정이 읽는
 * 환경변수 스냅샷(`RECOVERY_LAST_REHEARSAL*`). **그 둘이 대조된 적이 없었다.**
 *
 *  (1) **판정은 사라지는 쪽만 본다.** `lib/recovery.ts` 의 `rehearsalFreshness` 는
 *      `rehearsalFromEnv(process.env)` 가 만든 한 행만 본다. §6 표는 `parseRehearsalTable` 로
 *      읽을 수 있지만 그 값은 **어떤 판정에도 닿지 않는다**(테스트의 표 무결성 점검에만 쓰인다).
 *      즉 판정의 유일한 입력은 Vercel 환경변수이고, 그것은 §4 가 「복구 대상」으로 선언한
 *      바로 그 자리다 — 시크릿 유실·프로젝트 재생성에서 함께 사라진다. 사라지면 판정은
 *      `missing`(신선도)·`unrecorded`(범위, = **판정 불가**)로 내려앉는데, 저장소에는 그 리허설을
 *      실제로 수행한 기록이 그대로 남아 있다. **되찾을 수 있는데 아무도 되찾지 않는다.**
 *
 *  (2) **칸이 서로 다르다.** 범위(`RECOVERY_LAST_REHEARSAL_SCOPE` — §6-2 판정의 전부)는
 *      표에 **칸이 없어 env 에만 산다**. §5-1 이 적어 둔 대로 Promote 롤백은 **옛 배포의 env
 *      스냅샷**으로 돌아가므로, 롤백 한 번에 범위 기록이 옛 값·공백으로 되돌아간다 —
 *      그리고 그것은 `unrecorded`(판정 보류)라서 **degraded 조차 아니다**. 거꾸로 소요시간·
 *      담당·비고는 표에만 있고 **읽는 판정이 없다**(§3-7 이 만들어 주는 소요시간도 그렇다).
 *
 *  (3) **겹치는 칸을 대조한 적이 없다.** 표에 `부분 통과` 로 적고 env 에 `정상` 을 넣으면
 *      응답은 `ok` 다(그 반대도 마찬가지다). 복구 뒤 env 만 손으로 되살리면 표와 **다른 날짜**가
 *      판정이 된다. 어느 쪽도 오류를 내지 않는다.
 *
 *  (4) **결과를 판독하지 못하면 `ok` 가 됐다.** `normalizeResult` 가 `unknown` 을 돌려주면
 *      `rehearsalFreshness` 의 fail/partial 분기를 비켜 가므로, `RECOVERY_LAST_REHEARSAL` 만
 *      있고 `_RESULT` 가 없거나 판독 불가인 상태가 **「리허설 통과」**로 나갔다(§4 복구에서
 *      키 하나만 빠져도 그렇게 된다). 표 쪽은 `auditRehearsalRows` 가 `UNKNOWN_RESULT` 로
 *      잡는데 env 쪽에는 같은 점검이 없었다 — 같은 기록인데 한쪽만 점검됐다.
 *      그래서 이 배치에서 `lib/recovery.ts` 에 `unknown_result` 판정을 추가했고,
 *      이 모듈의 `auditRecordSources` 가 그 분기가 사라지지 않도록 고정한다.
 *
 *  (5) **복원 경로가 없다.** 다른 소절은 전부 1줄 산출 명령을 갖는데, 표에서 env 를 되돌리는
 *      명령이 없었다(§4-7 은 키 이름만 적어 두고 「값은 6절 표 참조」라고도 말하지 않는다).
 *
 * 그래서 이 모듈은
 *   · 기록의 **칸마다 집을 적고**(`LEDGER_FIELDS` — 표 열 · env 키 · 읽는 판정 · 한쪽이
 *     사라지면 조용히 생기는 일), 집이 하나인 칸을 드러낸다,
 *   · §6 표를 **열 이름으로** 읽고(`parseLedgerTable` — 위치 기반 파서는 칸이 하나 끼어들면
 *     조용히 어긋난다. 그 순서는 `auditColumnOrder` 가 따로 고정한다),
 *   · 두 기록을 대조한다(`reconcileLedger` → `date_mismatch`·`result_mismatch`·
 *     `table_only`·`env_only`·`unreadable_result` …),
 *   · 표에서 env 를 되돌리는 줄을 만든다(`ledgerRestoreLines` — **없는 값은 지어내지 않고**
 *     `[확인 필요]` 로 둔다. 담당·비고는 공개 응답에 나가므로 담지 않는다),
 *   · 그 상태를 `/api/health` 로 드러낸다(`rehearsalLedgerCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL·신규 env 0**. env 는 **인자로** 받는다.
 * - **런타임은 저장소 파일을 읽지 않는다.** 표를 넘기지 않으면 판정은 `basis: 'env'` 이고
 *   **표를 본 적 없다는 사실을 응답에 적는다** — 값 대조는 §6-4 명령(사람)과 CI 가 한다.
 * - **중복 보고 금지.** 기록이 아예 없는 평상시는 `no_record`(판정 보류, ok)로 조용히 둔다 —
 *   미실시는 `checks.recovery` 가 `missing` 으로 이미 말한다.
 * - **임의 값 금지.** 표의 빈 칸을 env 값으로 메우지 않고, 판독 못 한 결과를 `ok` 로 올리지 않는다.
 */

import { TRANSIENT_KEYS } from './envPresence.ts';
import { ENV_VARS } from './envRegistry.ts';
import {
  normalizeKind,
  normalizeResult,
  parseDurationMin,
  parseRehearsalDate,
  type RehearsalKind,
  type RehearsalResult,
} from './recovery.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const LEDGER_RUNBOOK_REF = 'RUNBOOK §6 · §6-4';

/** 기록이 사는 곳 */
export type LedgerHome = 'both' | 'table_only' | 'env_only';

export interface LedgerField {
  /** 기록의 칸 */
  key: 'date' | 'kind' | 'target' | 'duration' | 'result' | 'owner' | 'note' | 'scope' | 'unpassed';
  /** §6 표의 열 이름(없으면 null) */
  column: string | null;
  /** 환경변수 키(없으면 null) */
  envKey: string | null;
  home: LedgerHome;
  /** 이 칸을 **읽어 판정하는** 곳. null 이면 적기는 하지만 아무도 읽지 않는다 */
  judgedBy: string | null;
  /** 집이 하나인 칸이 그 집과 함께 사라지면 조용히 생기는 일 */
  lost: string;
}

/**
 * 기록의 칸마다 집을 적는다 — **빠뜨리거나 어긋나면 CI 가 실패한다**(`auditFieldHomes`).
 * `home` 은 선언이고, 실제 열·키 유무와 맞는지는 테스트가 **실제 RUNBOOK 표**와 대조한다.
 */
export const LEDGER_FIELDS: readonly LedgerField[] = [
  {
    key: 'date',
    column: '일자',
    envKey: 'RECOVERY_LAST_REHEARSAL',
    home: 'both',
    judgedBy: 'lib/recovery.ts rehearsalFreshness · lib/rehearsalCoverage.ts assessCoverage',
    lost: 'env 쪽이 사라지면 신선도가 `missing` 으로 돌아가 「한 번도 하지 않은 것」이 된다 — 표에는 수행 기록이 남아 있는데도',
  },
  {
    key: 'kind',
    column: '유형',
    envKey: 'RECOVERY_LAST_REHEARSAL_KIND',
    home: 'both',
    judgedBy: 'lib/rehearsalKind.ts assessKind (§6-6) · lib/ledgerPurpose.ts assessPurpose (§6-8 — 원문 `kindRaw` 로 월 점검을 가른다)',
    lost:
      '정기·사건 구분이 사라진다 — 그러면 사건 복구가 리허설 기한을 리셋하고(신선도는 일자·결과만 본다) 리허설 중에 잰 유실 구간이 §1 약속의 실측이 된다(2026-10-21 까지 이 칸은 `judgedBy: null` 이었다 — 집이 둘인데 **읽는 판정이 없는** 상태였다)',
  },
  {
    key: 'target',
    column: '복구 대상 시점',
    envKey: null,
    home: 'table_only',
    judgedBy: 'lib/restorePointRecord.ts assessRecord (§6-7)',
    lost: '그 리허설이 **어느 시점으로** 복구해 봤는지가 사라진다 — §3-6 ε 선택의 유일한 전례이고, 유실 구간의 **시작**이 남는 유일한 영구 자리다(2026-10-22 까지 이 칸은 `judgedBy: null` 이었다 — 파서가 「자유 문자열, 파싱하지 않음」으로 받아 적기만 했다)',
  },
  {
    key: 'duration',
    column: '소요시간',
    envKey: null,
    home: 'table_only',
    judgedBy: 'lib/recoveryObjectives.ts rehearsalAttainment (§1-2 명령·CI 시점 — 런타임은 표를 읽지 않는다)',
    lost: '§1 의 RTO 를 실측으로 채울 유일한 근거가 사라진다(§3-7 `assessDuration` 이 만들어 주는 값이고, 2026-10-20 에 §1-2 가 그 칸을 읽는 판정이 됐다)',
  },
  {
    key: 'result',
    column: '검증 결과',
    envKey: 'RECOVERY_LAST_REHEARSAL_RESULT',
    home: 'both',
    judgedBy: 'lib/recovery.ts rehearsalFreshness',
    lost: 'env 쪽이 사라지면 결과가 **판독 불가**가 되고, 그 상태는 2026-10-20 이전까지 `ok` 로 나갔다(`unknown_result` 로 분리했다)',
  },
  {
    key: 'owner',
    column: '담당',
    envKey: null,
    home: 'table_only',
    judgedBy: 'lib/recovery.ts auditRehearsalRows (CI 시점)',
    lost: '누가 수행했는지가 사라진다 — **env 에는 담지 않는다**(공개 응답에 나가는 PII 다)',
  },
  {
    key: 'note',
    column: '비고',
    envKey: null,
    home: 'table_only',
    judgedBy:
      'lib/restorePointRecord.ts parseRemarkWindow (§6-7 — 구간·고지 시각만. 자유 메모는 읽지 않는다) · lib/remarkSlots.ts assessRemarkSlots (§3-23 — 그 칸에 들어가는 열두 가지의 정본 목록과 「적었는가」)',
    lost:
      '§3-10 `recordRemark()` 가 만들어 주는 구간·고지 시각 메모가 사라진다 — 유실 구간의 **끝**과 고지 수행 근거가 남는 유일한 영구 자리다(두 값의 env 는 복구 뒤 지우는 임시 키다. 2026-10-22 에 §6-7 이 읽는 판정이 됐다). 더해서 §3 소절들이 「비고에 적는다」로 승격시킨 **열 가지가 더** 이 칸에만 산다 — 해제 시각·중단 결정 시각·사본 폐기 기한·세 결정(원본 브랜치·검증 배포 포인터·기준 지문)·기동 쓰기·약속 초과·미도달 가능·유실분 미추출. 2026-10-31 까지 그중 **되읽는 쪽이 있는 것은 구간·고지 둘**뿐이었다(§3-23)',
  },
  {
    key: 'scope',
    column: '범위',
    envKey: 'RECOVERY_LAST_REHEARSAL_SCOPE',
    home: 'both',
    judgedBy: 'lib/rehearsalCoverage.ts assessCoverage',
    lost: '범위 판정이 `unrecorded`(= 판정 불가)로 떨어진다 — **degraded 가 아니라 판정 보류**라서 가장 조용하다. 2026-10-20 에 표에 칸을 만들어 집을 둘로 늘렸다',
  },
  {
    key: 'unpassed',
    column: '미통과 단위',
    envKey: 'RECOVERY_LAST_REHEARSAL_UNPASSED',
    home: 'both',
    judgedBy: 'lib/rehearsalOutcome.ts assessOutcome (§6-5)',
    lost: '`검증 결과` 가 `부분 통과`·`실패` 일 때 **어느 단위가 통과하지 못했는지**가 사라진다 — 범위 판정은 그 단위를 covered 로 세므로 `ok` 이고, 다음 리허설의 재수행 대상에서 조용히 빠진다(2026-10-21 신설. 그전에는 `rehearsalFreshness` 가 「실패 항목을 조치하라」고 지시하면서 **가리킬 목록이 없었다**)',
  },
];

/**
 * §6 표의 **열 순서**. `lib/recovery.ts` 의 `parseRehearsalTable` 은 위치(`cells[0]`~`cells[6]`)로
 * 읽으므로, 열이 하나 끼어들면 **검증 결과가 소요시간 칸에서 읽히는** 식으로 조용히 어긋난다.
 * `auditColumnOrder` 가 이 순서를 매번 고정한다. 새 열은 **맨 뒤에** 붙인다.
 */
export const TABLE_COLUMNS: readonly string[] = [
  '일자',
  '유형',
  '복구 대상 시점',
  '소요시간',
  '검증 결과',
  '담당',
  '비고',
  '범위',
  '미통과 단위',
];

/** `parseRehearsalTable` 이 위치로 읽는 칸 — 이 순서가 바뀌면 그 파서가 어긋난다 */
export const POSITIONAL_COLUMNS: readonly string[] = TABLE_COLUMNS.slice(0, 7);

/* ───────────────────────────── §6 표 읽기 ───────────────────────────── */

export interface LedgerRow {
  /** 표에서의 행 번호(1부터) */
  row: number;
  date: string;
  kind: RehearsalKind;
  /**
   * `유형` 칸의 **원문**. `kind` 는 `normalizeKind` 로 접은 값이라 「정기 점검」(§2 월 점검)과
   * 「정기」(리허설)가 그 순간 같은 값이 된다 — 그 구별은 §6-8 이 이 원문으로만 할 수 있다.
   */
  kindRaw: string;
  target: string;
  durationMin: number | null;
  result: RehearsalResult;
  owner: string;
  note: string;
  /** 범위 기록 원문. 단위 목록 해석은 §6-2 가 한다 */
  scope: string;
  /** 미통과 단위 기록 원문. 해석·판정은 §6-5 가 한다 */
  unpassed: string;
}

export interface LedgerTable {
  /** 표를 찾았는가. **못 찾은 것은 「기록이 없다」가 아니라 판정 보류다** */
  found: boolean;
  /** 실제 헤더 셀 */
  header: string[];
  /** 정본 열 이름 → 위치(없으면 -1) */
  index: Record<string, number>;
  rows: LedgerRow[];
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** 문서에 남겨 둔 미실시·확인필요 표시는 기록이 아니다 */
function isPlaceholder(cell: string): boolean {
  const s = cell.trim();
  if (!s) return true;
  return /^\(?\s*(미실시|미수행|해당\s*없음|없음|n\/?a|tbd|-{1,3})\s*\)?$/i.test(s) || /\[확인\s*필요\]/.test(s);
}

function cellAt(cells: string[], at: number): string {
  if (at < 0) return '';
  const v = cells[at] ?? '';
  return isPlaceholder(v) ? '' : v.trim();
}

/**
 * §6 리허설 표를 **열 이름으로** 읽는다.
 * 표는 헤더에 `일자` 와 `검증 결과` 가 함께 있는 것으로 찾는다 — 그래서 다른 판정 표를
 * 리허설 기록으로 오인하지 않는다(위치 기반 파서는 첫 칸이 날짜꼴이면 아무 표나 읽는다).
 */
export function parseLedgerTable(markdown: unknown): LedgerTable {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const empty: LedgerTable = { found: false, header: [], index: {}, rows: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const header = splitRow(line);
    const hasDate = header.some((c) => c.includes('일자'));
    const hasResult = header.some((c) => c.includes('검증 결과'));
    if (!hasDate || !hasResult) continue;
    const next = lines[i + 1] ?? '';
    if (!next.trim().startsWith('|') || !isSeparator(splitRow(next))) continue;

    const index: Record<string, number> = {};
    for (const name of TABLE_COLUMNS) {
      index[name] = header.findIndex((c) => c.includes(name));
    }
    const rows: LedgerRow[] = [];
    let n = 0;
    for (let j = i + 2; j < lines.length; j += 1) {
      const raw = lines[j];
      if (!raw.trim().startsWith('|')) break;
      const cells = splitRow(raw);
      if (isSeparator(cells)) continue;
      n += 1;
      const date = parseRehearsalDate(cells[index['일자']] ?? '');
      if (!date) continue; // placeholder·빈 행은 기록이 아니다
      rows.push({
        row: n,
        date,
        kind: normalizeKind(cellAt(cells, index['유형'])),
        kindRaw: cellAt(cells, index['유형']),
        target: cellAt(cells, index['복구 대상 시점']),
        durationMin: parseDurationMin(cellAt(cells, index['소요시간'])),
        result: normalizeResult(cellAt(cells, index['검증 결과'])),
        owner: cellAt(cells, index['담당']),
        note: cellAt(cells, index['비고']),
        scope: cellAt(cells, index['범위']),
        unpassed: cellAt(cells, index['미통과 단위']),
      });
    }
    return { found: true, header, index, rows: rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
  }
  return empty;
}

/** 가장 최근(과거 또는 오늘) 행. 미래 일자는 기록으로 세지 않는다 */
export function latestLedgerRow(rows: readonly LedgerRow[], now: Date = new Date()): LedgerRow | null {
  const today = now.toISOString().slice(0, 10);
  const past = rows.filter((r) => r.date <= today);
  if (past.length === 0) return null;
  return past.reduce((a, b) => (a.date >= b.date ? a : b));
}

/* ───────────────────────────── env 쪽 읽기 ───────────────────────────── */

export interface EnvLedger {
  date: string | null;
  /** 일자 키에 **무언가 들어 있었는가** — 미설정과 판독 실패를 구분한다 */
  dateFilled: boolean;
  kind: RehearsalKind;
  kindFilled: boolean;
  result: RehearsalResult;
  resultFilled: boolean;
  /** 범위 원문(해석은 §6-2) */
  scope: string;
  scopeFilled: boolean;
}

/** env 스냅샷을 읽는다 — 값은 **인자로** 받는다(모듈이 `process.env` 를 들고 있지 않다) */
export function envLedger(env: Record<string, string | undefined>): EnvLedger {
  const date = (env.RECOVERY_LAST_REHEARSAL ?? '').trim();
  const kind = (env.RECOVERY_LAST_REHEARSAL_KIND ?? '').trim();
  const result = (env.RECOVERY_LAST_REHEARSAL_RESULT ?? '').trim();
  const scope = (env.RECOVERY_LAST_REHEARSAL_SCOPE ?? '').trim();
  return {
    date: parseRehearsalDate(date),
    dateFilled: date.length > 0,
    kind: normalizeKind(kind),
    kindFilled: kind.length > 0,
    result: normalizeResult(result),
    resultFilled: result.length > 0,
    scope,
    scopeFilled: scope.length > 0,
  };
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export const LEDGER_VERDICTS = [
  'ok',
  'no_record',
  'unreadable_table',
  'unreadable_date',
  'unreadable_result',
  'undurable',
  'table_only',
  'env_only',
  'date_mismatch',
  'result_mismatch',
  'kind_mismatch',
  'scope_mismatch',
] as const;
export type LedgerVerdict = (typeof LEDGER_VERDICTS)[number];

/** 무엇을 보고 판정했는가 — `env` 면 **표를 본 적 없다** */
export type LedgerBasis = 'env' | 'table+env';

export const ACTION_LEDGER_OK =
  '두 기록이 겹치는 칸에서 일치한다. 표에만 있는 칸(복구 대상 시점·소요시간·담당·비고)은 판정이 읽지 않는다 — 사람 기록용이다';
export const ACTION_LEDGER_NO_RECORD =
  '리허설 기록이 양쪽에 없다 — **평상시 상태이고 판정 보류다**(미실시는 `checks.recovery` 가 말한다). 1회 수행하면 §6 표와 env 를 **함께** 적는다';
export const ACTION_LEDGER_UNREADABLE_TABLE =
  'RUNBOOK §6 표를 찾지 못해 대조하지 않는다 — 「일치한다」로 올리지 않는다. 표 헤더(`일자`·`검증 결과`)가 바뀌었으면 이 판정을 함께 본다';
export const ACTION_LEDGER_UNREADABLE_DATE =
  '`RECOVERY_LAST_REHEARSAL` 에 값이 있는데 날짜로 읽히지 않는다 — 대시보드에는 「넣어 두었다」로 보이지만 판정은 **기록 없음**으로 본다. `YYYY-MM-DD` 로 다시 적는다';
export const ACTION_LEDGER_UNREADABLE_RESULT =
  '일자는 있는데 **검증 결과를 읽을 수 없다** — 판독 불가는 통과가 아니다. §6 표의 `검증 결과` 칸과 같은 값(`정상`/`부분 통과`/`실패`)을 `RECOVERY_LAST_REHEARSAL_RESULT` 에 적는다';
export const ACTION_LEDGER_UNDURABLE =
  '판정이 읽는 값이 **env 에만 있다** — 저장소에 남지 않으므로 시크릿 유실·Promote 롤백에서 그대로 사라진다. §6 표에 그 열을 만들고 같은 값을 적는다(§6-4)';
export const ACTION_LEDGER_TABLE_ONLY =
  '표에는 기록이 있는데 **판정이 읽는 env 가 비어 있다** — 복구·롤백으로 사라졌을 수 있다. §6-4 명령으로 표에서 복원 줄을 만들어 넣는다(값을 지어내지 않는다)';
export const ACTION_LEDGER_ENV_ONLY =
  'env 에는 기록이 있는데 **표에 그 행이 없다** — 저장소에 근거가 없으므로 담당·소요시간·대상 시점은 되찾을 수 없다. §6 표에 그 리허설 행을 적는다';
export const ACTION_LEDGER_MISMATCH =
  '두 기록이 **다른 말을 한다** — 어느 쪽이 사실인지 판정이 정하지 않는다. 표를 정본으로 보고 env 를 맞추거나(§6-4), 표가 밀렸으면 표를 고친다';

const ACTION: Record<LedgerVerdict, string> = {
  ok: ACTION_LEDGER_OK,
  no_record: ACTION_LEDGER_NO_RECORD,
  unreadable_table: ACTION_LEDGER_UNREADABLE_TABLE,
  unreadable_date: ACTION_LEDGER_UNREADABLE_DATE,
  unreadable_result: ACTION_LEDGER_UNREADABLE_RESULT,
  undurable: ACTION_LEDGER_UNDURABLE,
  table_only: ACTION_LEDGER_TABLE_ONLY,
  env_only: ACTION_LEDGER_ENV_ONLY,
  date_mismatch: ACTION_LEDGER_MISMATCH,
  result_mismatch: ACTION_LEDGER_MISMATCH,
  kind_mismatch: ACTION_LEDGER_MISMATCH,
  scope_mismatch: ACTION_LEDGER_MISMATCH,
};

/** 어긋남이 생기는 세 방향 — 전부 **응답은 200 이라** 사람 눈으로는 알아챌 수 없다 */
export const LEDGER_DRIFTS: readonly { key: string; how: string }[] = [
  {
    key: 'judged_record_is_the_volatile_one',
    how: '판정은 env 만 읽는데 그 자리는 §4 가 「복구 대상」으로 선언한 곳이다 — 시크릿 유실·프로젝트 재생성으로 사라지면 신선도는 `missing`, 범위는 `unrecorded`(판정 보류)로 내려앉는다. 저장소의 표에는 그 리허설이 남아 있는데도 아무도 되돌리지 않는다',
  },
  {
    key: 'rollback_restores_old_record',
    how: 'Promote 롤백은 **옛 배포의 env 스냅샷**으로 돌아간다(§5-1) — 기록이 옛 값·공백으로 되돌아가도 날짜가 기한 안이면 `ok` 가 유지되고, 범위는 판정 보류라 degraded 조차 아니다',
  },
  {
    key: 'two_records_drift_apart',
    how: '표에만 적고 env 를 갱신하지 않거나(판정은 옛 리허설을 말한다), env 만 갱신하고 표를 비워 둔다(저장소에 근거가 없다) — 어느 쪽도 오류를 내지 않는다',
  },
];

/** 보장하지 **못하는** 것 — 응답·RUNBOOK 에 함께 내보낸다 */
export const LEDGER_LIMITS: readonly string[] = [
  '`basis` 가 `env` 면 이 판정은 **표를 보지 않았다** — 런타임은 저장소 파일을 읽지 않는다(값 대조는 §6-4 명령과 CI 가 한다)',
  '대조는 **표의 최신 행**과 env 를 본다 — 과거 행의 어긋남은 보지 않는다',
  '`ok` 는 「두 기록이 같다」까지만 뜻한다 — **둘 다 틀렸을 수 있다**(수행 여부는 §6-2 범위·표의 `검증 결과` 가 말한다)',
  '표에만 있는 칸(복구 대상 시점·소요시간·비고)은 **읽는 판정이 없다**(`unjudged`) — 적는 것은 사람 기록용이고, 소요시간은 §1 RTO 를 실측으로 채울 유일한 근거다',
  '담당은 **env 에 담지 않는다**(공개 응답 PII) — 그래서 저장소까지 함께 잃는 사고에는 되찾을 근거가 없다',
  '범위 값의 단위 목록 해석은 §6-2 가 한다 — 여기서는 **값이 있는지**와 표의 같은 칸과 같은지만 본다',
  '`no_record` 는 평상시 상태다 — 미실시 자체는 `checks.recovery` 가 `missing` 으로 말한다(중복 보고 금지)',
];

export interface LedgerAssessment {
  verdict: LedgerVerdict;
  basis: LedgerBasis;
  /** 표에서 읽은 최신 행의 일자(없으면 null) */
  tableDate: string | null;
  /** env 가 말하는 일자(없으면 null) */
  envDate: string | null;
  /** 표의 기록 행 수 */
  tableRows: number;
  /** 두 기록이 다른 칸 */
  differs: string[];
  /** 집이 하나인 칸 */
  singleHomed: string[];
  /** env 에 채워져 있는데 표에 열이 없는 칸 — 저장소에 남지 않는다 */
  undurable: string[];
  /** 적히지만 **읽는 판정이 없는** 칸 */
  unjudged: string[];
  action: string;
  caveats: readonly string[];
}

/** 집이 하나인 칸 */
export function singleHomedFields(fields: readonly LedgerField[] = LEDGER_FIELDS): string[] {
  return fields.filter((f) => f.home !== 'both').map((f) => f.key);
}

/** 적히지만 읽는 판정이 없는 칸 */
export function unjudgedFields(fields: readonly LedgerField[] = LEDGER_FIELDS): string[] {
  return fields.filter((f) => f.judgedBy === null).map((f) => f.key);
}

function envValueOf(e: EnvLedger, key: LedgerField['key']): string {
  if (key === 'date') return e.dateFilled ? '1' : '';
  if (key === 'kind') return e.kindFilled ? '1' : '';
  if (key === 'result') return e.resultFilled ? '1' : '';
  if (key === 'scope') return e.scopeFilled ? '1' : '';
  return '';
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 두 기록 대조.
 * `rows` 를 넘기지 않으면(런타임) env 쪽만 판정하고 `basis: 'env'` 로 그 사실을 남긴다 —
 * **표를 못 봤다는 것을 「일치한다」로 바꾸지 않는다.**
 *
 * 판정 순서: 판독 불가 → 내구성 → 한쪽만 있음 → 칸 어긋남 → ok.
 * **거짓 `ok` 를 막는 것이 기록 자격보다 먼저다**(§4-10·§6-2 와 같은 규율).
 */
export function reconcileLedger(args: {
  env: Record<string, string | undefined>;
  /** §6 표 원문. 넘기지 않으면 표를 보지 않은 것으로 판정한다 */
  markdown?: string | null;
  now?: Date;
  fields?: readonly LedgerField[];
}): LedgerAssessment {
  const fields = args.fields ?? LEDGER_FIELDS;
  const now = args.now ?? new Date();
  const e = envLedger(args.env);
  const sawTable = typeof args.markdown === 'string';
  const table = sawTable ? parseLedgerTable(args.markdown) : null;
  const latest = table && table.found ? latestLedgerRow(table.rows, now) : null;

  const undurable = fields
    .filter((f) => f.envKey && !f.column && envValueOf(e, f.key))
    .map((f) => f.key);

  const shell = {
    basis: (sawTable ? 'table+env' : 'env') as LedgerBasis,
    tableDate: latest?.date ?? null,
    envDate: e.date,
    tableRows: table?.rows.length ?? 0,
    singleHomed: singleHomedFields(fields),
    undurable,
    unjudged: unjudgedFields(fields),
    caveats: LEDGER_LIMITS,
  };
  const done = (verdict: LedgerVerdict, differs: string[] = []): LedgerAssessment => ({
    ...shell,
    verdict,
    differs,
    action: ACTION[verdict],
  });

  if (sawTable && !(table as LedgerTable).found) return done('unreadable_table');
  if (!e.dateFilled && !latest) return done('no_record');
  // 값이 들어 있는데 날짜로 읽히지 않는 것은 **미설정과 다르다** — 조용히 기록 없음으로 넘기지 않는다.
  if (e.dateFilled && !e.date) return done('unreadable_date', ['date']);
  if (e.date && e.result === 'unknown') return done('unreadable_result', ['result']);
  if (undurable.length > 0) return done('undurable', undurable);
  if (!e.date && latest) return done('table_only');
  if (e.date && sawTable && !latest) return done('env_only');
  if (e.date && latest) {
    const differs: string[] = [];
    if (latest.date !== e.date) differs.push('date');
    if (latest.result !== e.result) differs.push('result');
    if (latest.kind !== 'unknown' && e.kind !== 'unknown' && latest.kind !== e.kind) differs.push('kind');
    if (e.scopeFilled && norm(latest.scope) !== norm(e.scope)) differs.push('scope');
    if (differs.includes('date')) return done('date_mismatch', differs);
    if (differs.includes('result')) return done('result_mismatch', differs);
    if (differs.includes('kind')) return done('kind_mismatch', differs);
    if (differs.includes('scope')) return done('scope_mismatch', differs);
  }
  return done('ok');
}

/* ───────────────────────────── 복원 ───────────────────────────── */

/**
 * 표의 한 행에서 env 복원 줄을 만든다(§4 시크릿 유실·Promote 롤백 뒤에 쓴다).
 * **없는 값은 지어내지 않는다** — 빈 칸은 `[확인 필요]` 로 남기고, 담당·비고는 담지 않는다
 * (공개 엔드포인트에 나가는 PII·자유 메모다).
 */
export function ledgerRestoreLines(row: LedgerRow | null): string[] {
  if (!row) return ['# 복원할 기록이 없다 — §6 표에 리허설 행이 없다(값을 지어내지 않는다)'];
  const resultText = { pass: '정상', partial: '부분 통과', fail: '실패', unknown: '[확인 필요]' }[row.result];
  const kindText = { periodic: '정기', incident: '사건', unknown: '[확인 필요]' }[row.kind];
  return [
    `RECOVERY_LAST_REHEARSAL=${row.date}`,
    `RECOVERY_LAST_REHEARSAL_RESULT=${resultText}`,
    `RECOVERY_LAST_REHEARSAL_KIND=${kindText}`,
    `RECOVERY_LAST_REHEARSAL_SCOPE=${row.scope || '[확인 필요]'}`,
    // 미통과 칸은 **비어 있는 것이 정상**(전부 통과)이라 `[확인 필요]` 로 메우지 않는다 —
    // 값이 있을 때만 복원한다. 비었는데 결과가 미통과면 §6-5 가 `unattributed` 로 말한다.
    ...(row.unpassed ? [`RECOVERY_LAST_REHEARSAL_UNPASSED=${row.unpassed}`] : []),
  ];
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/**
 * `/api/health` 체크. **required: false** — 기록이 어긋났다고 서비스를 내리면 복구가 자기 자신을 막는다.
 * 런타임은 **표를 읽지 않으므로** `basis: 'env'` 이고, 그 사실을 응답에 적는다.
 * 평상시(기록 없음)는 `no_record` 로 ok 다 — 미실시는 `checks.recovery` 가 말한다(중복 보고 금지).
 */
export function rehearsalLedgerCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const a = reconcileLedger({ env: args?.env ?? process.env, now: args?.now });
  return {
    ok: a.verdict === 'ok' || a.verdict === 'no_record',
    required: false,
    detail: {
      verdict: a.verdict,
      basis: a.basis,
      envDate: a.envDate,
      differs: a.differs,
      singleHomed: a.singleHomed,
      undurable: a.undurable,
      unjudged: a.unjudged,
      drifts: LEDGER_DRIFTS.map((d) => d.key),
      runbook: LEDGER_RUNBOOK_REF,
      limits: LEDGER_LIMITS,
      action: a.action,
    },
  };
}

/** 사람이 읽는 요약(§6-4 명령·보고용). 수치를 지어내지 않는다 */
export function ledgerText(a: LedgerAssessment): string[] {
  const lines = [`판정: ${a.verdict} (근거 ${a.basis})`, `표 ${a.tableDate ?? '-'} / env ${a.envDate ?? '-'}`];
  if (a.differs.length > 0) lines.push(`어긋난 칸: ${a.differs.join(', ')}`);
  if (a.undurable.length > 0) lines.push(`저장소에 남지 않는 칸: ${a.undurable.join(', ')}`);
  lines.push(`집이 하나인 칸: ${a.singleHomed.join(', ') || '-'}`);
  lines.push(`읽는 판정이 없는 칸: ${a.unjudged.join(', ') || '-'}`);
  lines.push(`해야 할 일: ${a.action}`);
  return lines;
}

/** 운영 로그 한 줄 — 판정·일자·칸 이름만 담는다(담당·비고·설정값 없음) */
export function ledgerLogLine(a: LedgerAssessment): string {
  const parts = [
    '[rehearsalLedger]',
    `verdict=${a.verdict}`,
    `basis=${a.basis}`,
    `table=${a.tableDate ?? '-'}`,
    `env=${a.envDate ?? '-'}`,
    `rows=${a.tableRows}`,
  ];
  if (a.differs.length > 0) parts.push(`differs=${a.differs.join('|')}`);
  if (a.undurable.length > 0) parts.push(`undurable=${a.undurable.join('|')}`);
  return parts.join(' ');
}

/** 배선 상태 요약(문서·보고용) */
export function ledgerStatus(env: Record<string, string | undefined>): {
  verdict: LedgerVerdict;
  envRecorded: boolean;
  singleHomed: number;
  unjudged: number;
  limits: number;
  action: string;
} {
  const a = reconcileLedger({ env });
  return {
    verdict: a.verdict,
    envRecorded: a.envDate !== null,
    singleHomed: a.singleHomed.length,
    unjudged: a.unjudged.length,
    limits: LEDGER_LIMITS.length,
    action: a.action,
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * §6 표의 **열 순서**가 `lib/recovery.ts` 의 위치 기반 파서와 맞는지.
 * 열이 중간에 끼어들면 `검증 결과` 가 `소요시간` 칸에서 읽히는 식으로 조용히 어긋난다 —
 * 표가 비어 있는 동안에는 행 무결성 점검으로도 드러나지 않는다.
 */
export function auditColumnOrder(markdown: unknown, fields: readonly LedgerField[] = LEDGER_FIELDS): string[] {
  const table = parseLedgerTable(markdown);
  if (!table.found) return ['RUNBOOK §6 리허설 표를 찾지 못했다 — 헤더에 `일자`·`검증 결과` 가 있어야 한다'];
  const problems: string[] = [];
  POSITIONAL_COLUMNS.forEach((name, at) => {
    const found = table.index[name];
    if (found !== at) {
      problems.push(
        `열 \`${name}\` 이(가) ${at} 번이 아니라 ${found} 번이다 — lib/recovery.ts 의 parseRehearsalTable 은 위치로 읽으므로 ` +
          '다른 칸을 그 칸으로 읽는다(새 열은 맨 뒤에 붙인다)',
      );
    }
  });
  for (const f of fields) {
    if (f.column && (table.index[f.column] ?? -1) < 0) {
      problems.push(`칸 ${f.key} 의 열 \`${f.column}\` 이(가) 표에 없다 — 기록의 집이 선언과 다르다`);
    }
  }
  return problems;
}

/**
 * 칸마다 **집이 선언돼 있고 실제와 맞는지**, env 키가 레지스트리에 있고 **임시 키가 아닌지**.
 * 임시 키로 넣으면 §2 키 이름 스냅샷에서 빠져(평상시 미설정이 정상인 키로 취급된다)
 * 복구 때 이 기록의 유실이 드러나지 않는다 — 리허설 근거는 **영구 기록**이다.
 */
export function auditFieldHomes(
  fields: readonly LedgerField[] = LEDGER_FIELDS,
  vars: readonly { key: string }[] = ENV_VARS,
  transient: readonly string[] = TRANSIENT_KEYS,
): string[] {
  const known = new Set(vars.map((v) => v.key));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) problems.push(`칸 ${f.key} 가 정본에 두 번 있다`);
    seen.add(f.key);
    if (!f.column && !f.envKey) problems.push(`칸 ${f.key} 에 집이 하나도 없다 — 기록되지 않는 칸이다`);
    const expected: LedgerHome = f.column && f.envKey ? 'both' : f.column ? 'table_only' : 'env_only';
    if (f.home !== expected) {
      problems.push(`칸 ${f.key} 의 home 선언(${f.home})이 실제 집(${expected})과 다르다`);
    }
    if (!f.lost.trim()) problems.push(`칸 ${f.key} 에 유실 시 생기는 일이 적혀 있지 않다`);
    if (f.envKey && !known.has(f.envKey)) problems.push(`${f.envKey} 가 env 레지스트리에 없다`);
    if (f.envKey && transient.includes(f.envKey)) {
      problems.push(`${f.envKey} 가 임시 키 목록에 있다 — 리허설 근거는 평상시에도 남아 있어야 하는 영구 기록이다`);
    }
    if (f.home === 'env_only') {
      problems.push(
        `칸 ${f.key} 는 env 에만 산다 — 저장소에 남지 않으므로 시크릿 유실·Promote 롤백에서 사라진다. ` +
          '§6 표에 열을 만들어 집을 둘로 늘릴 것(그럴 수 없는 이유가 있으면 이 가드와 함께 적을 것)',
      );
    }
  }
  return problems;
}

/**
 * 판정의 **입력 자리**가 그대로인지(`lib/recovery.ts`).
 * (가) env 3키를 여전히 읽는가 — 옮겨 가면 이 대조가 빈 env 를 보며 조용히 `no_record` 를 낸다.
 * (나) **판독 불가 결과를 `ok` 로 올리지 않는가** — 2026-10-20 에 분리한 `unknown_result` 분기가
 *      사라지면 키 하나 유실이 「리허설 통과」로 되돌아간다(응답은 200 이라 알아챌 수 없다).
 */
export function auditRecordSources(recoverySrc: unknown): string[] {
  const s = String(recoverySrc ?? '');
  const problems: string[] = [];
  for (const key of ['RECOVERY_LAST_REHEARSAL', 'RECOVERY_LAST_REHEARSAL_RESULT', 'RECOVERY_LAST_REHEARSAL_KIND']) {
    if (!s.includes(key)) problems.push(`lib/recovery.ts 가 ${key} 를 더 이상 읽지 않는다 — 대조의 한쪽이 사라졌다`);
  }
  if (!/unknown_result/.test(s)) {
    problems.push(
      'lib/recovery.ts 에 unknown_result 판정이 없다 — 결과 판독 불가가 다시 `ok` 로 올라간다(키 하나 유실이 「통과」가 된다)',
    );
  }
  if (!/parseRehearsalTable/.test(s)) problems.push('lib/recovery.ts 에 parseRehearsalTable 이 없다 — 표 쪽 파서가 사라졌다');
  return problems;
}

/** §6-4·범위 열·복원 명령·체크리스트 항목이 문서에 남아 있는지 */
export function auditRunbookLedger(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-4\./m.test(s)) problems.push('§6-4 절이 사라졌다 — 두 기록을 대조하는 절차의 유일한 자리다');
  if (!/checks\.rehearsalLedger/.test(s)) problems.push('RUNBOOK 에 checks.rehearsalLedger 확인 지시가 없다');
  if (!/ledgerRestoreLines/.test(s)) problems.push('§6-4 에 표에서 env 를 복원하는 명령이 없다');
  for (const d of LEDGER_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§6-4 에 어긋남 방향 ${d.key} 가 없다`);
  }
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) {
    problems.push('§6 에 리허설 체크리스트가 없다');
  } else {
    const checklist = s.slice(at);
    if (!/6-4/.test(checklist)) problems.push('리허설 체크리스트가 §6-4 를 가리키지 않는다');
    if (!/checks\.rehearsalLedger/.test(checklist)) problems.push('리허설 체크리스트에 두 기록을 대조하는 항목이 없다');
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴도 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalLedger['"]/.test(s)) problems.push('rehearsalLedger 를 import 하지 않는다');
  if (!/rehearsalLedgerCheck\(/.test(s)) problems.push('rehearsalLedgerCheck() 를 호출하지 않는다');
  if (!/checks\.rehearsalLedger\s*=\s*rehearsalLedgerCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.rehearsalLedger 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  return problems;
}
