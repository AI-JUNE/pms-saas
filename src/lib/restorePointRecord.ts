/**
 * restorePointRecord.ts — 「**무엇으로** 복구했는가」의 영구 기록 (RUNBOOK §6 · §6-7). 2026-10-22
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6-4 가 리허설 기록의 **집**을 정본으로 적으면서 두 칸을 `judgedBy: null` 로 남겨 두었다 —
 * `복구 대상 시점` 과 `비고`. 그 둘은 하필 **유실 구간의 두 끝**이 사는 자리다.
 *
 *  (1) **구간의 두 끝은 지워지는 쪽에만 있었다.** 시작(`RECOVERY_RESTORE_POINT`)과
 *      끝(`RECOVERY_WRITE_FREEZE_AT`)은 둘 다 `lib/envPresence.ts` 의 **임시 키**이고,
 *      §3 7·8단계는 그 표지를 **지우라고 지시한다**(체크리스트에도 지우는 항목이 있다).
 *      지운 뒤 남는 영구 기록은 §6 표의 `복구 대상 시점`(시작)과 `비고`의 한 문장
 *      (§3-10 `recordRemark()` 가 만들어 준다)뿐인데, **그 둘을 읽는 판정이 없었다.**
 *      그래서 사건이 끝나는 순간 §1 의 **RPO 약속을 실측으로 견줄 근거가 영구히 사라진다** —
 *      RTO 쪽은 2026-10-20 에 §1-2 가 표의 `소요시간` 을 읽는 판정이 됐는데, RPO 쪽은
 *      런타임 env(`measuredFromEnv`)밖에 없어서 표지를 지우면 영구히 `unjudged` 다.
 *      아무것도 나빠지지 않는다 — 응답은 200 이고 표에는 행이 그대로 남아 있다.
 *
 *  (2) **그 칸은 파싱조차 되지 않았다.** `lib/recovery.ts` 의 표 파서는 이 칸을 「자유 문자열,
 *      파싱하지 않음」으로 받아 적고, `auditRehearsalRows` 는 일자·결과·담당만 본다. 그래서
 *      · 시각으로 **읽을 수 없는 값**(「어제 밤」·`2026-10-09 22:00 KST`)도,
 *      · **타임존 없는 값**(§3-6 이 `CAVEAT_ZONELESS` 로 맨 앞에 붙여 둔 함정 — UTC 로 읽혀
 *        한국시간 기준 9시간 이른 시점이 된다. 날짜만 적은 칸도 같다),
 *      · **그 행의 일자보다 뒤인 값**(복구는 과거로 되감는 것이다)도 전부 통과했다.
 *      셋 다 「기록이 있다」로 보이고, 나중에 그 값을 근거로 쓰는 쪽은 틀린 시점을 읽는다.
 *
 *  (3) **같은 사실의 두 기록을 대조한 적이 없다.** `복구 대상 시점` 과 비고의 구간 시작은
 *      같은 순간을 적는 두 칸이고, 되돌릴 수 없는 **고지**에 나간 수치는 비고 쪽이다. 두 값이
 *      어긋나면 사후 조사·분쟁에서 **어느 쪽이 사실인지 아무도 모르는** 기록이 남는데, 어느
 *      쪽도 오류를 내지 않는다. 고지 **발신 시각**도 그렇다 — `RECOVERY_LOSS_NOTICE_AT` 역시
 *      임시 키라서, 비고에 옮겨 적지 않으면 「고지했는가」를 물을 대상 자체가 사라진다
 *      (§3-10 이 `CAVEAT_CLEARED_IS_INDISTINGUISHABLE` 로 적어 둔 바로 그 상태다).
 *
 *  (4) **ε 의 전례가 닿지 않는다.** §3-6 은 ε 기본값을 금지하고 근거(원인 작업 직전 기록)로
 *      고르라고 하지만, 리허설에는 원인 작업이 없어 ε 가 매번 눈대중이다. 축적된 유일한
 *      전례는 이 칸인데 읽는 쪽이 없었다. 다만 전례가 말해 주는 것은 **되감은 거리**뿐이고
 *      ε(분)이 아니다 — 그 한계를 `RECORD_LIMITS` 에 적는다.
 *
 * 그래서 이 모듈은
 *   · 구간의 두 끝이 **어느 집에 사는지**를 정본으로 두고(`WINDOW_HOMES` — 지워지는 쪽 ·
 *     영구 쪽 · 만들어 주는 곳 · 읽는 판정 · 표지를 지우면 생기는 일),
 *   · 표 칸을 **엄격하게 판독하고**(`parseRecordedInstant` — 타임존 없음을 숨기지 않는다),
 *   · 비고에서 구간을 **되읽고**(`parseRemarkWindow` — §3-10 문구의 왕복. 적힌 분과 두 끝의
 *     차이가 다르면 **어느 쪽도 채택하지 않는다**),
 *   · 둘을 대조해 판정하고(`assessRecord` → `unreadable_target`·`zoneless_target`·
 *     `target_after_date`·`window_disagrees`·`window_unrecorded`·`notice_unrecorded`·
 *     **`ephemeral_only`**),
 *   · 사건 행의 구간을 **§1 RPO 의 실측으로** 넘기고(`recordedLossMinutes` — §1-2 가 읽는다),
 *   · 그 상태를 `/api/health` 로 드러낸다(`restorePointRecordCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL·신규 env 0**.
 *   env 는 **인자로** 받고, 저장소 파일은 테스트·명령이 읽어서 넘긴다.
 * - **값을 지어내지 않는다.** 판독 못 한 시각을 「기록됨」으로 올리지 않고, 비고의 빈 자리를
 *   표 값으로 메우지 않으며, 표를 자동으로 채우지 않는다(§6 머리말의 약속은 그대로다).
 * - **연습 구간은 실측이 아니다**(§6-6 과 같은 규율). 사건 행만 RPO 실측 자격이 있다.
 * - **중복 보고 금지.** 표지가 **지금** 읽히는지는 `incidentClosure`·`lossNotice` 가 말한다 —
 *   이 체크가 말하는 것은 그 값이 **영구 기록으로 옮겨졌는가**다.
 */
import { parseInstant } from './incidentEvidence.ts';
import { hasTimezone } from './recoveryWindow.ts';
import { parseRehearsalDate } from './recovery.ts';
import { kindState, type KindState } from './rehearsalKind.ts';
import { TABLE_COLUMNS, type LedgerField, type LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const RECORD_RUNBOOK_REF = 'RUNBOOK §6 · §6-7';

/** 영구 기록이 사는 두 칸(§6 표) */
export const TARGET_COLUMN = '복구 대상 시점';
export const REMARK_COLUMN = '비고';

const MS_MIN = 60_000;

/* ─────────────────── 구간의 두 끝이 사는 집(정본) ─────────────────── */

export type WindowEnd = 'start' | 'end';

export interface WindowHome {
  end: WindowEnd;
  /** 그 끝이 무엇인가 */
  what: string;
  /** 복구 중에만 있는 **임시** 키 — §3 7·8단계가 지우라고 지시한다 */
  transientEnv: string;
  /** 지운 뒤에도 남는 자리(§6 표의 칸) */
  durableCell: string;
  /** 그 값을 만들어 주는 곳 */
  madeBy: string;
  /** 이 칸을 **읽어 판정하는** 곳 */
  judgedBy: string;
  /** 영구 기록으로 옮기지 않고 표지를 지우면 생기는 일 */
  cleared: string;
}

export const WINDOW_HOMES: readonly WindowHome[] = [
  {
    end: 'start',
    what: '실제로 적용한 복구 시점(T-ε) — 유실 구간의 시작이고 §3-6 ε 선택의 유일한 전례다',
    transientEnv: 'RECOVERY_RESTORE_POINT',
    durableCell: TARGET_COLUMN,
    madeBy: 'lib/recoveryWindow.ts planRestorePoint (§3-6 산출) · 실제 적용 시점은 Neon 콘솔',
    judgedBy: 'lib/restorePointRecord.ts assessRecord (§6-7)',
    cleared:
      '어느 시점으로 되감았는지가 사라진다 — 유실 구간을 사후에 다시 세울 수 없고, 다음 ε 선택이 전례 없이 눈대중으로 돌아간다',
  },
  {
    end: 'end',
    what: '쓰기 차단이 **실효된** 시각 — 유실 구간의 끝이고 사후에는 복원할 수 없다',
    transientEnv: 'RECOVERY_WRITE_FREEZE_AT',
    durableCell: REMARK_COLUMN,
    madeBy: 'lib/incidentClosure.ts assessLossWindow (§3-7) · 문구는 lib/lossNotice.ts recordRemark',
    judgedBy: 'lib/restorePointRecord.ts parseRemarkWindow (§6-7 — 구간 부분만 읽는다)',
    cleared:
      '구간의 끝이 사라져 §1 RPO 를 실측으로 견줄 수 없게 되고(영구히 `unjudged`), 고지한 수치가 무엇이었는지도 남지 않는다',
  },
];

/** 그 끝을 모르는 키는 null — 지어내지 않는다 */
export function homeFor(end: unknown): WindowHome | null {
  return WINDOW_HOMES.find((h) => h.end === end) ?? null;
}

/* ─────────────────── 거짓이 되는 판정(정본) ─────────────────── */

export interface RecordMisread {
  /** 어느 판정이 */
  judgement: string;
  /** 무슨 말을 하게 되는가 */
  says: string;
  /** 왜 그것이 거짓인가 */
  why: string;
}

export const RECORD_MISREADS: readonly RecordMisread[] = [
  {
    judgement: 'checks.recoveryObjectives.detail.attainment.rpo',
    says: '유실 구간을 약속과 견주지 않았다(`unjudged`)',
    why: '런타임 실측은 임시 키 두 개만 읽는데 §3 7·8단계가 그것을 지운다 — 사건이 끝난 뒤에는 표에 행이 남아 있어도 영구히 판정 보류다',
  },
  {
    judgement: 'lib/recovery.ts parseRehearsalTable',
    says: '복구 대상 시점이 기록돼 있다',
    why: '그 칸을 「자유 문자열, 파싱하지 않음」으로 받아 적는다 — 판독 불가·타임존 없음·행 일자보다 뒤인 값이 모두 「기록됨」으로 보인다',
  },
  {
    judgement: 'lib/recovery.ts auditRehearsalRows',
    says: '표 행에 무결성 문제가 없다',
    why: '일자·결과·담당만 본다 — 구간의 두 끝은 어느 점검에도 걸리지 않는다',
  },
  {
    judgement: 'checks.lossNotice.detail.canClearMarkers',
    says: '표지를 지워도 된다',
    why: '고지 **기록**과 구간 확정만 본다 — 그 값이 §6 표로 **옮겨졌는지**는 보지 않으므로, 지우면 되찾을 수 없는 상태에서 `true` 가 난다',
  },
  {
    judgement: 'checks.rehearsalLedger.detail.verdict',
    says: '두 기록이 같은 말을 한다(`ok`)',
    why: '대조하는 칸은 일자·유형·결과·범위·미통과뿐이다 — `복구 대상 시점`·`비고` 는 §6-4 가 `judgedBy: null` 로 적어 둔 칸이었다',
  },
];

/* ─────────────────────────── 판독 ─────────────────────────── */

export interface RecordedInstant {
  /** 칸 원문(공백 제거). 비어 있으면 '' */
  raw: string;
  /** 칸에 **무언가 들어 있었는가** — 미기재와 판독 실패를 구분한다 */
  recorded: boolean;
  /** 판독한 시각(ISO). 못 읽으면 null — 추측하지 않는다 */
  at: string | null;
  /** 타임존이 붙어 있지 않다 — UTC 로 읽혀 한국시간 기준 9시간 이른 시점이 된다 */
  zoneless: boolean;
}

/**
 * 표 칸의 시각을 **엄격하게** 읽는다. 날짜만 적힌 칸도 `zoneless` 다 — 00:00Z 로 읽히므로
 * 한국시간 09:00 이 되고, 그 차이가 그대로 유실 구간에 들어간다.
 */
export function parseRecordedInstant(raw: unknown): RecordedInstant {
  const text = String(raw ?? '').trim();
  if (!text) return { raw: '', recorded: false, at: null, zoneless: false };
  const d = parseInstant(text);
  return {
    raw: text,
    recorded: true,
    at: d ? d.toISOString() : null,
    zoneless: d ? !hasTimezone(text) : false,
  };
}

export interface RemarkWindow {
  /** 비고가 **구간을 말하고 있는가**(수치가 읽혔는가와는 다르다) */
  found: boolean;
  /** 「유실 구간 미확정(...)」으로 적혀 있다 — 구간이 아니라 **미확정 사실**의 기록이다 */
  undetermined: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** 적힌 분. 두 끝의 차이와 어긋나면 **채택하지 않는다**(null) */
  minutes: number | null;
  /** 고지 **발신** 시각. `[확인 필요]` 는 명시된 공백이므로 null 이고 어긋남이 아니다 */
  noticedAt: string | null;
  /** 해석하지 못한 조각 — **수치를 담지 않는다**(공개 응답에 함께 나간다) */
  invalid: string[];
}

const WINDOW_RE = /유실\s*구간\s*([^\s~]+)\s*~\s*([^\s(]+)\s*\(\s*(\d{1,7})\s*분/;
const UNDETERMINED_RE = /유실\s*구간\s*미확정/;
const NOTICE_RE = /고지\s*([^\s·—]+)/;
const PLACEHOLDER_RE = /^\[확인/;

/**
 * §6 표 **비고**에서 구간을 되읽는다 — §3-10 `recordRemark()`·§3-7 `incidentRecordDraft()` 가
 * 만들어 주는 문구의 **왕복**이다(테스트가 그 함수의 실제 출력으로 매번 고정한다).
 * 자유 메모에서 숫자를 주워 오지 않는다 — 「유실 구간 … ~ …(N분)」 꼴만 인정한다.
 */
export function parseRemarkWindow(note: unknown): RemarkWindow {
  const text = String(note ?? '').trim();
  const out: RemarkWindow = {
    found: false,
    undetermined: false,
    startsAt: null,
    endsAt: null,
    minutes: null,
    noticedAt: null,
    invalid: [],
  };
  if (!text) return out;

  const notice = NOTICE_RE.exec(text);
  if (notice) {
    const token = notice[1];
    if (!PLACEHOLDER_RE.test(token)) {
      const at = parseInstant(token);
      if (at) out.noticedAt = at.toISOString();
      else out.invalid.push('고지 시각 판독 불가');
    }
  }

  if (UNDETERMINED_RE.test(text)) {
    out.found = true;
    out.undetermined = true;
    return out;
  }

  const m = WINDOW_RE.exec(text);
  if (!m) return out;
  out.found = true;

  const start = parseInstant(m[1]);
  const end = parseInstant(m[2]);
  if (!start) out.invalid.push('구간 시작 판독 불가');
  if (!end) out.invalid.push('구간 끝 판독 불가');
  if (!start || !end) return out;

  const stated = Number(m[3]);
  const computed = Math.round((end.getTime() - start.getTime()) / MS_MIN);
  if (computed < 0) {
    out.invalid.push('구간 끝이 시작보다 앞이다');
    return out;
  }
  if (stated !== computed) {
    // 손으로 고친 흔적이다 — 어느 쪽도 채택하지 않는다(둘 중 하나를 고르면 그것이 추측이다).
    out.invalid.push('적힌 분과 두 끝의 차이가 다르다');
    return out;
  }
  out.startsAt = start.toISOString();
  out.endsAt = end.toISOString();
  out.minutes = computed;
  return out;
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export const RECORD_VERDICTS = [
  'ok',
  'no_record',
  'unreadable_target',
  'zoneless_target',
  'target_after_date',
  'window_disagrees',
  'window_unrecorded',
  'notice_unrecorded',
  'ephemeral_only',
] as const;
export type RecordVerdict = (typeof RECORD_VERDICTS)[number];

/** 판정이 무엇을 보고 했는가. `env` 면 **표를 보지 않았다**(런타임은 저장소 파일을 읽지 않는다) */
export type RecordBasis = 'table' | 'env' | 'none';

export const ACTION_RECORD_OK =
  '구간의 두 끝과 고지 시각이 §6 표에 남아 있다 — 표지(임시 키)를 지워도 §1 RPO 대조와 사후 조사의 근거가 남는다';

export const ACTION_RECORD_NONE =
  `평상시 상태다(기록 없음) — 복구·리허설을 하면 ${TARGET_COLUMN} 과 ${REMARK_COLUMN} 을 **표지를 지우기 전에** 적는다`;

export const ACTION_RECORD_EPHEMERAL =
  '구간의 값이 **지워지는 쪽에만** 있다 — §3 8단계 4번(표지 삭제) 전에 §6 표의 ' +
  `${TARGET_COLUMN}·${REMARK_COLUMN} 에 옮겨 적는다(§3-10 recordRemark() 가 비고 문구를 만들어 준다). ` +
  '지운 뒤에는 되찾을 수 없다';

export const ACTION_RECORD_UNREADABLE =
  `${TARGET_COLUMN} 칸을 시각으로 읽을 수 없다 — **타임존을 붙인 ISO**(예: 2026-10-09T12:55:00+09:00)로 고쳐 적는다. ` +
  '판독 불가는 「기록 없음」도 「기록됨」도 아니다';

export const ACTION_RECORD_ZONELESS =
  `${TARGET_COLUMN} 에 타임존이 없다 — UTC 로 읽혀 한국시간 기준 **9시간 이른 시점**이 된다(§3-6 CAVEAT_ZONELESS). ` +
  '오프셋을 붙여 다시 적는다';

export const ACTION_RECORD_AFTER_DATE =
  `${TARGET_COLUMN} 이 그 행의 일자보다 뒤다 — 복구는 과거로 되감는 것이다. 타임존 누락·오타가 제1 용의자다`;

export const ACTION_RECORD_DISAGREES =
  `${TARGET_COLUMN} 과 ${REMARK_COLUMN} 의 구간 시작이 다르다 — 같은 순간을 적는 두 칸이고, 고지에 나간 수치는 비고 쪽이다. ` +
  '어느 쪽이 실제 적용 시점인지 확인해 둘을 맞춘다(둘 중 하나를 코드가 고르지 않는다)';

export const ACTION_RECORD_WINDOW_UNRECORDED =
  `사건 행인데 ${REMARK_COLUMN} 에 유실 구간이 없다 — §3-7 로 산출해 §3-10 recordRemark() 문구를 적는다. ` +
  '표지를 이미 지웠다면 구간을 추정하지 말고 그 사실을 기록에 적는다';

export const ACTION_RECORD_NOTICE_UNRECORDED =
  `구간은 적혔는데 **고지 발신 시각**이 ${REMARK_COLUMN} 에 없다 — \`RECOVERY_LOSS_NOTICE_AT\` 도 임시 키다. ` +
  '옮겨 적지 않으면 「고지했는가」를 물을 대상이 사라진다(§3-10). 리허설이라면 발신하지 않았다는 사실을 적는다';

const ACTION: Record<RecordVerdict, string> = {
  ok: ACTION_RECORD_OK,
  no_record: ACTION_RECORD_NONE,
  unreadable_target: ACTION_RECORD_UNREADABLE,
  zoneless_target: ACTION_RECORD_ZONELESS,
  target_after_date: ACTION_RECORD_AFTER_DATE,
  window_disagrees: ACTION_RECORD_DISAGREES,
  window_unrecorded: ACTION_RECORD_WINDOW_UNRECORDED,
  notice_unrecorded: ACTION_RECORD_NOTICE_UNRECORDED,
  ephemeral_only: ACTION_RECORD_EPHEMERAL,
};

export const CAVEAT_RECORD_IS_A_CLAIM =
  '표의 값은 「그 시점으로 복구했다고 **적었다**」는 뜻이다 — 실제 적용 시점의 정본은 Neon 콘솔이고, 이 판정은 기록끼리만 본다';

export const CAVEAT_BASIS_ENV =
  '런타임 판정은 §6 표를 읽지 않는다 — 영구 기록이 실제로 적혔는지는 §6-7 의 저장소 명령과 CI 가 본다';

export const RECORD_LIMITS: readonly string[] = [
  '`ok` 는 「두 칸이 서로 맞는다」까지다 — **둘 다 틀렸을 수 있다**(원문 대조 대상은 Neon 콘솔과 §3-5 보존본이다)',
  '구간은 **시간 범위**일 뿐이고 유실 건수·대상은 말하지 않는다(§3-7 과 같은 한계다)',
  '전례는 **되감은 거리**를 말할 뿐이고 ε(분)을 산출해 주지 않는다 — 일자 칸은 날짜뿐이고, 비고의 구간은 사건에서만 생긴다',
  '`target_after_date` 는 **날짜 경계**로만 본다 — 같은 날 안의 앞뒤 모순은 이 판정이 말하지 않는다',
  '비고의 자유 메모는 읽지 않는다 — 「유실 구간 … ~ …(N분)」 꼴과 「고지 <시각>」만 본다',
  '`ephemeral_only` 는 「표에 없다」가 아니라 「지워지는 쪽에 값이 있고 표를 보지 않았다」는 뜻이다(`basis` 를 함께 본다)',
  '연습(정기) 행의 구간은 RPO 실측으로 쓰지 않는다 — 고지 대상도 유실도 없는 값이다(§6-6)',
];

export interface RecordMarkers {
  /** 시작 표지가 읽히는가 */
  start: boolean;
  /** 끝 표지가 읽히는가 */
  end: boolean;
  /** 값이 있는데 읽히지 않는 표지의 **키 이름**(값은 담지 않는다) */
  unreadable: string[];
}

export interface RecordInput {
  /** §6 표의 최신 행(없으면 null). 런타임은 넘기지 않는다 */
  row?: LedgerRow | null;
  /** 복구용 임시 키 스냅샷 */
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface RecordAssessment {
  verdict: RecordVerdict;
  basis: RecordBasis;
  /** 표 `복구 대상 시점` 판독 */
  target: RecordedInstant;
  /** 표 `비고` 에서 되읽은 구간 */
  remark: RemarkWindow;
  markers: RecordMarkers;
  /** 그 행이 연습인가 사건인가(§6-6) */
  kind: KindState;
  /** 표지를 지워도 구간을 되찾을 수 있는가 */
  durable: boolean;
  /** 영구 기록에서 산출한 RPO 실측(분). 자격이 없으면 null */
  lossMinutes: number | null;
  /** 실측으로 쓰지 않은 이유(쓸 때는 null) */
  withheld: string | null;
  action: string;
  caveats: string[];
}

function markersOf(env?: Record<string, string | undefined>): RecordMarkers {
  const out: RecordMarkers = { start: false, end: false, unreadable: [] };
  if (!env) return out;
  for (const home of WINDOW_HOMES) {
    const parsed = parseRecordedInstant(env[home.transientEnv]);
    if (!parsed.recorded) continue;
    if (parsed.at) {
      if (home.end === 'start') out.start = true;
      else out.end = true;
    } else {
      out.unreadable.push(home.transientEnv);
    }
  }
  return out;
}

export const WITHHELD_NO_ROW = '표 행이 없다 — 런타임은 §6 표를 읽지 않는다(§6-7 저장소 명령이 본다)';
export const WITHHELD_REHEARSAL = '연습(정기) 행이다 — 고지 대상 유실이 없으므로 구간을 약속의 실측으로 쓰지 않는다(§6-6)';
export const WITHHELD_KIND_UNREAD = '유형을 읽을 수 없어 이 구간이 연습값인지 사건 실측인지 모른다 — 실측 자격을 지어내지 않는다';
export const WITHHELD_NO_WINDOW = `${REMARK_COLUMN} 에 유실 구간이 적히지 않았다 — 산출할 근거가 영구 기록에 없다`;

/**
 * §6 표의 사건 행에서 **RPO 실측**을 꺼낸다 — §1-2 가 읽는 자리다(`LEDGER_FIELDS.note` 를
 * 읽는 판정). 연습·유형 미판독·구간 미기재는 수치를 만들지 않고 **이유를 돌려준다**.
 */
export function recordedLossMinutes(row?: LedgerRow | null): { minutes: number | null; withheld: string | null } {
  if (!row) return { minutes: null, withheld: WITHHELD_NO_ROW };
  const kind = kindState(row.kind);
  if (kind === 'regular') return { minutes: null, withheld: WITHHELD_REHEARSAL };
  if (kind !== 'incident') return { minutes: null, withheld: WITHHELD_KIND_UNREAD };
  const remark = parseRemarkWindow(row.note);
  if (remark.minutes === null) return { minutes: null, withheld: WITHHELD_NO_WINDOW };
  return { minutes: remark.minutes, withheld: null };
}

/**
 * 영구 기록 판정.
 *
 * 판정 순서: **판독 불가가 먼저**다(못 읽는 값으로 대조하면 그 대조가 거짓이 된다) →
 * 타임존 → 행 일자와의 모순 → 두 기록의 어긋남 → 미기재 → 표지만 남은 상태.
 * 행을 넘기지 않으면 표를 **보지 않았다는 사실**을 `basis: 'env'` 로 적는다.
 */
export function assessRecord(input?: RecordInput): RecordAssessment {
  const row = input?.row ?? null;
  const markers = markersOf(input?.env);
  const target = parseRecordedInstant(row?.target);
  const remark = parseRemarkWindow(row?.note);
  const kind = row ? kindState(row.kind) : 'absent';
  const measured = recordedLossMinutes(row);
  const markersPresent = markers.start || markers.end || markers.unreadable.length > 0;

  let verdict: RecordVerdict;
  if (!row) {
    verdict = markersPresent ? 'ephemeral_only' : 'no_record';
  } else if (target.recorded && !target.at) {
    verdict = 'unreadable_target';
  } else if (target.at && target.zoneless) {
    verdict = 'zoneless_target';
  } else if (target.at && target.at.slice(0, 10) > row.date) {
    verdict = 'target_after_date';
  } else if (target.at && remark.startsAt && target.at !== remark.startsAt) {
    verdict = 'window_disagrees';
  } else if (!target.recorded && markersPresent) {
    verdict = 'ephemeral_only';
  } else if (kind === 'incident' && remark.minutes === null) {
    verdict = 'window_unrecorded';
  } else if (kind === 'incident' && !remark.noticedAt) {
    verdict = 'notice_unrecorded';
  } else if (!target.recorded && !remark.found) {
    verdict = 'no_record';
  } else {
    verdict = 'ok';
  }

  const durable =
    target.at !== null && (kind === 'incident' ? remark.startsAt !== null && remark.endsAt !== null : true);

  const caveats = [CAVEAT_RECORD_IS_A_CLAIM];
  if (!row) caveats.unshift(CAVEAT_BASIS_ENV);

  return {
    verdict,
    basis: row ? 'table' : markersPresent ? 'env' : 'none',
    target,
    remark,
    markers,
    kind,
    durable,
    lossMinutes: measured.minutes,
    withheld: measured.withheld,
    action: ACTION[verdict],
    caveats,
  };
}

/** env 스냅샷만으로 판정한다(라우트·명령이 같은 경로를 쓴다) */
export function recordFromEnv(env: Record<string, string | undefined>, now?: Date): RecordAssessment {
  return assessRecord({ env, now });
}

/* ─────────────────────── ε 전례(저장소 명령·CI) ─────────────────────── */

export interface RestorePrecedent {
  date: string;
  kind: KindState;
  /** 판독한 복구 시점(ISO). 못 읽으면 null */
  at: string | null;
  /** 타임존 없이 적혀 있었다 */
  zoneless: boolean;
  /** 그 행의 일자로부터 **며칠 전** 시점으로 되감았는가. 판독 불가면 null */
  daysBefore: number | null;
}

/**
 * 과거 리허설·사건이 **어느 시점으로** 되감아 봤는지의 목록 — §3-6 ε 선택의 유일한 전례다.
 * **분 단위 ε 를 만들지 않는다**(일자 칸은 날짜뿐이다. `RECORD_LIMITS` 에 적는다).
 */
export function restorePrecedents(rows: readonly LedgerRow[]): RestorePrecedent[] {
  const out: RestorePrecedent[] = [];
  for (const row of rows) {
    const parsed = parseRecordedInstant(row.target);
    if (!parsed.recorded) continue;
    const day = parsed.at ? parsed.at.slice(0, 10) : null;
    const base = parseRehearsalDate(row.date);
    const daysBefore =
      day && base
        ? Math.round((Date.parse(`${base}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
        : null;
    out.push({ date: row.date, kind: kindState(row.kind), at: parsed.at, zoneless: parsed.zoneless, daysBefore });
  }
  return out;
}

/* ─────────────────────────── 어긋남·출력 ─────────────────────────── */

export interface RecordDrift {
  key: string;
  what: string;
  why: string;
}

export const RECORD_DRIFTS: readonly RecordDrift[] = [
  {
    key: 'markers_cleared_without_record',
    what: '표지를 지우면서 §6 표에 옮겨 적지 않는다',
    why: '구간의 두 끝이 함께 사라지고 §1 RPO 대조는 영구히 `unjudged` 가 된다 — 응답은 200 이고 표에는 행이 남아 있어 아무도 알아채지 못한다',
  },
  {
    key: 'remark_format_changed',
    what: '§3-10 비고 문구의 모양이 바뀐다',
    why: '파서가 구간을 되읽지 못해 `window_unrecorded` 로 내려앉는다 — 기록은 멀쩡히 적혀 있는데 판정만 사라진다',
  },
  {
    key: 'target_column_moved',
    what: '§6 표의 열 순서가 바뀌거나 칸 이름이 달라진다',
    why: '위치 기반 파서(`lib/recovery.ts`)가 다른 칸을 복구 시점으로 읽는다 — 값 모양이 비슷해 CI 밖에서는 드러나지 않는다',
  },
];

/** 사람이 읽는 요약(명령·로그용). **수치를 함께 적되 공개 응답에는 담지 않는다** */
export function recordText(a: RecordAssessment): string {
  const lines = [`[영구 기록] ${a.verdict} (basis=${a.basis})`];
  lines.push(`${TARGET_COLUMN}: ${a.target.at ?? (a.target.recorded ? '판독 불가' : '미기재')}`);
  lines.push(
    a.remark.minutes === null
      ? `${REMARK_COLUMN} 구간: ${a.remark.undetermined ? '미확정으로 적힘' : '없음'}`
      : `${REMARK_COLUMN} 구간: ${a.remark.startsAt} ~ ${a.remark.endsAt}(${a.remark.minutes}분)`,
  );
  lines.push(`RPO 실측: ${a.lossMinutes === null ? `없음 — ${a.withheld ?? ''}` : `${a.lossMinutes}분`}`);
  lines.push(a.action);
  return lines.join('\n');
}

/** 구조화 로그 한 줄. **판정·칸 상태만** — 시각·분·담당은 담지 않는다 */
export function recordLogLine(a: RecordAssessment): string {
  return [
    'recovery_restore_point_record',
    `verdict=${a.verdict}`,
    `basis=${a.basis}`,
    `kind=${a.kind}`,
    `target=${a.target.at ? 'read' : a.target.recorded ? 'unreadable' : 'absent'}`,
    `window=${a.remark.minutes === null ? 'absent' : 'read'}`,
    `durable=${a.durable}`,
  ].join(' ');
}

/** 공개 응답용 — **값을 담지 않는다**(시각·분·원문 전부 제외) */
export function publicRecord(a: RecordAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    basis: a.basis,
    kind: a.kind,
    durable: a.durable,
    targetRecorded: a.target.recorded,
    targetReadable: a.target.at !== null,
    targetZoneless: a.target.zoneless,
    windowRecorded: a.remark.minutes !== null,
    noticeRecorded: a.remark.noticedAt !== null,
    unreadableMarkers: [...a.markers.unreadable],
    invalid: [...a.remark.invalid],
    withheld: a.withheld,
    action: a.action,
    caveats: [...a.caveats],
    runbook: RECORD_RUNBOOK_REF,
    limits: RECORD_LIMITS,
  };
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

/**
 * 구간의 두 끝이 **영구 기록으로 옮겨졌는가**(§6-7).
 *
 * **required: false** — 복구 판정이 서비스를 내리면 복구 자신이 막힌다.
 * 평상시(표지 없음)는 `no_record` 로 **ok** 다 — degraded 를 늘리지 않는다.
 * 표지가 있는 동안(`ephemeral_only`)만 degraded 로 드러낸다: 그때가 **아직 옮겨 적을 수 있는**
 * 유일한 구간이고, 지운 뒤에는 되찾을 수 없다(§6-3 관측 정본에 `incident`·`rehearsal` 로 등록).
 */
export function restorePointRecordCheck(args?: { env?: Record<string, string | undefined>; now?: Date }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const a = recordFromEnv(args?.env ?? {}, args?.now);
  return { ok: a.verdict === 'ok' || a.verdict === 'no_record', required: false, detail: publicRecord(a) };
}

/** 명령·로그용 요약 */
export function restorePointRecordStatus(
  env: Record<string, string | undefined> = {},
  now?: Date,
): { verdict: RecordVerdict; basis: RecordBasis; durable: boolean; text: string; line: string } {
  const a = recordFromEnv(env, now);
  return { verdict: a.verdict, basis: a.basis, durable: a.durable, text: recordText(a), line: recordLogLine(a) };
}

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

/** §6-4 기록 정본이 두 칸을 **읽는 판정으로** 선언하는지 — `null` 로 되돌아가면 잡는다 */
export function auditLedgerHomes(fields: readonly LedgerField[]): string[] {
  const problems: string[] = [];
  for (const [key, column] of [
    ['target', TARGET_COLUMN],
    ['note', REMARK_COLUMN],
  ] as const) {
    const f = fields.find((x) => x.key === key);
    if (!f) {
      problems.push(`기록 정본에 ${key} 칸이 없다 — ${column} 이 §6-4 에서 사라졌다`);
      continue;
    }
    if (f.column !== column) problems.push(`${key} 칸의 열 이름이 ${f.column} 이다 — ${column} 이어야 한다`);
    if (!f.judgedBy) {
      problems.push(
        `${key}(${column}) 가 judgedBy: null 로 되돌아갔다 — 적히지만 아무도 읽지 않는 칸이고, ` +
          '표지를 지우는 순간 구간의 그 끝이 사라진다',
      );
      continue;
    }
    if (!/restorePointRecord/.test(f.judgedBy)) {
      problems.push(`${key}(${column}) 의 읽는 판정이 §6-7 을 가리키지 않는다: ${f.judgedBy}`);
    }
  }
  return problems;
}

/**
 * §6 표 한 줄 **초안**(§3-7 `incidentRecordDraft`)의 칸 수가 표의 열 수와 같은지.
 * 모자라면 담당자가 붙여 넣은 행에서 **뒤쪽 신설 열이 조용히 빈 칸이 된다**(범위·미통과 단위).
 */
export function auditDraftRow(row: unknown, columns: readonly string[] = TABLE_COLUMNS): string[] {
  const text = String(row ?? '').trim();
  if (!text.startsWith('|')) return ['§6 표 초안 한 줄을 읽을 수 없다(표 행 모양이 아니다)'];
  const cells = text.replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (cells.length !== columns.length) {
    return [
      `§6 표 초안의 칸이 ${cells.length}개인데 표는 ${columns.length}열이다 — ` +
        '붙여 넣으면 뒤쪽 열(나중에 신설된 칸)이 조용히 빈 칸이 된다',
    ];
  }
  return [];
}

/** 구간의 두 끝이 **임시 키**라는 전제가 유지되는지(영구 키가 되면 이 절의 전제가 바뀐다) */
export function auditWindowHomes(transientKeys: readonly string[]): string[] {
  const problems: string[] = [];
  const known = new Set(transientKeys);
  for (const home of WINDOW_HOMES) {
    if (!known.has(home.transientEnv)) {
      problems.push(
        `${home.transientEnv} 가 임시 키 목록에 없다 — 이 절은 「복구 뒤 지워진다」를 전제로 판정한다`,
      );
    }
    if (!home.durableCell || !TABLE_COLUMNS.includes(home.durableCell)) {
      problems.push(`${home.transientEnv} 의 영구 자리(${home.durableCell})가 §6 표의 열이 아니다`);
    }
    if (!home.judgedBy.trim() || !home.cleared.trim()) problems.push(`${home.transientEnv} 의 판정·소실 설명이 비었다`);
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴과 **관측 뒤로 밀리는** 경우도 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/restorePointRecord['"]/.test(s)) problems.push('restorePointRecord 를 import 하지 않는다');
  if (!/restorePointRecordCheck\(/.test(s)) problems.push('restorePointRecordCheck() 를 호출하지 않는다');
  if (!/checks\.restorePointRecord\s*=\s*restorePointRecordCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.restorePointRecord 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  const mine = s.indexOf('checks.restorePointRecord =');
  const observation = s.indexOf('checks.rehearsalObservation =');
  if (mine >= 0 && observation >= 0 && mine > observation) {
    problems.push('checks.restorePointRecord 가 rehearsalObservation 뒤에 실린다 — 그 관측에서 조용히 빠진다');
  }
  return problems;
}

/** §1-2 가 RPO 실측을 **영구 기록에서** 읽는지 — 되돌아가면 사건 RPO 가 영구히 `unjudged` 다 */
export function auditObjectivesWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/recordedLossMinutes\(/.test(s)) {
    problems.push('§1-2 가 recordedLossMinutes() 를 쓰지 않는다 — 표의 비고에 적힌 구간을 RPO 와 견주지 않는다');
  }
  if (!/rpo:\s*compareToObjective\('rpo'/.test(s)) {
    problems.push('§1-2 의 표 대조에 rpo 가 없다 — RTO 만 영구 기록에서 읽는다');
  }
  return problems;
}

/** §6-7 절이 **판정·어긋남·확인 수단**을 적고 있는지 */
export function auditRunbookRecord(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  const at = s.search(/^###\s*6-7\./m);
  if (at < 0) return ['RUNBOOK 에 6-7 절이 없다'];
  const end = s.search(/^###\s*리허설 체크리스트/m);
  const section = s.slice(at, end > at ? end : undefined);
  for (const v of RECORD_VERDICTS) {
    if (!section.includes(v)) problems.push(`6-7 에 판정 ${v} 가 없다`);
  }
  for (const d of RECORD_DRIFTS) {
    if (!section.includes(d.key)) problems.push(`6-7 에 어긋남 방향 ${d.key} 가 없다`);
  }
  for (const home of WINDOW_HOMES) {
    if (!section.includes(home.transientEnv)) problems.push(`6-7 이 임시 키 ${home.transientEnv} 를 가리키지 않는다`);
  }
  if (!/restorePointRecordStatus\(|assessRecord\(/.test(section)) problems.push('6-7 에 저장소 확인 명령이 없다');
  const checklist = end > 0 ? s.slice(end) : '';
  if (!/checks\.restorePointRecord/.test(checklist)) {
    problems.push('리허설 체크리스트가 checks.restorePointRecord 를 인용하지 않는다 — 리허설에서 한 번도 읽히지 않는다');
  }
  return problems;
}
