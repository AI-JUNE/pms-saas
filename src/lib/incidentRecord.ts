/**
 * incidentRecord.ts — 사건 행이 **있는지**를 묻는 쪽이 없다(RUNBOOK §6-10). 2026-11-02
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 8단계는 네 가지를 **순서대로** 하라고 지시하고, 그 3번이 「6절 표에 사건·조치·소요시간
 * 기록」이다. 그 뒤 4번이 표지 여섯을 지우는데, 4번의 마지막 ⚠️ 는 「**지우기 전에 2·3번이
 * 끝났는지 본다** — `checks.lossNotice.detail.canClearMarkers` 가 `true` 이고 `blockers` 가
 * 비어 있을 때만 지운다」고 적어 두었다.
 *
 * 그런데 그 게이트가 **보는 것은 2번뿐**이다. `lossNotice.assessNotice` 의 `blockers` 는
 * 고지 기록(`RECOVERY_LOSS_NOTICE_AT`)·판독 실패·구간 미확정 네 가지이고 **3번은 들어 있지
 * 않다** — 런타임이 `RUNBOOK.md` 를 읽지 않기 때문이다(그 설계는 옳다. §6-9·§2-4 가 같은
 * 이유로 표 쪽을 `no_table` 로 남겨 두었다). 그래서 **표에 행을 한 줄도 적지 않아도**
 * `canClearMarkers: true` · `blockers: []` 가 나오고, 4번은 선행 조건을 지킨 모습으로 끝난다.
 *
 * 넷으로 거짓이 된다.
 *
 *  (1) **행이 없는 것이 「적을 것이 없다」로 보고된다.** §3-23 은 비고 칸을 판정하는데
 *      `assessRemarkSlots` 의 첫 줄이 `if (!row) return base('not_applicable', …)` 이고 그
 *      문구가 「없음 — §2 월 점검 행이거나 **읽을 행이 없다**」다. 8단계 3번을 통째로 거른
 *      상태와 적을 것이 없는 점검 행이 **같은 판정**으로 나온다.
 *  (2) **사건을 거친 배포와 한 번도 복구하지 않은 배포가 구별되지 않는다.** 표 쪽 판정
 *      (§6-4)은 기록이 없으면 `no_record`(= 「미실시」)를 내고, 머리말의 `(미실시)`
 *      placeholder 행은 파서가 기록으로 세지 않는다. 사건은 env 한 벌을 바꾸지 않으므로
 *      (§6-6 — 사건은 절차의 **사용**이고 검증이 아니다) **env 에도 흔적이 없다.**
 *  (3) **§1 약속의 실측이 영구히 비어 있다.** §1-2 `rehearsalAttainment` 는 표의 최신
 *      리허설 행을 읽고 그 소요시간을 `lower_bound` 로 쓴다 — 사건 행만이 `measurement`
 *      자격을 갖는데(§6-8 `PURPOSE_ROLES`), 그 행이 없으면 **실제로 복구를 해 본 배포가
 *      연습값으로만 약속을 대조한다.**
 *  (4) **그 사실을 말할 수 있는 창이 4번에서 닫힌다.** 사건이 있었다고 말해 주는 유일한
 *      런타임 근거가 표지 여섯이고(§3-14 `readTimeline`), 4번이 그것을 지우라고 지시한다
 *      (그 지시는 옳다). 지운 뒤에는 `verdict` 가 `no_incident`(평상시)로 돌아가므로
 *      **기록하지 않은 사건과 일어나지 않은 사건이 글자 하나 다르지 않다.**
 *
 * 그래서 이 모듈은
 *   · 4번의 게이트가 **실제로 무엇을 보는지**를 정본으로 두고(`STEP8_GATE_SIGHT` — 보는 쪽이
 *     없는 항목은 `seenBy: null` 로 적는다. 한계를 숨기지 않는다),
 *   · 표지와 표를 대조해 **이번 사건의 행이 있는가**를 판정하고(`assessIncidentRecord`),
 *   · 그 행에서 **비어 있는 필수 칸**을 세고(`INCIDENT_ROW_CELLS` — 정본은 §6-4
 *     `LEDGER_FIELDS` 이고 여기서는 사건 행의 필수 여부만 더한다),
 *   · 런타임 게이트에 **3번을 더한 판정**을 명령 시점에 만들어 주고(`clearGate` —
 *     런타임 판정을 **복제하지 않고 그대로 받아** 합친다),
 *   · 행이 없을 때 거짓이 되는 판정 5건(`RECORD_MISREADS`)과 사각지대를 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근(표·표지는 명시 인자로만). **신규 조회·쓰기·
 *   DDL 0 · 신규 런타임 체크 0 · 신규 사건 표지 0 · 신규 env 0** — 이미 적게 되어 있던 행을 읽는다.
 * - **런타임 체크를 만들지 않는다.** 판정의 한쪽이 저장소 문서라 `/api/health` 에 실으면 그
 *   응답 자신이 거짓 보증이 된다(§6-9 와 같은 자리다). 판정은 저장소 명령과 CI 가 한다.
 * - **판독을 복제하지 않는다.** 표는 §6-4 `parseLedgerTable`, 목적은 §6-8 `purposeOfRow`,
 *   표지는 §3-14 `assessTimeline`, 날짜 셈은 `recovery.addDays` 를 그대로 쓴다.
 * - **임의 허용 오차 금지.** `일자` 칸은 **날짜뿐**이고 앵커는 타임존 붙은 시각이라 하루
 *   경계의 귀속은 **말할 수 없다** — 그 행을 통과로도 미기록으로도 세지 않고 `boundary` 로
 *   따로 적는다(±1일을 임의로 봐주면 지난 사건의 행이 이번 사건의 기록이 된다).
 * - **거짓 차단을 만들지 않는다.** 이 판정은 7단계 해제도 4번의 실행도 막지 않고, 평상시
 *   (표지 없음)에는 표를 묻지 않는다 — 평상시마다 경보가 뜨면 아무도 이 판정을 보지 않는다.
 */
import { ANCHOR_ENV, assessTimeline, type TimelineAssessment } from './incidentTimeline.ts';
import { purposeOfRow } from './ledgerPurpose.ts';
import { addDays } from './recovery.ts';
import { LEDGER_FIELDS, type LedgerField, type LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const RECORD_RUNBOOK_REF = 'RUNBOOK §6-10 · §3 8단계 3번 · §6';

/** 이 행을 적으라고 지시하는 단계 */
export const RECORD_STEP = '§3 8단계 3번';

/** 사건 행의 `유형` 칸 값(§6-8 정본) */
export const RECORD_PURPOSE_VALUE = '사건';

/* ─────────────── 4번의 게이트가 실제로 보는 것(정본) ─────────────── */

export interface GateSight {
  key: string;
  /** 8단계의 몇 번인가 */
  item: string;
  /** 끝났다고 말해야 하는 것 */
  what: string;
  /** 런타임이 그것을 보는 자리. **null 이면 보는 쪽이 없다** */
  seenBy: string | null;
  /** 보이지 않으면 조용히 생기는 일 */
  quiet: string;
}

/**
 * 8단계 4번의 마지막 ⚠️ 는 「2·3번이 끝났는지 본다」고 지시한다. 그 넷 중 **둘은 보는 쪽이
 * 없다** — 런타임이 저장소 문서를 읽지 않기 때문이고, 그래서 이 절이 필요하다.
 */
export const STEP8_GATE_SIGHT: readonly GateSight[] = [
  {
    key: 'notice_sent',
    item: '8단계 2번',
    what: '유실 고지를 발신하고 그 시각을 적었는가',
    seenBy: '`checks.lossNotice.detail.state` = `notified`(§3-10)',
    quiet: '보는 쪽이 있다 — 미기록이면 `blockers` 가 삭제를 막는다',
  },
  {
    key: 'window_fixed',
    item: '8단계 2번',
    what: '유실 구간이 확정됐는가(두 끝)',
    seenBy: '`checks.lossNotice.detail.window.verdict` = `ok`(§3-7)',
    quiet: '보는 쪽이 있다 — 미확정이면 `blockers` 가 삭제를 막는다',
  },
  {
    key: 'ledger_row',
    item: '8단계 3번',
    what: '§6 표에 **사건 행**을 적었는가',
    seenBy: null,
    quiet:
      '런타임은 표를 읽지 않으므로 행이 한 줄도 없어도 `canClearMarkers: true` 가 나온다. ' +
      '표 쪽 판정(§6-4)은 기록이 없으면 `no_record`(= 「미실시」)라서 **사건을 거친 배포와 ' +
      '한 번도 복구하지 않은 배포가 같은 말을 한다**',
  },
  {
    key: 'row_cells',
    item: '8단계 3번',
    what: '그 행의 필수 칸(유형·복구 대상 시점·검증 결과·담당·비고)을 적었는가',
    seenBy: null,
    quiet:
      '§3-23 비고 판정은 **행이 주어졌을 때만** 돌아간다 — 행이 없으면 `not_applicable`(「읽을 행이 없다」)이고, ' +
      '거른 상태가 적을 것 없는 점검 행과 같은 판정으로 나온다',
  },
];

/** 보는 쪽이 **없는** 항목 — 이 절이 메우는 자리다 */
export function unseenGateItems(sight: readonly GateSight[] = STEP8_GATE_SIGHT): GateSight[] {
  return sight.filter((g) => g.seenBy === null);
}

/* ─────────────── 행이 없을 때 거짓이 되는 판정(정본) ─────────────── */

export interface RecordMisread {
  key: string;
  /** 잘못 말하는 판정 */
  reader: string;
  /** 그 판정이 내놓는 말 */
  says: string;
  /** 왜 그렇게 되는가 */
  why: string;
}

export const RECORD_MISREADS: readonly RecordMisread[] = [
  {
    key: 'nothing_to_write',
    reader: '§3-23 `assessRemarkSlots`',
    says: '`not_applicable` — 「없음 — §2 월 점검 행이거나 **읽을 행이 없다**」',
    why: '첫 줄이 `if (!row) return base(\'not_applicable\', …)` 다. 8단계 3번을 통째로 거른 상태를 「적을 것이 없다」로 돌려준다 — 가장 무거운 누락이 가장 가벼운 판정으로 나온다',
  },
  {
    key: 'gate_opens_without_row',
    reader: '§3-10 `assessNotice.canClearMarkers`',
    says: '`true` · `blockers: []`',
    why: '4번은 「2·3번이 끝났는지」를 이 값으로 보라고 지시하는데 `blockers` 는 **2번만** 본다(런타임은 표를 읽지 않는다). 고지만 적어 두면 표에 한 줄도 없이 표지 여섯이 지워진다',
  },
  {
    key: 'incident_looks_like_never',
    reader: '§6-4 `reconcileLedger`',
    says: '`no_record` — 「미실시」',
    why: '사건은 리허설 env 한 벌을 바꾸지 않고(§6-6 — 기한을 리셋하지 않는다) 표의 `(미실시)` placeholder 행은 파서가 기록으로 세지 않는다. 그래서 **실제 복구를 거친 배포가 「한 번도 하지 않았다」와 같은 모습**이다',
  },
  {
    key: 'promise_measured_by_practice',
    reader: '§1-2 `rehearsalAttainment.basis`',
    says: '`lower_bound` — 리허설 소요시간으로 약속을 대조한다',
    why: '`measurement` 자격은 사건 행에만 있다(§6-8 `PURPOSE_ROLES`). 사건 행이 없으면 실제 복구의 수치가 **영구히 표에 없고**, 1단계 중단 결정부터 7단계 해제까지의 실측이 연습값으로 대체된다',
  },
  {
    key: 'silence_after_clear',
    reader: '§3-14 `assessTimeline`',
    says: '`absent` — 평상시',
    why: '사건이 있었다고 말해 주는 유일한 런타임 근거가 표지 여섯이고 4번이 그것을 지우라고 지시한다(옳은 지시다). 지운 뒤에는 **기록하지 않은 사건과 일어나지 않은 사건이 글자 하나 다르지 않다**',
  },
];

/* ─────────────── 사건 행의 칸(§6-4 정본에 필수 여부만 더한다) ─────────────── */

/** §6-4 `LEDGER_FIELDS` 의 키 — 정본은 그쪽이라 **이름을 다시 적지 않는다** */
export type IncidentCellKey = LedgerField['key'];

export interface IncidentCell {
  /** §6-4 `LEDGER_FIELDS` 의 키. **정본은 그쪽이다** */
  field: IncidentCellKey;
  /** 사건 행에서 비어 있으면 미기록인가 */
  required: boolean;
  /** 비어 있으면 무엇이 거짓이 되는가 */
  why: string;
  /** 비어 있는 것이 **올바른 기록**일 수 있는 경우(없으면 null) */
  blankOk: string | null;
}

/**
 * 8단계 3번이 사건 행에 적게 하는 칸 전건. `범위`·`미통과 단위` 는 **리허설 칸**이라 사건
 * 행에서는 필수가 아니다(§6-8 `PURPOSE_ROLES`: `countsAsCoverage: false` ·
 * `resolvesUnpassed: false`) — 빼지 않고 이유와 함께 적어 둔다(목록을 반쪽으로 두지 않는다).
 */
export const INCIDENT_ROW_CELLS: readonly IncidentCell[] = [
  {
    field: 'date',
    required: true,
    why: '일자가 없으면 파서가 그 줄을 기록으로 세지 않는다 — 적어도 행이 없는 것과 같다',
    blankOk: null,
  },
  {
    field: 'kind',
    required: true,
    why: '`사건` 이 아니면 §6-6 이 기한을 리셋하고 §1-2 가 그 소요시간을 연습값으로 읽는다',
    blankOk: null,
  },
  {
    field: 'target',
    required: true,
    why: '유실 구간의 **시작**이 남는 유일한 영구 자리다(§6-7) — 표지는 4번이 지운다',
    blankOk: null,
  },
  {
    field: 'duration',
    required: false,
    why: '§1-2 가 읽는 **유일한 RTO 실측**이다(1단계 중단 결정 ~ 7단계 해제)',
    blankOk:
      '두 끝 중 하나가 없으면 §3-22 가 `[확인 필요]` 로 남기라고 지시한다 — 하한을 적으면 §1-2 가 `met` 을 내 **지키지 못한 약속이 지켜진 것으로 굳는다**',
  },
  {
    field: 'result',
    required: true,
    why: '복구가 끝까지 갔는지가 비면 §6-5 자격 게이트가 수치를 넘기지 않는다',
    blankOk: null,
  },
  {
    field: 'owner',
    required: true,
    why: '사후 조사에서 되물을 상대가 사라진다(§6 `auditRehearsalRows` 가 공란을 CI 에서 잡는 칸이다)',
    blankOk: null,
  },
  {
    field: 'note',
    required: true,
    why: '열두 칸이 들어가는 자리다(§3-23) — 구간·고지 시각·해제 시각·중단 결정 시각·세 결정이 여기 말고 남을 자리가 없다',
    blankOk: null,
  },
  {
    field: 'scope',
    required: false,
    why: '§6-2 가 **수행한 절차 단위**로 읽는다',
    blankOk: '사건은 범위 귀속의 대상이 아니다(§6-8 `countsAsCoverage: false`) — 비어 있는 것이 정상이다',
  },
  {
    field: 'unpassed',
    required: false,
    why: '§6-5 가 재수행 대상 산출에 쓴다',
    blankOk: '사건에는 통과·미통과가 없다(§6-8 `resolvesUnpassed: false`) — 비어 있는 것이 정상이다',
  },
];

export function cellFor(field: unknown, cells: readonly IncidentCell[] = INCIDENT_ROW_CELLS): IncidentCell | null {
  const k = String(field ?? '');
  return cells.find((c) => c.field === k) ?? null;
}

/** 이 모듈이 필수로 보는 칸의 열 이름(§6-4 정본에서 가져온다 — 열 이름을 복제하지 않는다) */
export function requiredColumns(
  cells: readonly IncidentCell[] = INCIDENT_ROW_CELLS,
  fields: readonly LedgerField[] = LEDGER_FIELDS,
): string[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return cells.filter((c) => c.required).map((c) => byKey.get(c.field)?.column ?? c.field);
}

/* ─────────────────────────── 보장하지 못하는 것 ─────────────────────────── */

export const CAVEAT_ROW_IS_A_CLAIM =
  '행이 있다는 것은 「적었다」는 뜻이다 — 적힌 수치가 실제 수행과 맞는지, 조치 내용이 사실인지는 보지 않는다';

export const CAVEAT_CLEARED_IS_SILENT =
  '표지를 지운 뒤에는 **기록하지 않은 사건과 일어나지 않은 사건이 구별되지 않는다** — 그래서 이 판정은 ' +
  '표지가 남아 있는 동안(= 4번 전)에만 쓸모가 있고, 그 뒤에는 `no_incident` 가 평상시와 같은 값이다';

export const CAVEAT_DAY_BOUNDARY =
  '`일자` 칸은 **날짜뿐**이고 앵커는 타임존 붙은 시각이라 하루 경계의 귀속은 말할 수 없다 — ' +
  '앵커 날짜의 전날 행은 `boundary` 로만 적고 통과로도 미기록으로도 세지 않는다';

export const RECORD_LIMITS: readonly string[] = [
  CAVEAT_ROW_IS_A_CLAIM,
  CAVEAT_CLEARED_IS_SILENT,
  CAVEAT_DAY_BOUNDARY,
  '저장소 문서만 본다 — 런타임 응답에는 표가 없고(`/api/health` 에 이 판정을 싣지 않는 이유다) 다른 배포에서 적은 행도 알 수 없다',
  '사건이 **여럿**이면 가를 수 없다 — 앵커는 한 벌이라 복구 중 재손상으로 차단을 두 번 걸면 첫 사건의 행이 앵커보다 앞선다(§3-14 와 같은 사각지대)',
  '행이 **빠짐없이** 적혔는지는 필수 칸의 공란까지만 본다 — 비고 열두 칸의 정합은 §3-23 이, 구간·고지 시각은 §6-7 이 판정한다(두 번 세지 않는다)',
  '**게이트가 아니다** — 7단계 해제도 4번의 실행도 막지 않는다. 막는 것은 런타임 `canClearMarkers` 뿐이고 그쪽은 3번을 보지 못한다',
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const RECORD_VERDICTS = [
  'no_incident',
  'unreadable_anchor',
  'unanchored',
  'no_table',
  'ambiguous',
  'recorded',
  'boundary_only',
  'predating_only',
  'unrecorded',
] as const;
export type RecordVerdict = (typeof RECORD_VERDICTS)[number];

export const ACTION_REC_NO_INCIDENT =
  '없음 — 사건 표지가 하나도 들어 있지 않다(평상시). 지난 사건의 행은 §6 표의 영구 기록이고 이 판정의 대상이 아니다';
export const ACTION_REC_UNREADABLE_ANCHOR =
  `\`${ANCHOR_ENV}\` 를 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 적는다. **판정 보류이고 통과가 아니다**`;
export const ACTION_REC_UNANCHORED =
  `\`${ANCHOR_ENV}\` 가 없어 어느 행이 이번 사건의 것인지 말할 수 없다 — 차단 중이면 **지금** 적는다(§3 2단계). **판정 보류이고 통과가 아니다**`;
export const ACTION_REC_NO_TABLE =
  '§6 표를 찾지 못했다 — **「행이 없다」가 아니라 판정 불가다**(열 이름·제목이 바뀌었는지 본다. 같은 표를 읽는 §6-4·§6-7 판정도 함께 멈춘다)';
export const ACTION_REC_AMBIGUOUS =
  '앵커 이후의 사건 행이 둘 이상이다 — 어느 것이 이번 사건인지 말할 수 없다. 두 사건을 한 행으로 적지 않았는지, 지난 사건의 일자가 미래로 적히지 않았는지 본다';
export const ACTION_REC_RECORDED =
  '이번 사건의 행이 있다. 4번으로 넘어가기 전에 §3-23 으로 비고 칸을, §6-7 로 구간·고지 시각을 함께 판정한다';
export const ACTION_REC_BOUNDARY_ONLY =
  '사건 행이 앵커 **날짜 전날**에 있다 — 날짜뿐인 칸으로는 이번 사건의 것인지 말할 수 없다. 비고에 **타임존 붙인 시각**을 적어 귀속을 남긴다(§6-7 과 같은 규율)';
export const ACTION_REC_PREDATING_ONLY =
  '사건 행이 있지만 전부 앵커보다 **앞**이다 = 이번 사건의 것일 수 없다 — 지난 사건의 기록을 이번 것으로 세지 않는다. 8단계 3번을 **지금** 수행한다(§3-7 `incidentRecordDraft()` 가 초안 한 줄을 만든다)';
export const ACTION_REC_UNRECORDED =
  '§6 표에 사건 행이 **하나도 없다** — 8단계 3번을 수행하기 전에 4번으로 가지 않는다. 표지를 지운 뒤에는 수치를 산출할 수 없고, 기록하지 않은 사건은 평상시와 구별되지 않는다(§3-7 `incidentRecordDraft()` 로 초안을 만든다)';

const ACTION: Record<RecordVerdict, string> = {
  no_incident: ACTION_REC_NO_INCIDENT,
  unreadable_anchor: ACTION_REC_UNREADABLE_ANCHOR,
  unanchored: ACTION_REC_UNANCHORED,
  no_table: ACTION_REC_NO_TABLE,
  ambiguous: ACTION_REC_AMBIGUOUS,
  recorded: ACTION_REC_RECORDED,
  boundary_only: ACTION_REC_BOUNDARY_ONLY,
  predating_only: ACTION_REC_PREDATING_ONLY,
  unrecorded: ACTION_REC_UNRECORDED,
};

export interface RecordInput {
  /** §6 표의 행(§6-4 `parseLedgerTable(...).rows`) */
  rows?: readonly LedgerRow[];
  /** 표를 **찾았는가**. `false` 는 「행이 없다」가 아니라 판정 보류다 */
  tableFound?: boolean;
  /** 사건 표지 env(§3-14 가 읽는 여섯 키) */
  markers?: Record<string, string | undefined>;
  cells?: readonly IncidentCell[];
}
// ※ `now` 를 받지 않는다 — 미래 일자 판정은 §6 `auditRehearsalRows` 가 이미 한다. 같은 값을 두
//    곳에서 판정하면 두 판정이 갈라지고, 갈라진 쪽은 아무 응답도 바꾸지 않아 영구히 남는다.

export interface RecordAssessment {
  verdict: RecordVerdict;
  anchorKey: string;
  /** 앵커 시각(ISO). 미설정·판독 실패면 null */
  anchorAt: string | null;
  /** 앵커의 **날짜**(UTC, YYYY-MM-DD). 하루 경계 한계는 `CAVEAT_DAY_BOUNDARY` */
  anchorDay: string | null;
  /** 값이 들어 있는 표지 키 */
  markersPresent: string[];
  /** 표지가 남아 있어 **아직 적을 수 있는가** */
  captureOpen: boolean;
  /** 표에서 읽은 사건 행 수(일자 무관) */
  incidentRows: number;
  /** 앵커 날짜 이후의 사건 행 번호 */
  attributed: number[];
  /** 앵커 **전날**의 사건 행 번호 — 귀속을 말할 수 없다 */
  boundary: number[];
  /** 앵커보다 앞선 사건 행 번호 */
  predating: number[];
  /** 이번 사건의 행 번호(하나로 정해졌을 때만) */
  matchedRow: number | null;
  matchedDate: string | null;
  /** 그 행에서 비어 있는 **필수** 칸의 열 이름 */
  emptyCells: string[];
  /** 비어 있지만 그것이 올바른 기록일 수 있는 칸의 열 이름 */
  blankByRule: string[];
  action: string;
  caveats: string[];
  ref: string;
}

function cellValue(row: LedgerRow, field: string): string {
  switch (field) {
    case 'date':
      return row.date ?? '';
    case 'kind':
      return String(row.kindRaw ?? '').trim();
    case 'target':
      return String(row.target ?? '').trim();
    case 'duration':
      return row.durationMin === null || row.durationMin === undefined ? '' : String(row.durationMin);
    case 'result':
      // `unknown` 은 판독 실패이거나 공란이다 — 어느 쪽도 「적었다」가 아니다.
      return row.result && row.result !== 'unknown' ? row.result : '';
    case 'owner':
      return String(row.owner ?? '').trim();
    case 'note':
      return String(row.note ?? '').trim();
    case 'scope':
      return String(row.scope ?? '').trim();
    case 'unpassed':
      return String(row.unpassed ?? '').trim();
    default:
      return '';
  }
}

/** 한 행의 빈 칸을 센다. 열 이름은 §6-4 정본에서 가져온다 */
export function emptyCellsOf(
  row: LedgerRow,
  cells: readonly IncidentCell[] = INCIDENT_ROW_CELLS,
  fields: readonly LedgerField[] = LEDGER_FIELDS,
): { missing: string[]; blankByRule: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const name = (c: IncidentCell) => byKey.get(c.field)?.column ?? c.field;
  const missing: string[] = [];
  const blankByRule: string[] = [];
  for (const c of cells) {
    if (cellValue(row, c.field)) continue;
    if (c.required) missing.push(name(c));
    else blankByRule.push(name(c));
  }
  return { missing, blankByRule };
}

/**
 * 이번 사건의 행이 **있는가**.
 *
 * 판정 순서가 보호 장치다 — 평상시(`no_incident`)를 맨 앞에 두어 표지가 없는 배포에 거짓
 * 경보를 만들지 않고, 그 뒤 **못 읽는 값**(`unreadable_anchor`)과 **기준점 없음**
 * (`unanchored`)이 온다(기준점이 없으면 「앞섰다」를 셀 수 없다 — §3-14 와 같은 순서다).
 * 표를 못 읽은 것(`no_table`)은 귀속의 기준점이 있을 때만 의미가 있어 그 뒤에 둔다.
 * 마지막이 행 쪽 판정이고, **귀속을 말할 수 없는 행(`boundary`)을 미기록보다 앞에** 둔다 —
 * 뒤에 두면 적어 둔 기록이 「없다」로 보고된다.
 */
export function assessIncidentRecord(input?: RecordInput): RecordAssessment {
  const cells = input?.cells ?? INCIDENT_ROW_CELLS;
  const rows = input?.rows ?? [];
  const markers = input?.markers ?? {};
  const tableFound = input?.tableFound ?? true;
  const timeline: TimelineAssessment = assessTimeline({ env: markers });

  const anchorAt = timeline.anchorAt;
  const anchorDay = anchorAt ? anchorAt.slice(0, 10) : null;
  const anchorUnreadable = timeline.unreadableKeys.includes(ANCHOR_ENV);
  const markersPresent = [...timeline.present];
  const captureOpen = markersPresent.length > 0;

  const incident = rows.filter((r) => purposeOfRow(r) === 'incident');
  const attributed: number[] = [];
  const boundary: number[] = [];
  const predating: number[] = [];
  if (anchorDay) {
    const dayBefore = addDays(anchorDay, -1);
    for (const r of incident) {
      if (r.date >= anchorDay) attributed.push(r.row);
      else if (dayBefore && r.date === dayBefore) boundary.push(r.row);
      else predating.push(r.row);
    }
  }

  const matched = attributed.length === 1 ? (incident.find((r) => r.row === attributed[0]) ?? null) : null;
  const cellState = matched ? emptyCellsOf(matched, cells) : { missing: [], blankByRule: [] };

  let verdict: RecordVerdict;
  if (!captureOpen) verdict = 'no_incident';
  else if (anchorUnreadable) verdict = 'unreadable_anchor';
  else if (anchorAt === null) verdict = 'unanchored';
  else if (!tableFound) verdict = 'no_table';
  else if (attributed.length > 1) verdict = 'ambiguous';
  else if (attributed.length === 1) verdict = 'recorded';
  else if (boundary.length > 0) verdict = 'boundary_only';
  else if (incident.length > 0) verdict = 'predating_only';
  else verdict = 'unrecorded';

  const caveats = [CAVEAT_ROW_IS_A_CLAIM, CAVEAT_CLEARED_IS_SILENT];
  if (boundary.length > 0) caveats.push(CAVEAT_DAY_BOUNDARY);

  return {
    verdict,
    anchorKey: ANCHOR_ENV,
    anchorAt,
    anchorDay,
    markersPresent,
    captureOpen,
    incidentRows: incident.length,
    attributed,
    boundary,
    predating,
    matchedRow: matched ? matched.row : null,
    matchedDate: matched ? matched.date : null,
    emptyCells: cellState.missing,
    blankByRule: cellState.blankByRule,
    action: ACTION[verdict],
    caveats,
    ref: RECORD_RUNBOOK_REF,
  };
}

/* ─────────────── 표지 삭제(8단계 4번) 선행 조건 — 2번 + 3번 ─────────────── */

/** 행 쪽이 삭제를 막는 판정 */
const ROW_BLOCKS: Partial<Record<RecordVerdict, string>> = {
  unrecorded: '§6 표에 **사건 행이 없다**(8단계 3번 미수행) — 지우면 수치를 산출할 근거가 전부 사라진다',
  predating_only: '사건 행이 전부 앵커보다 앞이다 — 이번 사건의 행이 아니다(8단계 3번 미수행)',
  boundary_only: '사건 행의 귀속을 말할 수 없다(앵커 전날) — 비고에 타임존 붙인 시각을 적어 확정한다',
  ambiguous: '앵커 이후의 사건 행이 둘 이상이다 — 어느 것이 이번 사건인지 확정한 뒤에 지운다',
  no_table: '§6 표를 읽지 못했다 — **판정 보류이고 통과가 아니다**',
  unanchored: `\`${ANCHOR_ENV}\` 가 없어 행의 귀속을 말할 수 없다 — **판정 보류이고 통과가 아니다**`,
  unreadable_anchor: `\`${ANCHOR_ENV}\` 를 읽을 수 없다 — 고친 뒤에 지운다`,
};

export interface ClearGateResult {
  /** 2번·3번을 **함께** 보았을 때 지워도 되는가 */
  clearable: boolean;
  /** 삭제를 막는 이유. 비어 있을 때만 지운다 */
  blockers: string[];
  /** 런타임 게이트가 **보지 못하는** 항목(이 절이 메우는 자리) */
  unseenByRuntime: string[];
  note: string;
}

/**
 * 런타임 `canClearMarkers`(2번)에 **3번을 더한** 판정. 런타임 판정을 **다시 만들지 않고**
 * 그대로 받아 합친다 — 두 곳에서 같은 말을 하면 갈라지고, 갈라진 쪽은 아무 응답도 바꾸지
 * 않아 영구히 남는다(§3-14 가 적어 둔 규율이다).
 *
 * 런타임 판정을 **넣지 않으면 통과시키지 않는다**(fail-closed) — 2번을 보지 않은 판정을
 * 「지워도 된다」로 돌려주면 이 절이 메우려던 구멍을 반대 방향으로 다시 낸다.
 */
export function clearGate(args: {
  record: RecordAssessment;
  /** `checks.lossNotice.detail.canClearMarkers` 를 **그대로** 넣는다 */
  runtimeClearable?: boolean;
  /** `checks.lossNotice.detail.blockers` 를 **그대로** 넣는다 */
  runtimeBlockers?: readonly string[];
}): ClearGateResult {
  const record = args.record;
  const unseenByRuntime = unseenGateItems().map((g) => `${g.item} — ${g.what}`);

  // 평상시에는 지울 표지가 없다 — 막을 것도 없고, 표를 묻지도 않는다.
  if (record.verdict === 'no_incident') {
    return {
      clearable: true,
      blockers: [],
      unseenByRuntime,
      note: '지울 표지가 없다(평상시) — 이 판정은 표를 묻지 않는다',
    };
  }

  const blockers: string[] = [];
  if (args.runtimeClearable === undefined) {
    blockers.push(
      '런타임 판정(`checks.lossNotice.detail.canClearMarkers`)을 함께 넣지 않았다 — 2번(고지)을 보지 않은 채 지우지 않는다',
    );
  } else if (!args.runtimeClearable) {
    const given = (args.runtimeBlockers ?? []).map((b) => String(b));
    blockers.push(...(given.length > 0 ? given : ['런타임 게이트가 삭제를 막고 있다(§3-10 `blockers` 를 함께 본다)']));
  }

  const rowBlock = ROW_BLOCKS[record.verdict];
  if (rowBlock) blockers.push(rowBlock);
  if (record.verdict === 'recorded' && record.emptyCells.length > 0) {
    blockers.push(`사건 행의 필수 칸이 비어 있다: ${record.emptyCells.join(', ')} — 표지가 남아 있는 동안이 적을 수 있는 유일한 기회다`);
  }

  return {
    clearable: blockers.length === 0,
    blockers,
    unseenByRuntime,
    note:
      blockers.length === 0
        ? '2번·3번을 함께 보았다 — 비고 칸(§3-23)·구간(§6-7) 판정까지 확인한 뒤 지운다'
        : '지우지 않는다 — 지운 뒤에는 수치를 산출할 수 없고, 기록하지 않은 사건은 평상시와 구별되지 않는다',
  };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 구조화 로그 한 줄. **판정·행 번호·개수만** — 시각·일자·담당자는 담지 않는다 */
export function incidentRecordLine(a: RecordAssessment): string {
  const parts = [
    'incident_record',
    `verdict=${a.verdict}`,
    `markers=${a.markersPresent.length}`,
    `incident_rows=${a.incidentRows}`,
    `attributed=${a.attributed.length}`,
  ];
  if (a.boundary.length > 0) parts.push(`boundary=${a.boundary.length}`);
  if (a.predating.length > 0) parts.push(`predating=${a.predating.length}`);
  if (a.emptyCells.length > 0) parts.push(`empty_cells=${a.emptyCells.length}`);
  if (a.captureOpen) parts.push('capture=open');
  return parts.join(' ');
}

/** 사람이 읽을 요약 — 저장소 명령 출력 */
export function incidentRecordText(a: RecordAssessment): string {
  const lines = [`[사건 행] ${a.verdict}`];
  if (a.anchorDay) lines.push(`앵커 ${a.anchorDay}(${a.anchorKey}) · 사건 행 ${a.incidentRows}건 중 귀속 ${a.attributed.length}건`);
  else lines.push(`앵커 없음(${a.anchorKey}) · 사건 행 ${a.incidentRows}건`);
  if (a.matchedRow !== null) lines.push(`이번 사건의 행: ${a.matchedRow}번(${a.matchedDate})`);
  if (a.emptyCells.length > 0) lines.push(`비어 있는 필수 칸: ${a.emptyCells.join(', ')}`);
  if (a.blankByRule.length > 0) lines.push(`규율상 비워 두는 칸: ${a.blankByRule.join(', ')}`);
  lines.push(a.action);
  return lines.join('\n');
}

/** 요약 — 판정·수치만 */
export function incidentRecordStatus(input?: RecordInput): {
  verdict: RecordVerdict;
  captureOpen: boolean;
  incidentRows: number;
  attributed: number;
  emptyCells: number;
  unseen: number;
  misreads: number;
  limits: number;
  ref: string;
  text: string;
} {
  const a = assessIncidentRecord(input);
  return {
    verdict: a.verdict,
    captureOpen: a.captureOpen,
    incidentRows: a.incidentRows,
    attributed: a.attributed.length,
    emptyCells: a.emptyCells.length,
    unseen: unseenGateItems().length,
    misreads: RECORD_MISREADS.length,
    limits: RECORD_LIMITS.length,
    ref: RECORD_RUNBOOK_REF,
    text: incidentRecordText(a),
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/**
 * `lib/lossNotice.ts` 원문 점검 — 런타임 게이트가 **3번을 보지 못한다는 사실**이 그 자리에
 * 적혀 있는지. 이 한계를 적어 두지 않으면 4번을 수행하는 사람은 `canClearMarkers: true` 를
 * 「2·3번이 끝났다」로 읽는다(응답은 그대로 200 이라 알아챌 수 없다).
 */
export function auditClearGateBlindSpot(lossNoticeSrc: unknown): string[] {
  const s = String(lossNoticeSrc ?? '');
  const problems: string[] = [];
  if (!s.includes('canClearMarkers')) {
    problems.push('lib/lossNotice.ts 에 canClearMarkers 가 없다 — 8단계 4번의 게이트가 사라졌다(이 절의 상대다)');
    return problems;
  }
  if (!/6-10/.test(s)) {
    problems.push('lib/lossNotice.ts 가 §6-10 을 가리키지 않는다 — 3번을 보지 못한다는 한계가 그 자리에 없다');
  }
  if (!/unseen/.test(s)) {
    problems.push('lib/lossNotice.ts 가 보지 못하는 선행 조건(`unseen`)을 응답에 담지 않는다 — 게이트가 2번만 보는 사실이 숨는다');
  }
  return problems;
}

/**
 * `lib/remarkSlots.ts` 원문 점검 — **행이 없을 때 `not_applicable`** 이라는 사실이 이 절의
 * 근거다(`nothing_to_write`). 그 동작이 바뀌면 정본 설명을 함께 고쳐야 한다.
 */
export function auditRowReaderPrecondition(remarkSrc: unknown): string[] {
  const s = String(remarkSrc ?? '');
  const problems: string[] = [];
  if (!/if\s*\(!row\)/.test(s)) {
    problems.push('lib/remarkSlots.ts 의 행 부재 분기를 찾을 수 없다 — RECORD_MISREADS.nothing_to_write 의 근거가 바뀌었다');
  } else if (!/if\s*\(!row\)\s*return[^\n]*not_applicable/.test(s)) {
    problems.push('lib/remarkSlots.ts 가 행 부재를 not_applicable 로 돌려주지 않는다 — 이 절의 전제가 바뀌었으니 정본을 함께 고칠 것');
  }
  return problems;
}

/**
 * `lib/ledgerPurpose.ts` 원문 점검 — 사건 행을 적으라고 지시하는 단계와 실측 자격이 정본에
 * 그대로 있는지(`promise_measured_by_practice` 의 근거다).
 */
export function auditPurposeRoleSource(purposeSrc: unknown): string[] {
  const s = String(purposeSrc ?? '');
  const problems: string[] = [];
  if (!s.includes('§3 8단계')) {
    problems.push('lib/ledgerPurpose.ts 의 사건 행 writtenBy 가 §3 8단계가 아니다 — 이 절이 가리키는 단계가 바뀌었다');
  }
  if (!/rtoEvidence:\s*'measurement'/.test(s)) {
    problems.push("lib/ledgerPurpose.ts 에 rtoEvidence: 'measurement' 가 없다 — 사건 행만이 실측 자격을 갖는다는 정본이 사라졌다");
  }
  return problems;
}

/**
 * **런타임 체크를 만들지 않았는지**. 판정의 한쪽이 저장소 문서라 `/api/health` 에 실으면 그
 * 응답 자신이 거짓 보증이 된다(§6-9 와 같은 자리다).
 */
export function auditNoNewHealthCheck(healthSrc: unknown): string[] {
  const s = String(healthSrc ?? '');
  const problems: string[] = [];
  if (/incidentRecord/.test(s)) {
    problems.push('app/api/health/route.ts 가 incidentRecord 를 쓴다 — 런타임은 §6 표를 읽지 못하므로 그 응답은 거짓 보증이 된다');
  }
  return problems;
}

/** `RUNBOOK.md` 원문 점검 — 절과 8단계의 유도가 살아 있는지 */
export function auditRunbookIncidentRecord(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-10\./m.test(s)) {
    problems.push('§6-10 절이 사라졌다 — 8단계 3번의 수행 여부를 묻는 유일한 자리다');
  }
  for (const m of RECORD_MISREADS) {
    if (!s.includes(m.key)) problems.push(`§6-10 에 거짓 판정 ${m.key} 가 없다`);
  }
  const at = s.search(/^8\.\s+\*\*사후\*\*/m);
  if (at < 0) {
    problems.push('§3 8단계를 찾을 수 없다 — 제목 모양이 바뀌었으면 이 가드를 함께 볼 것');
  } else {
    // 다음 소절 제목까지만 본다 — 글자 수로 자르면 뒤따르는 절의 언급이 8단계의 유도로
    // 세어져 **빠진 것을 있다고** 말한다(가장 조용한 거짓 통과다).
    const rest = s.slice(at);
    const end = rest.search(/^###\s/m);
    const step8 = end > 0 ? rest.slice(0, end) : rest;
    if (!/6-10/.test(step8)) {
      problems.push('§3 8단계가 §6-10 으로 유도하지 않는다 — 3번을 거른 채 4번으로 가는 길이 다시 열린다');
    }
    if (!/canClearMarkers/.test(step8)) {
      problems.push('§3 8단계 4번이 런타임 게이트를 인용하지 않는다(§3-10 과 함께 보는 자리다)');
    }
  }
  const cl = s.search(/^###\s*리허설 체크리스트/m);
  if (cl < 0) problems.push('§6 에 리허설 체크리스트가 없다');
  else if (!/(?<!\d)6-10(?!\d|단계)/.test(s.slice(cl))) {
    problems.push('리허설 체크리스트가 §6-10 을 인용하지 않는다 — 리허설에서 이름으로 찾을 수 없다');
  }
  return problems;
}

/** 칸 정본이 §6-4 `LEDGER_FIELDS` 와 **양방향으로** 맞는지 */
export function auditCellRegistry(
  cells: readonly IncidentCell[] = INCIDENT_ROW_CELLS,
  fields: readonly LedgerField[] = LEDGER_FIELDS,
): string[] {
  const problems: string[] = [];
  const known = new Set(fields.map((f) => f.key));
  for (const c of cells) {
    if (!known.has(c.field)) problems.push(`칸 ${c.field} 가 §6-4 LEDGER_FIELDS 에 없다 — 정본이 갈라졌다`);
    if (!c.why.trim()) problems.push(`칸 ${c.field} 에 빠지면 무엇이 거짓이 되는가가 없다`);
    if (!c.required && !c.blankOk) problems.push(`칸 ${c.field} 가 필수가 아닌 이유(blankOk)가 없다`);
  }
  const covered = new Set(cells.map((c) => c.field));
  for (const f of fields) {
    if (!covered.has(f.key)) {
      problems.push(`§6 표의 칸 ${f.key} 가 사건 행 정본에 없다 — 열이 늘었으면 필수 여부를 함께 적을 것`);
    }
  }
  return problems;
}
