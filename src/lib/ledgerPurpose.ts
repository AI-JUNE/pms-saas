/**
 * ledgerPurpose.ts — §6 표의 행이 **무엇의 기록인가**(RUNBOOK §2 · §6 · §6-8). 2026-10-23
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6 표는 「복구 리허설 기록」이고 머리말은 그것을 「운영 DB가 **아닌** 복구 브랜치에서 수행한
 * 연습」으로 정의한다. §6-6 은 2026-10-21 에 그 표의 `유형` 칸을 읽는 판정을 만들어 「연습」과
 * 「사건」을 갈라 놓았다 — 사건은 기한을 리셋하지 못하고, 연습 구간은 §1 약속의 실측이 되지
 * 못한다. 그런데 **그 표에 행을 적으라고 지시하는 절이 하나 더 있다**: §2 「정기 점검(월 1회)」
 * 6번 — 「아래 6절 리허설 표에 점검 결과 1줄 기록」.
 *
 * 월 점검은 §3 절차를 **하나도 수행하지 않는다.** 콘솔에서 보존 창을 보고, `/api/health` 를
 * 읽고, 기준 스냅샷을 복사하는 일이다(§2 1~7번). 그런데 그 행이 들어갈 칸의 어휘는
 * `유형(정기/사건)` 둘뿐이라 **점검을 적을 값이 없었다.** 그래서 세 갈래 전부가 거짓으로 끝난다.
 *
 *  (1) **「정기」라고 적으면 연습이 된다.** `lib/recovery.ts` 의 `normalizeKind` 는 부분 문자열로
 *      판정하므로(`s.includes('정기')`) §2 의 절 이름 그대로 「정기 점검」이라고 적어도
 *      `periodic` 이다 — **§6-6 이 사건에 대해 막아 둔 길이 월 점검에게는 열려 있다.**
 *      `intervalBasis` 는 그 행을 정기 리허설로 세어 기한을 매월 리셋하고, 그러면 리허설을
 *      **한 번도 하지 않아도** 「검증됐다」가 영구히 유지된다.
 *  (2) **그 행이 §1 약속의 실측이 된다.** §1-2 `rehearsalAttainment` 는 `latestLedgerRow` 로
 *      **표의 최신 행**을 읽는데, 월 점검은 매월 들어오므로 거의 항상 그 행이 최신이다.
 *      점검은 몇 분이면 끝나고 결과는 `정상` 으로 적히므로 §6-5 자격 게이트를 그대로 통과해
 *      `attainment.rto` 가 `met`(= 목표를 지켰다)이 된다 — 복구를 한 적이 없는 수치로.
 *  (3) **비워 두는 길도 「정기」로 몰린다.** 유형 칸을 비우면 §6-4 가 표와 env 를 대조해
 *      `date_mismatch` 를 내고 「표와 env 를 같은 값으로 맞추라」고 지시한다 — 맞추는 방향은
 *      **점검을 리허설 env 로 올리는 쪽**이다. 기록을 지키려고 만든 판정이 점검을 리허설로
 *      승격시킨다. 어느 단계도 오류를 내지 않고 응답은 전부 200 이다.
 *
 *  (4) **구별할 근거가 파싱 단계에서 사라졌다.** `parseLedgerTable` 은 `유형` 칸을
 *      `normalizeKind` 로 **접어서** `LedgerRow.kind` 에 담는다 — 「정기 점검」과 「정기」가
 *      그 순간 같은 값이 되어, 뒤의 어떤 판정도 둘을 되살릴 수 없었다(`kindRaw` 신설).
 *
 * 그래서 이 모듈은
 *   · 행의 **목적**을 세 갈래로 두고(`purposeState` — **「정기 점검」은 `ambiguous` 다.**
 *     두 토큰이 겹치면 어느 쪽도 고르지 않는다),
 *   · 세 목적이 **무엇을 수행하고 무엇을 할 자격이 있는가**를 정본으로 적고(`PURPOSE_ROLES` —
 *     §6-6 `KIND_ROLES` 와 양방향으로 맞춘다),
 *   · 점검 행을 리허설 판정에서 **빼고**(`rehearsalRows`·`latestRehearsalRow` — §1-2 가 이
 *     게이트를 쓴다), 점검이 env 로 승격됐는지 본다(`promotedIntoEnv`),
 *   · 그 상태를 `/api/health` 로 드러낸다(`ledgerPurposeCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 env 0 · 신규 조회·쓰기·DDL 0**
 *   (이미 적게 되어 있던 칸을 읽는다). env 는 인자로 받는다.
 * - **임의 귀속 금지.** 코드는 행의 실제 성격을 알지 못한다 — 적힌 말만 본다. 겹치는 말은
 *   `ambiguous` 로 두고 어느 쪽으로도 올리지 않으며, 점검으로 **추정해서** 행을 빼지 않는다.
 * - **중복 보고 금지.** 미실시는 `checks.recovery`, 연습/사건은 `checks.rehearsalKind`,
 *   점검이 밀렸는지는 `checks.periodicCheck` 가 말한다 — 이 체크가 말하는 것은 **목적**이다.
 * - **값을 담지 않는다** — 판정·목적·날짜·칸 이름뿐이다(소요시간·담당·비고 없음).
 */
import { parseRehearsalDate } from './recovery.ts';
import { kindState, type KindRole, type KindState } from './rehearsalKind.ts';
import { latestLedgerRow, type LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const PURPOSE_RUNBOOK_REF = 'RUNBOOK §2 · §6 · §6-8';

/** §6 표에서 목적을 적는 열(§6-4 `LEDGER_FIELDS.kind`) */
export const PURPOSE_COLUMN = '유형';

/** 그 열의 짝이 되는 env 키 — **점검은 여기에 적지 않는다**(한 벌은 마지막 정기 리허설의 값이다) */
export const PURPOSE_ENV = 'RECOVERY_LAST_REHEARSAL_KIND';

/** 월 점검 행에 적는 값(신설 어휘). 기존 두 값은 §6-6 이 정한 그대로다 */
export const CHECK_VALUE = '점검';

/** 표 `유형` 열이 받는 값 전부 */
export const PURPOSE_VALUES: readonly string[] = ['정기', '사건', CHECK_VALUE];

/* ─────────────────── 「목적」의 경계(한 곳에 둔다) ─────────────────── */

/**
 * - `rehearsal` : `정기` — 복구 브랜치에서 §3 절차를 **검증한** 연습(§6-6 `regular`).
 * - `incident`  : `사건` — 실제로 일어난 복구. 절차의 **사용**이다(§6-6 `incident`).
 * - `check`     : `점검` — §2 월 점검. **§3 절차를 하나도 수행하지 않는다.**
 * - `ambiguous` : 두 갈래의 말이 겹친다(「정기 점검」) — **어느 쪽도 고르지 않는다.**
 * - `unreadable`: 값이 있는데 어느 쪽으로도 읽히지 않는다.
 * - `absent`    : 칸이 비어 있다.
 */
export type RowPurpose = 'rehearsal' | 'incident' | 'check' | 'ambiguous' | 'unreadable' | 'absent';

const CHECK_RE = /점\s*검|monthly|check/i;
const REGULAR_RE = /정기|periodic|scheduled/i;
const INCIDENT_RE = /사건|장애|incident/i;

/**
 * 원문 한 칸을 읽는다.
 *
 * **「정기 점검」을 `rehearsal` 로 올리지 않는다** — `normalizeKind` 는 부분 문자열
 * `정기` 만 보고 `periodic` 을 돌려주는데, 그것이 이 모듈이 생긴 이유다(§2 의 절 이름이
 * 하필 「정기 점검」이다). 겹치는 말은 `ambiguous` 로 두고 사람에게 되묻는다.
 */
export function purposeState(raw: unknown): RowPurpose {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return 'absent';
  const check = CHECK_RE.test(s);
  if (check && (REGULAR_RE.test(s) || INCIDENT_RE.test(s))) return 'ambiguous';
  if (check) return 'check';
  const k: KindState = kindState(s);
  if (k === 'regular') return 'rehearsal';
  if (k === 'incident') return 'incident';
  return 'unreadable';
}

/**
 * 표 한 행의 목적. 파서가 원문(`kindRaw`)을 담아 주면 그것을 읽고, **원문이 없으면**
 * 접힌 값(`kind`)으로만 판정한다 — 그 경우 `점검` 은 되살릴 수 없으므로 `unreadable` 이다
 * (판정 보류이고, 점검으로 **추정하지 않는다**).
 */
export function purposeOfRow(row: Pick<LedgerRow, 'kind'> & { kindRaw?: string }): RowPurpose {
  if (typeof row?.kindRaw === 'string' && row.kindRaw.trim()) return purposeState(row.kindRaw);
  if (row?.kind === 'periodic') return 'rehearsal';
  if (row?.kind === 'incident') return 'incident';
  return 'unreadable';
}

/* ─────────────────── 목적이 무엇을 할 자격이 있는가(정본) ─────────────────── */

export interface PurposeRole {
  purpose: 'rehearsal' | 'incident' | 'check';
  /** 표에 적는 값 */
  value: string;
  /** 어느 절이 이 행을 적으라고 지시하는가 */
  writtenBy: string;
  /** 그 행이 실제로 수행한 것 */
  exercises: string;
  /** 정기 리허설 **기한**을 리셋할 자격이 있는가 */
  resetsInterval: boolean;
  /** 소요시간을 §1 약속의 실측으로 쓸 수 있는가 */
  rtoEvidence: 'measurement' | 'lower_bound' | 'none';
  /** 지난 미통과 단위를 **해소**할 수 있는가(§6-5) */
  resolvesUnpassed: boolean;
  /** §6-2 범위 귀속의 대상인가 */
  countsAsCoverage: boolean;
}

export const PURPOSE_ROLES: readonly PurposeRole[] = [
  {
    purpose: 'rehearsal',
    value: '정기',
    writtenBy: '§6 리허설 체크리스트',
    exercises: '복구 브랜치에서 §3 절차 단위를 수행한다(무엇을 수행·통과했는지는 §6-2·§6-5 가 말한다)',
    resetsInterval: true,
    rtoEvidence: 'lower_bound',
    resolvesUnpassed: true,
    countsAsCoverage: true,
  },
  {
    purpose: 'incident',
    value: '사건',
    writtenBy: '§3 8단계',
    exercises: '실제 복구를 수행한다 — 절차의 **사용**이고 검증이 아니다',
    resetsInterval: false,
    rtoEvidence: 'measurement',
    resolvesUnpassed: false,
    countsAsCoverage: false,
  },
  {
    purpose: 'check',
    value: CHECK_VALUE,
    writtenBy: '§2 월 점검 6번',
    exercises:
      '§2 1~7번 — 콘솔에서 보존 창 확인 · `/api/health` 읽기 · 기준 스냅샷 갱신. **§3 절차는 하나도 수행하지 않는다**',
    resetsInterval: false,
    rtoEvidence: 'none',
    resolvesUnpassed: false,
    countsAsCoverage: false,
  },
];

export function roleForPurpose(purpose: unknown): PurposeRole | null {
  return PURPOSE_ROLES.find((r) => r.purpose === purpose) ?? null;
}

/* ─────────────────── 구별하지 않으면 무엇이 잘못 말하는가(정본) ─────────────────── */

export interface PurposeMisread {
  key: string;
  /** 잘못 말하는 판정 */
  reader: string;
  /** 그 판정이 내놓는 말 */
  says: string;
  /** 왜 그렇게 되는가 */
  why: string;
}

export const PURPOSE_MISREADS: readonly PurposeMisread[] = [
  {
    key: 'interval_reset_by_check',
    reader: '§6-6 `intervalBasis.basis`',
    says: '`regular` — 「기한의 근거가 정기 행이다」',
    why: '`normalizeKind` 는 부분 문자열 `정기` 로 판정한다 — §2 의 절 이름 그대로 「정기 점검」이라고 적어도 정기 리허설 행이 되어 기한이 **매월** 리셋된다. 사건에 대해 막아 둔 길이 월 점검에는 열려 있다',
  },
  {
    key: 'rto_from_check',
    reader: '§1-2 `rehearsalAttainment.rto`',
    says: '`met` — 「목표를 지켰다」',
    why: '`latestLedgerRow` 는 목적과 무관하게 **표의 최신 행**을 읽는데 월 점검은 매월 들어와 거의 항상 최신이다. 점검은 몇 분이고 결과는 `정상` 이라 §6-5 자격 게이트를 그대로 통과한다 — 복구를 한 적이 없는 수치로 약속이 지켜진다',
  },
  {
    key: 'ledger_pushes_promotion',
    reader: '§6-4 `assessLedger.verdict`',
    says: '`date_mismatch` — 「표와 env 를 같은 값으로 맞추라」',
    why: '맞추는 방향이 **점검을 리허설 env 로 올리는 쪽**이다(표의 최신 행이 점검이기 때문이다). 기록을 지키려고 만든 판정이 점검을 리허설로 승격시킨다',
  },
  {
    key: 'blank_pushed_to_regular',
    reader: '§6-6 `assessKind.verdict`',
    says: '`unknown_kind` — degraded',
    why: '적을 값이 없어 칸을 비우면 매월 판정 보류가 뜬다. 그 degraded 를 지우는 가장 쉬운 길이 `정기` 를 적는 것이다 — **비워 두는 길도 정기로 몰린다**',
  },
  {
    key: 'raw_folded_at_parse',
    reader: '`parseLedgerTable` → `LedgerRow.kind`',
    says: '`periodic`',
    why: '파서가 `normalizeKind` 로 **접어서** 담으므로 「정기 점검」과 「정기」가 그 순간 같은 값이 된다 — 뒤의 어떤 판정도 둘을 되살릴 수 없었다(`kindRaw` 신설 이유)',
  },
];

/** 어긋남의 세 방향 — 어느 쪽도 오류를 내지 않는다 */
export interface PurposeDrift {
  key: string;
  when: string;
  quiet: string;
}

export const PURPOSE_DRIFTS: readonly PurposeDrift[] = [
  {
    key: 'section_disagreement',
    when: '§6 머리말은 이 표를 「복구 리허설 기록」으로 정의하는데 §2 6번은 월 점검을 같은 표에 적으라고 지시한다',
    quiet: '한 표에 성격이 다른 행이 섞이고, 판정은 전부 「리허설 표」라는 전제로 최신 행을 읽는다',
  },
  {
    key: 'vocabulary_gap',
    when: '표 머리의 어휘가 `정기/사건` 둘뿐이라 점검을 적을 값이 없다',
    quiet: '적는 사람이 `정기` 와 공란 중에서 고르는데, 두 길이 모두 정기 리허설로 끝난다',
  },
  {
    key: 'token_overlap',
    when: '`normalizeKind` 가 부분 문자열 `정기` 로 판정한다',
    quiet: '「정기 점검」·「정기 환경 점검」 같은 표기가 전부 리허설 행이 된다 — 글자는 점검이라고 적혀 있는데 판정은 연습이다',
  },
];

/* ─────────────────── 점검 행이 비워 두어야 하는 칸 ─────────────────── */

/**
 * 점검 행은 §3 절차를 수행하지 않았으므로 아래 칸에 값이 있으면 **그 값이 리허설 수치로 읽힌다**.
 * 규율이지 추측이 아니다 — 비어 있는 것이 「수행하지 않았다」를 뜻한다.
 */
export const CHECK_ROW_EMPTY_CELLS: readonly { column: string; why: string }[] = [
  { column: '소요시간', why: '§1-2 가 이 칸을 RTO 실측으로 읽는다 — 점검 소요시간이 약속의 근거가 된다' },
  { column: '복구 대상 시점', why: '§6-7 이 유실 구간의 시작으로 읽는다 — 점검은 되감은 적이 없다' },
  { column: '범위', why: '§6-2 가 수행한 절차 단위로 읽는다 — 점검은 §3 단위를 수행하지 않는다' },
  { column: '미통과 단위', why: '§6-5 가 재수행 대상 산출에 쓴다 — 점검에는 통과·미통과가 없다' },
];

export interface CheckRowShape {
  /** 점검 행인가 */
  isCheck: boolean;
  /** 비어 있어야 하는데 값이 있는 칸 */
  unexpected: string[];
  note: string;
}

export function checkRowShape(row: (Pick<LedgerRow, 'kind' | 'durationMin' | 'target' | 'scope' | 'unpassed'>) & { kindRaw?: string }): CheckRowShape {
  const purpose = purposeOfRow(row);
  if (purpose !== 'check') {
    return { isCheck: false, unexpected: [], note: '점검 행이 아니다 — 이 규율은 §2 가 적는 행에만 적용된다' };
  }
  const filled: Record<string, boolean> = {
    소요시간: row.durationMin !== null && row.durationMin !== undefined,
    '복구 대상 시점': Boolean(row.target && row.target.trim()),
    범위: Boolean(row.scope && row.scope.trim()),
    '미통과 단위': Boolean(row.unpassed && row.unpassed.trim()),
  };
  const unexpected = CHECK_ROW_EMPTY_CELLS.filter((c) => filled[c.column]).map((c) => c.column);
  return {
    isCheck: true,
    unexpected,
    note:
      unexpected.length === 0
        ? '점검 행이 §3 수치를 들고 있지 않다'
        : '점검 행에 리허설 수치가 들어 있다 — 그 값은 판정에서 리허설 수치로 읽힌다',
  };
}

/* ─────────────────── 리허설 판정이 읽어야 하는 행 ─────────────────── */

/**
 * 점검 행을 **뺀** 행들. `ambiguous`·`unreadable` 은 **빼지 않는다** — 점검으로 추정해서
 * 빼면 실제 리허설 기록이 조용히 사라진다(판정은 `assessPurpose` 가 따로 말한다).
 */
export function rehearsalRows(rows: readonly LedgerRow[]): LedgerRow[] {
  return rows.filter((r) => purposeOfRow(r) !== 'check');
}

/** 점검 행을 뺀 뒤의 최신 행 — §1-2·§6-4 가 읽어야 하는 행이다 */
export function latestRehearsalRow(rows: readonly LedgerRow[], now?: Date): LedgerRow | null {
  return latestLedgerRow(rehearsalRows(rows), now ?? new Date());
}

export interface DisplacedReading {
  /** 표의 최신 행(목적 무관) */
  latest: LedgerRow | null;
  /** 점검 행을 뺀 최신 행 */
  rehearsal: LedgerRow | null;
  /** 리허설 행을 **가린** 점검 행의 일자 */
  displacedBy: string[];
  note: string;
}

/** 점검 행이 리허설 행을 가리고 있는지 — 가려지면 §1-2·§6-4 가 점검 행을 읽는다 */
export function displacedLatest(rows: readonly LedgerRow[], now?: Date): DisplacedReading {
  const at = now ?? new Date();
  const today = at.toISOString().slice(0, 10);
  const latest = latestLedgerRow(rows, at);
  const rehearsal = latestRehearsalRow(rows, at);
  const after = rehearsal ? rehearsal.date : '';
  const displacedBy = rows
    .filter((r) => r.date <= today && purposeOfRow(r) === 'check' && r.date >= after)
    .map((r) => r.date);
  return {
    latest,
    rehearsal,
    displacedBy,
    note:
      displacedBy.length === 0
        ? '표의 최신 행이 리허설·사건 행이다'
        : '점검 행이 리허설 행보다 뒤에 있다 — 목적을 보지 않는 판정은 점검 행을 읽는다',
  };
}

/** 점검 행의 일자가 **env 로 올라갔는가** — 승격은 이 대조로만 드러난다 */
export function promotedIntoEnv(args: { rows: readonly LedgerRow[]; env: Record<string, string | undefined> }): {
  promoted: boolean;
  /** env 가 가리키는 일자(판독 불가·미설정이면 null) */
  envDate: string | null;
  /** 그 일자에 있는 점검 행 */
  matchedRows: number[];
} {
  const envDate = parseRehearsalDate(args?.env?.RECOVERY_LAST_REHEARSAL);
  if (!envDate) return { promoted: false, envDate: null, matchedRows: [] };
  const matchedRows = (args.rows ?? []).filter((r) => r.date === envDate && purposeOfRow(r) === 'check').map((r) => r.row);
  return { promoted: matchedRows.length > 0, envDate, matchedRows };
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export const PURPOSE_VERDICTS = [
  'no_record',
  'ambiguous_purpose',
  'check_in_env',
  'check_latest',
  'unknown_purpose',
  'ok',
] as const;

export type PurposeVerdict = (typeof PURPOSE_VERDICTS)[number];

/** 무엇을 보고 판정했는가 — `env` 면 **표를 본 적 없다** */
export type PurposeBasis = 'env' | 'table+env';

const ACTION: Record<PurposeVerdict, string> = {
  no_record: `리허설·사건·점검 기록이 없어 목적을 물을 대상이 없다 — 미실시는 \`checks.recovery\` 가 말한다(${PURPOSE_RUNBOOK_REF}).`,
  ambiguous_purpose:
    `목적 칸에 두 갈래의 말이 겹쳐 있다(예: 「정기 점검」) — **어느 쪽인지 코드가 고르지 않는다.** ` +
    `연습이면 \`정기\`, §2 월 점검이면 \`${CHECK_VALUE}\` 하나만 적는다. 겹친 채로 두면 ` +
    '`normalizeKind` 가 부분 문자열 `정기` 만 보고 정기 리허설 행으로 세어 기한을 리셋한다(§6-8).',
  check_in_env:
    `§2 월 점검 기록이 리허설 env 로 올라갔다 — \`${PURPOSE_ENV}\`·\`RECOVERY_LAST_REHEARSAL\` 한 벌은 ` +
    '**마지막 정기 리허설**의 값이어야 한다. 점검은 §6 표에 `' +
    CHECK_VALUE +
    '` 행으로만 남기고 env 는 바꾸지 않는다(§2 6번). 올라간 채로 두면 리허설을 한 번도 하지 않아도 기한이 매월 리셋된다.',
  check_latest:
    '표의 최신 행이 **점검 행**이다 — 목적을 보지 않는 판정(§1-2 소요시간 대조·§6-4 두 기록 대조)은 ' +
    '그 행을 읽는다. §1-2 는 2026-10-23 부터 점검 행을 빼고 읽지만, 표를 손으로 볼 때는 ' +
    '`rehearsal` 쪽 행이 리허설 기록이라는 것을 함께 본다(§6-8 저장소 명령).',
  unknown_purpose:
    `목적을 읽을 수 없는 행이 있다 — \`정기\`/\`사건\`/\`${CHECK_VALUE}\` 중 하나를 적는다. ` +
    '비워 두면 §6-6 이 매월 `unknown_kind` 로 떨어지고, 그 degraded 를 지우려고 `정기` 를 적는 순간 ' +
    '점검이 연습이 된다(§6-8 `blank_pushed_to_regular`).',
  ok: `목적이 서로 어긋나지 않는다 — 다음 기록에서도 §2 월 점검은 \`${CHECK_VALUE}\`, 리허설은 \`정기\` 로 적는다.`,
};

const VERDICT_NOTE: Record<PurposeVerdict, string> = {
  no_record: '평상시 상태 — 판정 보류다',
  ambiguous_purpose: '겹친 말이고 코드가 고르지 않는다',
  check_in_env: '점검이 리허설 기록으로 승격됐다',
  check_latest: '점검 행이 리허설 행을 가리고 있다',
  unknown_purpose: '판정을 못 한 것이고 통과가 아니다',
  ok: '세 목적이 제 자리에 있다',
};

export const PURPOSE_LIMITS: readonly string[] = [
  '목적은 **사람이 적는 한 칸**이다 — 월 점검을 `정기` 로 적으면 이 판정도 같이 틀린다(코드는 행의 실제 성격을 알지 못한다)',
  '점검 행을 뺐다는 것이 「리허설을 했다」는 뜻이 아니다 — 미실시는 `checks.recovery` 가 `missing` 으로 말한다',
  '이 판정은 §6 표의 **어휘와 env 승격**만 본다. 월 점검을 실제로 수행했는지·밀렸는지는 `checks.periodicCheck`(§2-1)가 말한다',
  '`ambiguous`·`unreadable` 행은 **빼지 않는다** — 점검으로 추정해서 빼면 실제 리허설 기록이 조용히 사라진다',
  '점검 행의 빈 칸 규율(`CHECK_ROW_EMPTY_CELLS`)은 **권고**다 — 빈 칸은 「수행하지 않았다」와 「적기를 빠뜨렸다」를 구분하지 않는다',
  '런타임은 저장소 문서를 읽지 않는다 — 표의 이력은 §6-8 저장소 명령과 CI 가 본다(`basis` 가 `env` 인 응답은 표를 보지 않은 판정이다)',
  '§2 와 §6 을 **같은 표**에 두기로 한 결정 자체는 바꾸지 않았다 — 표를 나눌지는 사람 판단이다',
];

export interface PurposeAssessment {
  verdict: PurposeVerdict;
  basis: PurposeBasis;
  column: string;
  envKey: string;
  /** env 가 적고 있는 목적 */
  envPurpose: RowPurpose;
  /** 표의 최신 행의 목적(표를 안 봤으면 null) */
  latestPurpose: RowPurpose | null;
  /** 목적별 행 수 */
  counts: Record<string, number>;
  /** 겹친 말이 적힌 행 번호 */
  ambiguousRows: number[];
  /** 목적을 읽을 수 없는 행 번호 */
  unreadableRows: number[];
  /** 리허설 행을 가린 점검 행의 일자 */
  displacedBy: string[];
  /** 점검 행이 들고 있는 리허설 수치 칸 */
  checkRowCells: string[];
  action: string;
  caveats: readonly string[];
}

/**
 * 판정. env 는 **인자로** 받고, 표는 넘기지 않아도 된다(그러면 `basis: 'env'`).
 *
 * 판정 순서: 기록 없음 → **겹친 말** → env 승격 → 최신 행 가림 → 목적 판독 불가 → ok.
 * 「거짓 `ok` 를 막는 것」이 기록 자격보다 뒤로 밀리지 않게 한다(§6-2·§6-5·§6-6 과 같은 규율).
 */
export function assessPurpose(args: {
  env: Record<string, string | undefined>;
  rows?: readonly LedgerRow[];
  now?: Date;
}): PurposeAssessment {
  const env = args?.env ?? {};
  const rows = args?.rows;
  const now = args?.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const past = (rows ?? []).filter((r) => r.date <= today);
  const basis: PurposeBasis = rows === undefined ? 'env' : 'table+env';

  const envPurpose = purposeState(env[PURPOSE_ENV]);
  const envDate = parseRehearsalDate(env.RECOVERY_LAST_REHEARSAL);
  const displaced = displacedLatest(past, now);
  const promotion = promotedIntoEnv({ rows: past, env });

  const counts: Record<string, number> = { rehearsal: 0, incident: 0, check: 0, ambiguous: 0, unreadable: 0, absent: 0 };
  const ambiguousRows: number[] = [];
  const unreadableRows: number[] = [];
  const checkRowCells = new Set<string>();
  for (const r of past) {
    const p = purposeOfRow(r);
    counts[p] = (counts[p] ?? 0) + 1;
    if (p === 'ambiguous') ambiguousRows.push(r.row);
    if (p === 'unreadable' || p === 'absent') unreadableRows.push(r.row);
    if (p === 'check') for (const c of checkRowShape(r).unexpected) checkRowCells.add(c);
  }

  const shell = {
    basis,
    column: PURPOSE_COLUMN,
    envKey: PURPOSE_ENV,
    envPurpose,
    latestPurpose: rows === undefined ? null : displaced.latest ? purposeOfRow(displaced.latest) : null,
    counts,
    ambiguousRows,
    unreadableRows,
    displacedBy: displaced.displacedBy,
    checkRowCells: [...checkRowCells],
    caveats: PURPOSE_LIMITS,
  };
  const done = (verdict: PurposeVerdict): PurposeAssessment => ({ ...shell, verdict, action: ACTION[verdict] });

  if (!envDate && past.length === 0) return done('no_record');
  if (envPurpose === 'ambiguous' || ambiguousRows.length > 0) return done('ambiguous_purpose');
  if (envPurpose === 'check' || promotion.promoted) return done('check_in_env');
  if (displaced.displacedBy.length > 0) return done('check_latest');
  if (unreadableRows.length > 0) return done('unknown_purpose');
  return done('ok');
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 사람이 읽는 요약 — **수치를 지어내지 않는다** */
export function purposeText(a: PurposeAssessment): string {
  const head = `${a.verdict}(${VERDICT_NOTE[a.verdict]}) · basis=${a.basis} · env=${a.envPurpose}`;
  const body =
    a.basis === 'env'
      ? '표를 보지 않은 판정이다'
      : `표: 정기 ${a.counts.rehearsal} · 사건 ${a.counts.incident} · 점검 ${a.counts.check}` +
        (a.displacedBy.length > 0 ? ` · 가림 ${a.displacedBy.join(',')}` : '');
  return `${head}\n${body}\n${a.action}`;
}

/** 구조화 로그 한 줄 — **판정·개수만**(담당·비고·소요시간 없음) */
export function purposeLogLine(a: PurposeAssessment): string {
  return [
    'recovery_ledger_purpose',
    `verdict=${a.verdict}`,
    `basis=${a.basis}`,
    `env=${a.envPurpose}`,
    `check_rows=${a.counts.check ?? 0}`,
    `ambiguous=${a.ambiguousRows.length}`,
    `displaced=${a.displacedBy.length}`,
  ].join(' ');
}

/** 공개 응답용 — 판정·목적·개수·칸 이름만 담는다 */
export function publicPurpose(a: PurposeAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    basis: a.basis,
    column: a.column,
    envKey: a.envKey,
    envPurpose: a.envPurpose,
    latestPurpose: a.latestPurpose,
    counts: { ...a.counts },
    ambiguousRows: [...a.ambiguousRows],
    unreadableRows: [...a.unreadableRows],
    displacedBy: [...a.displacedBy],
    checkRowCells: [...a.checkRowCells],
    values: PURPOSE_VALUES,
    action: a.action,
    caveats: [...a.caveats],
    runbook: PURPOSE_RUNBOOK_REF,
  };
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

/**
 * §6 표의 행이 **무엇의 기록인가**(§6-8).
 *
 * **required: false** — 복구 판정이 서비스를 내리면 복구 자신이 막힌다.
 * 평상시(`no_record`·`ok`)는 degraded 를 늘리지 않는다 — 이 체크가 ok:false 를 내는 것은
 * **기록이 잘못 섞였을 때**뿐이고, 그것은 의도된 국면이 아니라 고쳐야 할 상태다
 * (§6-3 관측 정본에 `degradedWhen: []` 로 등록한다).
 *
 * 런타임은 저장소 문서를 읽지 않으므로 표는 넘기지 않는다 — `basis: 'env'` 로 그 사실을 적는다.
 */
export function ledgerPurposeCheck(args?: { env?: Record<string, string | undefined>; now?: Date }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const a = assessPurpose({ env: args?.env ?? {}, now: args?.now });
  return { ok: a.verdict === 'ok' || a.verdict === 'no_record', required: false, detail: publicPurpose(a) };
}

/** 명령·로그용 요약 */
export function ledgerPurposeStatus(
  env: Record<string, string | undefined> = {},
  rows?: readonly LedgerRow[],
  now?: Date,
): { verdict: PurposeVerdict; basis: PurposeBasis; text: string; line: string } {
  const a = assessPurpose({ env, rows, now });
  return { verdict: a.verdict, basis: a.basis, text: purposeText(a), line: purposeLogLine(a) };
}

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

/** §6-6 정본과 **양방향**으로 맞는지 — 자격이 어긋나면 두 절이 다른 말을 한다 */
export function auditRoleAlignment(
  kindRoles: readonly KindRole[],
  roles: readonly PurposeRole[] = PURPOSE_ROLES,
): string[] {
  const problems: string[] = [];
  const mineFor = (p: PurposeRole['purpose']) => roles.find((r) => r.purpose === p) ?? null;
  for (const pair of [
    ['rehearsal', 'regular'],
    ['incident', 'incident'],
  ] as const) {
    const mine = mineFor(pair[0]);
    const theirs = kindRoles.find((r) => r.kind === pair[1]);
    if (!mine || !theirs) {
      problems.push(`${pair[0]} 자격을 §6-6 정본과 대조할 수 없다 — 한쪽에서 사라졌다`);
      continue;
    }
    if (mine.resetsInterval !== theirs.resetsInterval) problems.push(`${pair[0]} 의 기한 리셋 자격이 §6-6 과 다르다`);
    if (mine.rtoEvidence !== theirs.rtoEvidence) problems.push(`${pair[0]} 의 RTO 근거 등급이 §6-6 과 다르다`);
    if (mine.resolvesUnpassed !== theirs.resolvesUnpassed) problems.push(`${pair[0]} 의 미통과 해소 자격이 §6-6 과 다르다`);
  }
  const check = mineFor('check');
  if (!check) problems.push('점검 자격이 정본에 없다');
  else if (check.resetsInterval || check.rtoEvidence !== 'none' || check.resolvesUnpassed || check.countsAsCoverage) {
    problems.push('점검 행이 리허설 자격을 갖고 있다 — §2 는 §3 절차를 하나도 수행하지 않는다');
  }
  for (const r of roles) {
    if (!r.writtenBy.trim() || !r.exercises.trim()) problems.push(`${r.purpose} 의 출처·수행 설명이 비었다`);
  }
  return problems;
}

/** 표 파서가 `유형` **원문**을 버리지 않는지 — 버리면 「정기 점검」을 되살릴 수 없다 */
export function auditKindRawKept(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/kindRaw/.test(s)) problems.push('표 파서가 kindRaw 를 담지 않는다 — normalizeKind 로 접힌 값만 남아 「정기 점검」을 구별할 수 없다');
  if (!/kindRaw:\s*cellAt\(/.test(s)) problems.push('kindRaw 가 표 칸 원문에서 오지 않는다');
  return problems;
}

/** §1-2 가 **점검 행을 빼고** 최신 행을 읽는지 — 되돌아가면 점검 소요시간이 RTO `met` 이 된다 */
export function auditAttainmentPurposeGate(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/latestRehearsalRow\(/.test(s)) {
    problems.push('§1-2 가 latestRehearsalRow() 를 쓰지 않는다 — 표의 최신 행이 점검 행이면 그 소요시간이 RTO 실측이 된다');
  }
  if (/latestLedgerRow\(parseLedgerTable/.test(s)) {
    problems.push('§1-2 가 목적을 보지 않는 latestLedgerRow(parseLedgerTable(...)) 로 되돌아갔다');
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴과 **관측 뒤로 밀리는** 경우도 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/ledgerPurpose['"]/.test(s)) problems.push('ledgerPurpose 를 import 하지 않는다');
  if (!/ledgerPurposeCheck\(/.test(s)) problems.push('ledgerPurposeCheck() 를 호출하지 않는다');
  if (!/checks\.ledgerPurpose\s*=\s*ledgerPurposeCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.ledgerPurpose 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  const mine = s.indexOf('checks.ledgerPurpose =');
  const observation = s.indexOf('checks.rehearsalObservation =');
  if (mine >= 0 && observation >= 0 && mine > observation) {
    problems.push('checks.ledgerPurpose 가 rehearsalObservation 뒤에 실린다 — 그 관측에서 조용히 빠진다');
  }
  return problems;
}

/** §2 6번이 **어느 값으로** 적으라고 지시하는지와, env 를 바꾸지 말라고 적는지 */
export function auditSectionTwoRow(md: unknown): string[] {
  const s = String(md ?? '');
  const at = s.search(/^##\s*2\.\s/m);
  if (at < 0) return ['RUNBOOK 에 2절이 없다'];
  const end = s.search(/^###\s*2-1\./m);
  const section = s.slice(at, end > at ? end : undefined);
  const problems: string[] = [];
  if (!/6절/.test(section)) return ['§2 가 6절 표 기록을 지시하지 않는다 — 이 절의 전제가 바뀌었으면 §6-8 을 함께 본다'];
  if (!section.includes(`\`${CHECK_VALUE}\``)) {
    problems.push(`§2 가 점검 행의 유형 값(\`${CHECK_VALUE}\`)을 지시하지 않는다 — 적을 값이 없으면 \`정기\` 로 적힌다`);
  }
  if (!section.includes(PURPOSE_ENV)) {
    problems.push(`§2 가 ${PURPOSE_ENV} 를 **바꾸지 말라**고 적지 않는다 — 승격되면 기한이 매월 리셋된다`);
  }
  return problems;
}

/** §6 표 머리글이 **세 값**을 적고 있는지(어휘가 둘로 돌아가면 점검을 적을 값이 사라진다) */
export function auditTableVocabulary(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  const header = /\|\s*일자\s*\|\s*([^|]*)\|/.exec(s);
  if (!header) return ['§6 표 머리글을 찾지 못했다'];
  for (const v of PURPOSE_VALUES) {
    if (!header[1].includes(v)) problems.push(`§6 표 \`${PURPOSE_COLUMN}\` 열 머리글에 값 ${v} 가 없다`);
  }
  return problems;
}

/** §6-8 절이 **판정·어긋남·확인 수단**을 적고 있는지 */
export function auditRunbookPurpose(md: unknown): string[] {
  const s = String(md ?? '');
  const at = s.search(/^###\s*6-8\./m);
  if (at < 0) return ['RUNBOOK 에 6-8 절이 없다'];
  const end = s.search(/^###\s*리허설 체크리스트/m);
  const section = s.slice(at, end > at ? end : undefined);
  const problems: string[] = [];
  for (const v of PURPOSE_VERDICTS) {
    if (!section.includes(v)) problems.push(`6-8 에 판정 ${v} 가 없다`);
  }
  for (const d of PURPOSE_DRIFTS) {
    if (!section.includes(d.key)) problems.push(`6-8 에 어긋남 방향 ${d.key} 가 없다`);
  }
  for (const m of PURPOSE_MISREADS) {
    if (!section.includes(m.key)) problems.push(`6-8 에 거짓이 되는 판정 ${m.key} 가 없다`);
  }
  if (!/ledgerPurposeStatus\(|assessPurpose\(/.test(section)) problems.push('6-8 에 저장소 확인 명령이 없다');
  const checklist = end > 0 ? s.slice(end) : '';
  if (!/checks\.ledgerPurpose/.test(checklist)) {
    problems.push('리허설 체크리스트가 checks.ledgerPurpose 를 인용하지 않는다 — 리허설에서 한 번도 읽히지 않는다');
  }
  return problems;
}
