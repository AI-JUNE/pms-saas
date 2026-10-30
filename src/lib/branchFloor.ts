/**
 * branchFloor.ts — 보존 창의 하한은 **하나가 아니다**: 복구를 한 번 거친 운영 DB 는 그 자신이
 * **자식 브랜치**이고 분기 시점보다 이전으로 갈 수 없다 (RUNBOOK §3-21 · §3 3단계 · §3-6). 2026-10-30
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3-6 은 3단계의 「시점 T-ε 로 브랜치를 만든다」를 산출·판정 가능하게 만들면서 보존 창의 하한을
 * `현재 - RECOVERY_PITR_RETENTION_HOURS` **하나로만** 센다. 그런데 §3 3단계는 「*새 브랜치*를
 * 만든다」이고 5단계는 운영 `DATABASE_URL` 을 **그 브랜치로 교체**한다 — 즉 복구를 한 번 끝내면
 * 운영이 보는 DB 는 **분기 시점을 가진 자식 브랜치**로 바뀐다. 자식 브랜치는 분기 시점보다
 * 이전으로 되돌릴 수 없다. 그 사실은 `recoveryWindow.WINDOW_LIMITS` 에 **한 줄 적혀 있을 뿐**
 * 판정에는 들어가지 않았다.
 *
 *  (1) **두 번째 사건에서 `ok` 가 틀린다.** 플랜 보존기간이 168시간이고 지난 복구가 11일 전
 *      시점으로 되감았다면, 9일 전 T 는 설정 창 안이지만 **분기 시점보다 뒤가 아니라 앞**일 수
 *      있다 — 그때 §3-6 은 `ok` 를 내고, 담당자는 그 말을 믿고 2단계 **쓰기 차단(전 사용자 저장
 *      503)**을 건 뒤 3단계에서야 「그 시점으로는 만들 수 없다」를 안다. **복구는 불가능한데
 *      서비스는 멈춘 상태** — §3-6 이 막으려고 만들어진 바로 그 상태가, 복구를 한 번 **해 본
 *      조직에서만** 되살아난다.
 *  (2) **마감까지 틀린다.** `deadline`(= T-ε + 보존기간)·`remainingMinutes` 는 분기 시점보다
 *      이전인 T-ε 에도 **미래 시각**을 내놓는다. 분기 시점은 설정 창 하한과 달리 **전진하지
 *      않으므로**, 「지금은 되는데 내일은 안 된다」가 아니라 **처음부터 안 되는** 시점이다.
 *  (3) **`expired` 의 대안도 틀린 쪽을 가리킨다.** §3-6 은 창 밖이면 「창 안의 **가장 이른
 *      시점**으로 복구할지」를 사람에게 묻는데, 복구를 거친 DB 에서 그 가장 이른 시점은 창
 *      하한이 아니라 **분기 시점**이다. 그보다 이른 시점을 콘솔에 넣으면 거절된다.
 *  (4) **하한을 아는 값은 「지워야 하는 값」이다.** 분기 시점 = 그 복구의 `RECOVERY_RESTORE_POINT`
 *      인데, 8단계 4번은 그 표지를 **지우라고 지시한다** — 그 지시는 **옳다**(남기면 다음 사건이
 *      물려받는다. §3-14). 그래서 평상시에 하한을 말해 줄 수 있는 것은 **영구 기록인 §6 표의
 *      `복구 대상 시점` 칸 하나**뿐이고, 그 칸을 읽는 §6-7 은 그것을 **RPO 실측**으로만 쓰고
 *      다음 복구의 하한으로는 넘기지 않았다.
 *  (5) **사건 중의 표지를 하한으로 읽으면 더 나쁘다.** 1~2단계에서 `RECOVERY_RESTORE_POINT` 가
 *      들어 있다면 그것은 **이번** 복구 시점이거나 지우지 않고 남은 옛 값이다 — 전자를 하한으로
 *      쓰면 **자기 자신과 비교**하게 되어 판정이 영구히 경계값이 되고, 후자는 §3-14 가 결함으로
 *      보는 상태를 근거로 삼는 것이다. 그래서 **이 모듈은 env 를 하나도 읽지 않는다.**
 *
 * 그래서 이 모듈은
 *   · 하한을 말해 줄 수 있는 자리를 정본으로 두고(`FLOOR_SOURCES` — 영구한지 · 코드가 읽을 수
 *     있는지 · 언제 사라지는지. 그중 **정본은 Neon 콘솔이고 코드가 보지 못한다**),
 *   · 거짓이 되는 판정을 적어 두고(`FLOOR_MISREADS`),
 *   · §6 표에서 하한을 **도출하고**(`floorFromLedger` — §6-7 `parseRecordedInstant` 와 §6-6
 *     `kindState` 를 **그대로 재사용**한다. 연습 행은 하한을 옮기지 않는다),
 *   · 판정하고(`assessBranchFloor` → `not_applicable`·`invalid_floor`·`future_floor`·
 *     **`below_floor`**·`zoneless_floor`·**`floor_unknown`**·`narrowed`·`clear`),
 *   · §3-6 산출과 **합쳐서** 내보낸다(`recoveryWindowWithFloor` — §3-21 의 1줄 명령이 이것을
 *     출력한다. 판정만 하고 버리지 않는다).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL 0 · 신규 런타임 체크 0 ·
 *   신규 사건 표지 0 · 신규 env 0**. env 는 §3-6 산출로 **통과만** 시킨다.
 * - **새 체크를 만들지 않는다.** 런타임은 저장소 문서를 읽지 않으므로 `/api/health` 에 실으면
 *   전 배포가 상시 `floor_unknown`(판정 보류)만 내보낸다 — 아무 말도 하지 않는 체크다.
 * - **값을 지어내지 않는다.** 하한을 모르면 `floor_unknown` 이고 **통과가 아니다**. 임의 분기
 *   시점도, 임의 보존기간도 만들지 않는다(후자는 §3-6 의 규율 그대로다).
 * - **거짓 차단을 만들지 않는다.** `below_floor` 는 표 기록에서 도출한 판정이라 복구를 포기하기
 *   전에 **콘솔의 「복구 가능 시점」을 정본으로** 확인하라고 말한다(`FLOOR_LIMITS`).
 */
import { parseInstant } from './incidentEvidence.ts';
import { hasTimezone, restorePointStatus, restorePointText, type RestorePointPlan } from './recoveryWindow.ts';
import { parseRecordedInstant, TARGET_COLUMN } from './restorePointRecord.ts';
import { kindState } from './rehearsalKind.ts';
import type { LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const FLOOR_RUNBOOK_REF = 'RUNBOOK §3-21';

const MS_HOUR = 3_600_000;

/* ─────────────────── 하한을 말해 줄 수 있는 자리(정본) ─────────────────── */

export type FloorSourceKey = 'restore_point_marker' | 'ledger_target' | 'neon_console';

export interface FloorSource {
  key: FloorSourceKey;
  /** 무엇이 적혀 있는가 */
  what: string;
  /** 어디에 */
  where: string;
  /** 사건이 끝나도 남는가 */
  durable: boolean;
  /** 코드가 읽을 수 있는가(저장소 명령·CI 시점을 포함한다) */
  readableByCode: boolean;
  /** 언제 사라지는가 · 왜 하한으로 쓸 수 없는가 */
  lostWhen: string;
}

export const FLOOR_SOURCES: readonly FloorSource[] = [
  {
    key: 'restore_point_marker',
    what: '지난 복구가 실제로 적용한 복구 시점(T-ε) = 그 브랜치의 분기 시점',
    where: '운영 스코프 `RECOVERY_RESTORE_POINT`(§3 3단계가 적는다)',
    durable: false,
    readableByCode: true,
    lostWhen:
      '8단계 4번이 **지우라고 지시한다 — 그 지시는 옳다**(남기면 다음 사건이 옛 시각을 물려받는다. §3-14). ' +
      '게다가 사건 중에 들어 있는 값은 **이번** 복구 시점이라 하한이 아니다(자기 자신과 비교하게 된다) — ' +
      '그래서 이 모듈은 이 자리를 **읽지 않는다**',
  },
  {
    key: 'ledger_target',
    what: `사건 행의 \`${TARGET_COLUMN}\` = 그때 되감은 시점`,
    where: 'RUNBOOK §6 표(영구 기록. 8단계 3번이 사람 손으로 옮겨 적는다)',
    durable: true,
    readableByCode: true,
    lostWhen:
      '사람이 옮겨 적지 않으면 비어 있다(§6-7 `ephemeral_only`) · 판독 불가·타임존 없는 칸은 §6-7 이 따로 판정한다 · ' +
      '**런타임은 저장소 문서를 읽지 않으므로** 이 자리는 CI·저장소 명령에서만 보인다',
  },
  {
    key: 'neon_console',
    what: '브랜치의 분기 시점과 「복구 가능 시점(History retention)」',
    where: 'Neon 콘솔 — **정본**',
    durable: true,
    readableByCode: false,
    lostWhen:
      '코드가 보지 못한다(API 조회 0 — 신규 네트워크 접근을 만들지 않는다). ' +
      '이 판정은 콘솔을 **대체하지 않는다** — 복구를 포기하는 판단 앞에서는 콘솔이 정본이다',
  },
];

/** 모르는 자리는 null — 지어내지 않는다 */
export function floorSourceFor(key: unknown): FloorSource | null {
  return FLOOR_SOURCES.find((s) => s.key === key) ?? null;
}

/* ─────────────────── 거짓이 되는 판정(정본) ─────────────────── */

export interface FloorMisread {
  key: string;
  /** 어느 판정이 */
  judgement: string;
  /** 무슨 말을 하게 되는가 */
  says: string;
  /** 왜 그것이 거짓인가 */
  why: string;
}

export const FLOOR_MISREADS: readonly FloorMisread[] = [
  {
    key: 'window_ok_ignores_floor',
    judgement: '§3-6 `verdict: ok`',
    says: '그 시점으로 브랜치를 만들 수 있다',
    why: '하한을 `현재 - 보존기간` 하나로만 센다 — 복구를 거친 DB 는 **분기 시점**이라는 두 번째 하한을 가지고, 그보다 이전 시점은 설정 창 안이어도 만들 수 없다',
  },
  {
    key: 'deadline_is_future',
    judgement: '§3-6 `deadline`·`remainingMinutes`',
    says: '이 시점으로는 언제까지 브랜치를 만들 수 있다',
    why: '`T-ε + 보존기간` 이라 **분기 시점 이전의 T-ε 에도 미래 마감**을 내놓는다. 분기 시점은 전진하지 않으므로 그 시점은 「내일까지」가 아니라 **처음부터 불가**다',
  },
  {
    key: 'earliest_is_window_start',
    judgement: '§3-6 `expired` 의 조치 문구',
    says: '창 안의 **가장 이른 시점**으로 복구할지 사람이 결정한다',
    why: '복구를 거친 DB 에서 가장 이른 시점은 창 하한이 아니라 **분기 시점**이다 — 그보다 이른 시점을 콘솔에 넣으면 거절된다',
  },
  {
    key: 'marker_is_not_the_floor',
    judgement: '사건 중의 `RECOVERY_RESTORE_POINT` 를 하한으로 읽기',
    says: '지금 운영 브랜치의 분기 시점은 이 값이다',
    why: '그 값은 **이번** 복구 시점이거나(→ 자기 자신과 비교해 영구히 경계값) 지우지 않고 남은 옛 값이다(§3-14 가 결함으로 보는 상태) — 어느 쪽도 하한의 근거가 아니다',
  },
  {
    key: 'retention_is_not_the_floor',
    judgement: '§2 월 점검 4번의 「최신 복구 가능 시점 확인」',
    says: '보존기간을 확인해 설정값에 적었으니 창 판정은 최신이다',
    why: '그 수치는 **플랜의 보존기간**이고 브랜치의 분기 시점이 아니다 — 보존기간을 아무리 정확히 적어도 분기 시점보다 이전으로는 갈 수 없다',
  },
];

/* ─────────────────── 사각지대 ─────────────────── */

export interface FloorBlindSpot {
  key: string;
  what: string;
  why: string;
}

export const FLOOR_BLIND_SPOTS: readonly FloorBlindSpot[] = [
  {
    key: 'switch_unknown_from_table',
    what: '그 사건 행이 **전환까지 갔는지**는 표에서 알 수 없다',
    why: '검증(4단계)에서 멈추거나 §5 롤백으로 끝낸 사건도 `복구 대상 시점` 을 적을 수 있다 — 그러면 하한을 실제보다 **늦게** 보고 `below_floor` 가 **거짓 차단**이 된다(그래서 콘솔이 정본이다)',
  },
  {
    key: 'multiple_generations',
    what: '복구를 여러 번 거치면 하한이 누적해 전진하는데, 표에는 **각 세대의 시점**만 있다',
    why: '어느 행이 현재 운영 브랜치의 **조상**인지는 적히지 않는다 — 가장 늦은 사건 행을 쓰는 것은 **가정**이고, 그 가정은 지문(§3-4)으로도 확인되지 않는다',
  },
  {
    key: 'in_place_restore',
    what: '**제자리 복구**는 분기가 일어났는지조차 구분되지 않는다',
    why: '엔드포인트가 그대로여서 지문이 바뀌지 않고(§3-4 `IDENTITY_LIMITS`), 되돌린 뒤 히스토리가 어디까지 남는지는 콘솔에만 있다',
  },
  {
    key: 'rehearsal_not_a_floor',
    what: '연습 행은 하한을 옮기지 않는다 — 그러나 **전환까지 한 리허설**은 옮긴다',
    why: '유형(§6-6)만으로는 그 둘이 갈라지지 않는다. 연습을 전부 세면 거짓 차단이 되고, 전부 거르면 전환 리허설이 만든 하한을 놓친다 — 거르는 쪽을 택하고 그 사실을 적어 둔다',
  },
  {
    key: 'day_only_cell',
    what: '표 칸이 날짜만이면 `00:00Z` 로 읽혀 하한을 **9시간 이르게** 본다',
    why: '창을 **넓게** 보는 쪽(= 막아야 할 시점을 통과시키는 쪽)이라 `zoneless_floor` 에서 멈춘다 — §6-7 이 `zoneless_target` 으로 고치라고 하는 그 칸이다',
  },
  {
    key: 'history_is_not_rows',
    what: '분기 시점 **이후**라는 것이 그 구간의 데이터가 있다는 뜻은 아니다',
    why: '히스토리 보존·compute 삭제·브랜치 삭제는 창 계산과 무관하게 복구를 막는다(§3-6 `WINDOW_LIMITS` 그대로)',
  },
  {
    key: 'runtime_blind',
    what: '평상시 `/api/health` 는 이 판정을 말하지 않는다',
    why: '하한의 유일한 영구 기록이 저장소 문서(§6 표)이고 런타임은 그것을 읽지 않는다 — 새 체크를 만들면 전 배포가 상시 `floor_unknown` 만 내보낸다(§2-2)',
  },
];

/** 보장하지 **못하는** 것 — 판정과 함께 실려 나간다 */
export const FLOOR_LIMITS: readonly string[] = [
  '**코드는 브랜치를 보지 않는다** — Neon API·DB 에 묻지 않고, 하한은 사람이 적은 영구 기록(§6 표)에서 **도출한다**. 정본은 콘솔이다',
  '`below_floor` 는 **표에서 도출한 판정**이라 거짓 차단이 될 수 있다 — 복구를 포기하기 전에 콘솔의 「복구 가능 시점」을 정본으로 확인한다',
  '`clear`·`narrowed` 는 「복구 성공」이 아니다 — **시점의 가용성**만, 그것도 표 기록이 맞다는 전제에서 말한다(§3-6 과 같은 한계)',
  '분기 시점은 **전진하지 않는다** — 설정 창 하한이 그것을 넘어서면 `narrowed` 는 저절로 `clear` 가 된다(「좁아진 상태가 영구」가 아니다)',
  '이 판정은 **어느 브랜치의 하한인지** 말하지 않는다 — 지금 운영이 보는 DB 가 그 표 행의 복구 브랜치라는 것은 §3-4 지문으로만 확인된다',
  '사람이 §6 표에 옮겨 적지 않으면 `floor_unknown` 에서 멈춘다 — **통과가 아니다.** 코드는 표를 채우지 않는다(§6 머리말)',
  '하한을 지키는 것이 **손상 전**을 뜻하지 않는다 — T 특정이 틀렸으면 손상된 시점으로 복구한다(§3-6 `CAVEAT_NOT_PROOF_OF_CLEAN`)',
];

/* ─────────────────────────── §6 표에서 하한 도출 ─────────────────────────── */

export type FloorSkipReason = 'rehearsal' | 'kind_unreadable' | 'no_target' | 'unreadable_target' | 'earlier';

export interface FloorSkip {
  row: number;
  date: string;
  reason: FloorSkipReason;
}

export interface LedgerFloor {
  /** 하한으로 쓸 사건 행을 **찾았는가**(판독 성공과는 다르다) */
  recorded: boolean;
  /** 그 칸 원문 */
  raw: string;
  /** 판독한 분기 시점(ISO). 못 읽으면 null — 추측하지 않는다 */
  at: string | null;
  /** 타임존 없이 적혀 있었다 → UTC 로 읽혀 하한을 이르게 본다 */
  zoneless: boolean;
  row: number | null;
  date: string | null;
  /**
   * 하한이 **이 행이라고 단정할 수 없다** — 유형을 읽을 수 없는 행이나 판독 불가 칸이 있어
   * 그쪽이 더 늦을 수 있다. 그때는 통과시키지 않는다(단, `below_floor` 는 그대로 성립한다).
   */
  ambiguous: boolean;
  /** 세지 않은 행과 이유 */
  skipped: readonly FloorSkip[];
}

/**
 * §6 표의 **사건 행**에서 분기 시점의 하한을 도출한다 — 가장 **늦은** 시점을 쓴다.
 *
 * 판독은 §6-7 `parseRecordedInstant`, 유형은 §6-6 `kindState` 를 **그대로 쓴다**(같은 규칙을
 * 두 번 적으면 갈라진 쪽이 아무 응답도 바꾸지 않으므로 영구히 남는다). 연습 행은 전환하지
 * 않고 정리되므로 하한을 옮기지 않는다 — 그 선택의 한계는 `rehearsal_not_a_floor` 에 적는다.
 */
export function floorFromLedger(rows: readonly LedgerRow[] = []): LedgerFloor {
  const skipped: FloorSkip[] = [];
  let best: { at: string; raw: string; zoneless: boolean; row: number; date: string } | null = null;
  let ambiguous = false;

  for (const row of rows) {
    const kind = kindState(row.kind);
    const parsed = parseRecordedInstant(row.target);
    if (kind === 'regular') {
      skipped.push({ row: row.row, date: row.date, reason: 'rehearsal' });
      continue;
    }
    if (kind !== 'incident') {
      // 유형을 읽을 수 없는 행이 **시점을 들고 있으면** 하한일 수도 있다 — 단정하지 않는다.
      skipped.push({ row: row.row, date: row.date, reason: 'kind_unreadable' });
      if (parsed.recorded) ambiguous = true;
      continue;
    }
    if (!parsed.recorded) {
      skipped.push({ row: row.row, date: row.date, reason: 'no_target' });
      continue;
    }
    if (!parsed.at) {
      // 들어 있는데 못 읽는다 — 그쪽이 더 늦을 수 있으므로 통과시키지 않는다(§6-7 이 고치라고 한다).
      skipped.push({ row: row.row, date: row.date, reason: 'unreadable_target' });
      ambiguous = true;
      continue;
    }
    if (best && best.at >= parsed.at) {
      skipped.push({ row: row.row, date: row.date, reason: 'earlier' });
      continue;
    }
    if (best) skipped.push({ row: best.row, date: best.date, reason: 'earlier' });
    best = { at: parsed.at, raw: parsed.raw, zoneless: parsed.zoneless, row: row.row, date: row.date };
  }

  return {
    recorded: best !== null,
    raw: best?.raw ?? '',
    at: best?.at ?? null,
    zoneless: best?.zoneless ?? false,
    row: best?.row ?? null,
    date: best?.date ?? null,
    ambiguous,
    skipped,
  };
}

/* ─────────────────────────── 판정 ─────────────────────────── */

/**
 * - `clear`          : 분기 시점이 이 복구 시점을 막지 않고, 설정 창 하한보다 이르다(판정에 영향 없음).
 * - `narrowed`       : 막지는 않지만 **실효 창이 설정 창보다 좁다** — 「가장 이른 시점」은 분기 시점이다.
 * - `below_floor`    : **T-ε 가 분기 시점보다 이전이다 — 그 시점으로는 만들 수 없다**(설정 창 안이어도).
 * - `zoneless_floor` : 하한이 타임존 없이 적혀 있다 — UTC 로 읽혀 창을 넓게 보므로 **통과시키지 않는다**.
 * - `floor_unknown`  : 하한을 모른다(미기재·유형 미판독·판독 불가) — **판정 보류이고 통과가 아니다**.
 * - `invalid_floor`  : 하한을 넘겨받았는데 읽을 수 없다(「넣지 않았다」와 할 일이 다르다).
 * - `future_floor`   : 하한이 현재보다 미래다(오타·타임존).
 * - `not_applicable` : 복구 시점이 없다 — §3-6 이 이미 멈췄으므로 하한을 견줄 상대가 없다.
 */
export const FLOOR_VERDICTS = [
  'clear',
  'narrowed',
  'below_floor',
  'zoneless_floor',
  'floor_unknown',
  'invalid_floor',
  'future_floor',
  'not_applicable',
] as const;
export type FloorVerdict = (typeof FLOOR_VERDICTS)[number];

export type FloorBasis = 'given' | 'ledger' | 'none';

export interface FloorAssessment {
  verdict: FloorVerdict;
  basis: FloorBasis;
  /** 판독한 분기 시점(ISO). 모르면 null */
  floorAt: string | null;
  floorRaw: string;
  /** §6 표에서 도출했을 때 그 행 번호·일자 */
  floorRow: number | null;
  floorDate: string | null;
  zoneless: boolean;
  /** 견준 복구 시점 T-ε(ISO) */
  restorePoint: string | null;
  retentionHours: number | null;
  /** §3-6 이 쓰는 하한(= 현재 - 보존기간). 보존기간을 모르면 null */
  configuredWindowStart: string | null;
  /** 실제로 고를 수 있는 **가장 이른 시점**(= 두 하한 중 늦은 쪽) */
  effectiveWindowStart: string | null;
  /** 설정 창보다 몇 시간 좁은가. 좁지 않거나 모르면 null */
  narrowedByHours: number | null;
  /** 분기 시점이 이 복구 시점을 막는가. **보류는 null** — 「막지 않는다」로 올리지 않는다 */
  recoverable: boolean | null;
  ambiguous: boolean;
  skipped: readonly FloorSkip[];
  action: string | null;
  caveats: readonly string[];
}

/* ─────────────────────────── 조치·주의 문구 ─────────────────────────── */

export const ACTION_FLOOR_CLEAR =
  '분기 시점이 이 복구 시점을 막지 않는다 — §3-6 판정대로 3단계로 간다. ' +
  '그래도 브랜치를 만들기 전에 콘솔의 「복구 가능 시점」을 한 번 본다(정본은 콘솔이다)';

export function actionFloorNarrowed(floorAt: string, hours: number | null): string {
  return (
    `실효 보존 창의 하한은 **${floorAt}**(지난 복구의 분기 시점)이다 — 설정 창보다 ` +
    `${hours === null ? '그만큼' : `약 ${hours}시간`} 좁다. 이 복구 시점은 그보다 뒤라 만들 수 있지만, ` +
    '더 이른 시점으로 물러나야 할 때(§3-6 `expired` 의 대안) **가장 이른 시점은 창 하한이 아니라 이 분기 시점**이다'
  );
}

export function actionFloorBelow(floorAt: string): string {
  return (
    `복구 시점이 지난 복구의 **분기 시점(${floorAt})보다 이전**이다 — 지금 운영 브랜치는 그 시점으로 ` +
    '되돌아갈 수 없다(설정 보존 창 안이어도 그렇다). ① **2단계 쓰기 차단을 걸기 전에** 콘솔의 ' +
    '「복구 가능 시점」으로 이 판정을 확인한다(이 하한은 §6 표 기록에서 도출한 값이다). ② 그래도 ' +
    '이전이면 분기 시점 이후의 가장 이른 시점으로 복구할지(손상 구간이 일부 포함될 수 있다 → 4단계 ' +
    '대조로 판단) 또는 **원본 브랜치**(§3-18 — 전환 뒤에도 남아 있다면 그쪽은 더 이른 히스토리를 ' +
    '가진다)나 §5 롤백·수동 정정으로 갈지 **사람이 결정한다**'
  );
}

export const ACTION_FLOOR_ZONELESS =
  `§6 표의 \`${TARGET_COLUMN}\` 칸에 타임존이 없어 **UTC 로 읽었다** — 한국시간으로 적었다면 실제 하한은 ` +
  '9시간 더 늦다(= 창을 넓게 본 것이고, 막아야 할 시점을 통과시키는 쪽이다). 그 칸을 `+09:00` 을 붙여 ' +
  '고친 뒤 다시 산출한다(§6-7 `zoneless_target` 이 같은 칸을 가리킨다). 판정 보류이고 **통과가 아니다**';

export const ACTION_FLOOR_UNKNOWN =
  '지금 운영 브랜치의 **분기 시점을 모른다** — 복구를 한 적이 없으면 정상이고, 한 적이 있으면 ' +
  `§6 표 사건 행의 \`${TARGET_COLUMN}\` 칸이 비었거나(§6-7 \`ephemeral_only\`) 유형·시각을 읽을 수 없는 것이다. ` +
  '**판정 보류이고 통과가 아니다** — 콘솔에서 브랜치의 분기 시점을 확인해 `floorAt` 으로 넘기고, ' +
  '같은 값을 §6 표에 옮겨 적어 다음 사건이 다시 모르는 상태로 시작하지 않게 한다';

export const ACTION_FLOOR_INVALID =
  '넘겨받은 분기 시점을 읽을 수 없다 — `2026-09-18T04:12:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 적는다. ' +
  '「넣지 않았다」(`floor_unknown`)와 할 일이 다르므로 따로 판정한다';

export const ACTION_FLOOR_FUTURE =
  '분기 시점이 현재보다 미래다 — 오타이거나 타임존을 잘못 붙였다(KST 를 UTC 로 적으면 9시간 미래가 된다). ' +
  '미래 하한으로는 모든 복구 시점이 막히므로 **판정하지 않는다**';

export const ACTION_FLOOR_NOT_APPLICABLE =
  '복구 시점이 산출되지 않아(§3-6 가 `invalid_time`·`future`·`invalid_epsilon` 에서 멈췄다) 하한을 견줄 상대가 없다 — ' +
  '§3-6 을 먼저 통과시킨다';

export const CAVEAT_FLOOR_IS_FIXED =
  '분기 시점은 **전진하지 않는다** — 설정 창 하한과 달리 고정이라 「지금은 되는데 내일은 안 된다」가 아니라 ' +
  '처음부터 되거나 안 되거나다. 반대로 시간이 지나면 설정 창 하한이 그것을 넘어서 `narrowed` 가 저절로 `clear` 가 된다';

export const CAVEAT_FLOOR_FROM_RECORD =
  '하한은 **사람이 §6 표에 적은 영구 기록**에서 도출했다 — 코드는 Neon 에 묻지 않는다(조회 0). ' +
  '그 행이 전환까지 갔는지도 표에서는 알 수 없다(`switch_unknown_from_table`)';

export const CAVEAT_CONSOLE_IS_CANON =
  '복구를 포기하는 판단 앞에서는 **콘솔의 「복구 가능 시점」이 정본**이다 — 이 판정은 그것을 대체하지 않고, ' +
  '2단계 쓰기 차단을 걸기 **전에** 확인하라고만 말한다';

export const CAVEAT_FLOOR_AMBIGUOUS =
  '§6 표에 유형을 읽을 수 없는 행이나 판독 불가 칸이 있어 **그쪽이 더 늦은 하한일 수 있다** — ' +
  '찾은 값을 「하한이다」로 올리지 않는다(단, 그보다 이전인 복구 시점은 어느 판독에서도 막히므로 그대로 막는다)';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function normalizeRetention(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= 8760 ? raw : null;
}

/**
 * 분기 시점 하한 판정.
 *
 * 판정 순서를 지킨다 — 복구 시점이 없으면 견줄 상대가 없고(`not_applicable`), 넘겨받은 하한을
 * 못 읽으면 그것이 먼저이고(`invalid_floor`), 미래 하한은 **모든** 시점을 막으므로 오타를
 * 먼저 말한다(`future_floor`). 그 다음이 **`below_floor`** 인데, 이 순서가 중요하다 —
 * 타임존 없는 하한은 UTC 로 읽혀 **실제보다 이르므로**, 그보다도 이전인 복구 시점은 어느
 * 판독에서도 막힌다. 그래서 `below_floor` 를 `zoneless_floor`·`floor_unknown`(둘 다 보류)
 * **앞에** 둔다 — 판독 불가를 통과로 덮지 않으면서, 어느 판독에서도 막히는 것은 막는다.
 */
export function assessBranchFloor(args: {
  restorePoint?: unknown;
  /** 콘솔에서 확인한 분기 시점(있으면 표보다 우선한다) */
  floorAt?: unknown;
  /** §6 표 행(없으면 표를 보지 않았다는 사실이 `basis: 'none'` 으로 남는다) */
  rows?: readonly LedgerRow[];
  retentionHours?: number | null;
  now?: Date;
}): FloorAssessment {
  const retention = normalizeRetention(args.retentionHours ?? null);
  const nowMs = (args.now ?? new Date()).getTime();
  const nowOk = !Number.isNaN(nowMs);
  const rp = parseInstant(args.restorePoint);
  const rpIso = rp ? rp.toISOString() : null;

  const givenRaw = String(args.floorAt ?? '').trim();
  const ledger = floorFromLedger(args.rows ?? []);

  let basis: FloorBasis = 'none';
  let floorAt: string | null = null;
  let floorRaw = '';
  let zoneless = false;
  let unreadableGiven = false;
  if (givenRaw) {
    basis = 'given';
    floorRaw = givenRaw;
    const d = parseInstant(givenRaw);
    floorAt = d ? d.toISOString() : null;
    zoneless = d ? !hasTimezone(givenRaw) : false;
    unreadableGiven = d === null;
  } else if (ledger.recorded) {
    basis = 'ledger';
    floorRaw = ledger.raw;
    floorAt = ledger.at;
    zoneless = ledger.zoneless;
  }

  const ambiguous = basis === 'given' ? false : ledger.ambiguous;
  const configuredWindowStart = retention !== null && nowOk ? iso(nowMs - retention * MS_HOUR) : null;

  const caveats: string[] = [CAVEAT_FLOOR_IS_FIXED, CAVEAT_CONSOLE_IS_CANON];
  if (basis === 'ledger') caveats.unshift(CAVEAT_FLOOR_FROM_RECORD);
  if (ambiguous) caveats.push(CAVEAT_FLOOR_AMBIGUOUS);

  let verdict: FloorVerdict;
  if (!rpIso) verdict = 'not_applicable';
  else if (unreadableGiven) verdict = 'invalid_floor';
  else if (floorAt && nowOk && Date.parse(floorAt) > nowMs) verdict = 'future_floor';
  else if (floorAt && rpIso < floorAt) verdict = 'below_floor';
  else if (floorAt && zoneless) verdict = 'zoneless_floor';
  else if (!floorAt || ambiguous) verdict = 'floor_unknown';
  else if (configuredWindowStart && floorAt > configuredWindowStart) verdict = 'narrowed';
  else verdict = 'clear';

  // 실효 하한은 **두 하한 중 늦은 쪽**이다. 하한을 신뢰할 수 없는 판정에서는 적지 않는다.
  const trusted = verdict === 'clear' || verdict === 'narrowed' || verdict === 'below_floor';
  const effectiveWindowStart = trusted && floorAt
    ? configuredWindowStart && configuredWindowStart > floorAt
      ? configuredWindowStart
      : floorAt
    : configuredWindowStart;
  const narrowedByHours =
    trusted && floorAt && configuredWindowStart && floorAt > configuredWindowStart
      ? Math.round((Date.parse(floorAt) - Date.parse(configuredWindowStart)) / MS_HOUR)
      : null;

  const recoverable = verdict === 'below_floor' ? false : verdict === 'clear' || verdict === 'narrowed' ? true : null;

  const action: Record<FloorVerdict, string> = {
    clear: ACTION_FLOOR_CLEAR,
    narrowed: actionFloorNarrowed(floorAt ?? '', narrowedByHours),
    below_floor: actionFloorBelow(floorAt ?? ''),
    zoneless_floor: ACTION_FLOOR_ZONELESS,
    floor_unknown: ACTION_FLOOR_UNKNOWN,
    invalid_floor: ACTION_FLOOR_INVALID,
    future_floor: ACTION_FLOOR_FUTURE,
    not_applicable: ACTION_FLOOR_NOT_APPLICABLE,
  };

  return {
    verdict,
    basis,
    floorAt,
    floorRaw,
    floorRow: basis === 'ledger' ? ledger.row : null,
    floorDate: basis === 'ledger' ? ledger.date : null,
    zoneless,
    restorePoint: rpIso,
    retentionHours: retention,
    configuredWindowStart,
    effectiveWindowStart,
    narrowedByHours,
    recoverable,
    ambiguous,
    skipped: ledger.skipped,
    action: action[verdict],
    caveats,
  };
}

/** 판정 + 정본 + 사각지대 + 사각지대 목록을 함께 — 명령·보고가 같은 경로를 쓴다 */
export function branchFloorStatus(args: {
  restorePoint?: unknown;
  floorAt?: unknown;
  rows?: readonly LedgerRow[];
  retentionHours?: number | null;
  now?: Date;
}): FloorAssessment & {
  sources: readonly FloorSource[];
  misreads: readonly FloorMisread[];
  blindSpots: readonly FloorBlindSpot[];
  limits: readonly string[];
  ref: string;
} {
  return {
    ...assessBranchFloor(args),
    sources: FLOOR_SOURCES,
    misreads: FLOOR_MISREADS,
    blindSpots: FLOOR_BLIND_SPOTS,
    limits: FLOOR_LIMITS,
    ref: FLOOR_RUNBOOK_REF,
  };
}

/* ───────────────────── §3-6 산출과 합쳐 내보낸다 ───────────────────── */

export interface WindowWithFloor {
  /** §3-6 산출 결과 그대로 */
  window: RestorePointPlan & { limits: readonly string[]; epsilonRules: readonly string[] };
  floor: FloorAssessment;
  /**
   * 두 판정을 합친 결론 — **둘 다 통과해야** 그 시점으로 브랜치를 만들 수 있다.
   * 어느 한쪽이 보류면 null(「만들 수 있다」로 올리지 않는다).
   */
  canCreate: boolean | null;
  action: string | null;
}

/**
 * §3-21 의 1줄 명령이 호출하는 자리 — §3-6 산출을 그대로 돌리고 **하한 판정을 더한다.**
 * 판정만 하고 버리지 않는다: `canCreate` 가 두 판정의 결론이고, `action` 은 **막는 쪽**의 것이다.
 */
export function recoveryWindowWithFloor(args: {
  damageAt: unknown;
  epsilonMinutes?: unknown;
  now?: Date;
  env?: Record<string, string | undefined>;
  floorAt?: unknown;
  rows?: readonly LedgerRow[];
}): WindowWithFloor {
  const window = restorePointStatus({
    damageAt: args.damageAt,
    epsilonMinutes: args.epsilonMinutes,
    now: args.now,
    env: args.env,
  });
  const floor = assessBranchFloor({
    restorePoint: window.restorePoint,
    floorAt: args.floorAt,
    rows: args.rows,
    retentionHours: window.retentionHours,
    now: args.now,
  });

  // 설정 창 판정이 막으면 그쪽이 결론이다. 통과했어도 하한이 막거나 **보류면** 올리지 않는다.
  const windowOk = window.verdict === 'ok' ? true : window.verdict === 'expired' ? false : null;
  const canCreate = windowOk === false || floor.recoverable === false ? false : windowOk === true && floor.recoverable === true ? true : null;
  const action = floor.recoverable === false ? floor.action : windowOk === true ? floor.action : window.action;

  return { window, floor, canCreate, action };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄 — 판정·시각·수치만(자격증명·호스트·행 수 없음) */
export function floorLine(a: FloorAssessment): string {
  const parts = [`verdict=${a.verdict}`, `basis=${a.basis}`];
  if (a.floorAt) parts.push(`floor=${a.floorAt}`);
  if (a.floorRow !== null) parts.push(`row=${a.floorRow}`);
  if (a.effectiveWindowStart) parts.push(`effective_start=${a.effectiveWindowStart}`);
  if (a.narrowedByHours !== null) parts.push(`narrowed_h=${a.narrowedByHours}`);
  if (a.recoverable !== null) parts.push(`recoverable=${a.recoverable}`);
  if (a.ambiguous) parts.push('ambiguous=true');
  return `[branch-floor] ${parts.join(' ')}`;
}

/** 사람이 읽을 요약 — 한 문단 */
export function floorText(a: FloorAssessment): string {
  const parts: string[] = [`분기 시점 하한 판정 = ${a.verdict}`];
  if (a.floorAt) parts.push(`하한 ${a.floorAt}${a.basis === 'ledger' ? `(§6 표 ${a.floorRow}행)` : '(넘겨받은 값)'}`);
  else parts.push('하한을 모른다');
  if (a.effectiveWindowStart) parts.push(`고를 수 있는 가장 이른 시점 ${a.effectiveWindowStart}`);
  if (a.narrowedByHours !== null) parts.push(`설정 창보다 약 ${a.narrowedByHours}시간 좁다`);
  if (a.verdict === 'below_floor') parts.push('※ 이 복구 시점으로는 **브랜치를 만들 수 없다**');
  if (a.recoverable === null) parts.push('※ 판정 보류 — 통과가 아니다');
  const text = `${parts.join('. ')}.`;
  return a.action ? `${text}\n→ ${a.action}` : text;
}

/** §3-21 1줄 명령의 출력 — §3-6 문단 + 하한 문단 */
export function windowWithFloorText(r: WindowWithFloor): string {
  const head = restorePointText(r.window);
  const tail = floorText(r.floor);
  const verdict = r.canCreate === null ? '판정 보류(통과가 아니다)' : r.canCreate ? '만들 수 있다' : '만들 수 없다';
  return `${head}\n\n${tail}\n\n[두 하한을 합친 결론] ${verdict}`;
}

/**
 * 공개 필터 — **시각 좌표를 담지 않는다.** 분기 시점·복구 시점·창 하한은 그 구간의 쓰기를
 * 노리는 데 쓰일 수 있는 값이라(§2-3) 무인증으로 나갈 수 있는 모양에는 넣지 않는다.
 */
export function publicBranchFloor(a: FloorAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    basis: a.basis,
    recoverable: a.recoverable,
    narrowedByHours: a.narrowedByHours,
    zoneless: a.zoneless,
    ambiguous: a.ambiguous,
    skippedRows: a.skipped.length,
    ref: FLOOR_RUNBOOK_REF,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 사유 없는 선언을 두지 않는다 */
export function auditFloorCanon(
  sources: readonly FloorSource[] = FLOOR_SOURCES,
  misreads: readonly FloorMisread[] = FLOOR_MISREADS,
  blindSpots: readonly FloorBlindSpot[] = FLOOR_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (sources.length === 0) problems.push('하한의 자리가 정본에서 사라졌다');
  for (const s of sources) {
    if (!s.what.trim() || !s.where.trim() || !s.lostWhen.trim()) problems.push(`하한 자리 ${s.key} 에 빈 칸이 있다`);
  }
  if (!sources.some((s) => s.durable && s.readableByCode)) {
    problems.push('코드가 읽을 수 있는 **영구** 기록이 정본에서 사라졌다 — 그러면 하한은 사건 중에만 알 수 있다');
  }
  if (!sources.some((s) => !s.readableByCode)) {
    problems.push('코드가 보지 못하는 정본(Neon 콘솔)이 목록에서 사라졌다 — 판정이 콘솔을 대체한다고 말하게 된다');
  }
  const marker = sources.find((s) => s.key === 'restore_point_marker');
  if (marker && marker.durable) {
    problems.push('`RECOVERY_RESTORE_POINT` 를 영구 기록으로 적어 두었다 — 8단계 4번이 지우라고 지시하는 표지다');
  }
  const keys = new Set<string>();
  for (const m of misreads) {
    if (!m.key.trim() || !m.judgement.trim() || !m.says.trim() || !m.why.trim()) problems.push(`거짓 판정 ${m.key} 에 빈 칸이 있다`);
    if (keys.has(m.key)) problems.push(`거짓 판정 키가 겹친다: ${m.key}`);
    keys.add(m.key);
  }
  if (!misreads.some((m) => m.key === 'marker_is_not_the_floor')) {
    problems.push('`marker_is_not_the_floor`(사건 중의 표지를 하한으로 읽는다)가 목록에서 사라졌다 — 자기 자신과 비교하는 길이 다시 열린다');
  }
  for (const b of blindSpots) {
    if (!b.what.trim() || !b.why.trim()) problems.push(`사각지대 ${b.key} 에 빈 칸이 있다`);
  }
  return problems;
}

/**
 * 이 모듈이 **순수한지**와 판독을 **복제하지 않았는지**. 복제하면 갈라진 쪽이 아무 응답도
 * 바꾸지 않으므로 영구히 남는다(§3-20 `auditSelfSource` 와 같은 규율).
 */
export function auditSelfSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  // 접근만 잡는다 — 머리말의 「`process.env` 미접근」 서술을 위반으로 세지 않는다(§3-20 과 같은 규칙).
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다 — 하한은 env 에 없다(사건 중의 표지는 이번 복구 시점이다)');
  if (/from\s+['"]\.\/(db|migrate)/.test(s)) problems.push('DB 모듈을 import 한다 — 신규 조회 0 이어야 한다');
  if (/from\s+['"]next/.test(s) || /from\s+['"]node:fs['"]/.test(s)) problems.push('next·fs 를 import 한다 — 순수 모듈이 아니다');
  if (!/from\s+['"]\.\/restorePointRecord\.ts['"]/.test(s)) {
    problems.push('§6-7 판독(`parseRecordedInstant`)을 재사용하지 않는다 — 표 칸 판독 규칙이 갈라진다');
  }
  if (!/from\s+['"]\.\/rehearsalKind\.ts['"]/.test(s)) {
    problems.push('§6-6 유형 판독(`kindState`)을 재사용하지 않는다 — 연습·사건 구분이 갈라진다');
  }
  if (!/from\s+['"]\.\/recoveryWindow\.ts['"]/.test(s)) {
    problems.push('§3-6 산출을 재사용하지 않는다 — 두 하한이 서로 다른 창을 말하게 된다');
  }
  return problems;
}

/** **신규 env 0** — 이 모듈은 env 키를 하나도 읽지 않는다(§3-6 산출로 통과만 시킨다) */
export function auditNoNewEnv(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다');
  if (/\benv\.[A-Z][A-Z0-9_]+/.test(s)) problems.push('env 키를 직접 읽는다 — 하한은 env 에 없다');
  if (/\benv\[['"]/.test(s)) problems.push('env 키를 간접으로 읽는다 — 하한은 env 에 없다');
  return problems;
}

/**
 * **신규 런타임 체크 0** — 하한의 유일한 영구 기록이 저장소 문서(§6 표)이고 런타임은 그것을
 * 읽지 않는다. `/api/health` 에 실으면 전 배포가 상시 `floor_unknown` 만 내보낸다(§2-2).
 */
export function auditNoNewHealthCheck(healthSrc: unknown): string[] {
  const s = String(healthSrc ?? '');
  return /branchFloor/.test(s)
    ? ['`/api/health` 가 분기 시점 판정을 싣고 있다 — 런타임은 §6 표를 읽지 않으므로 그 응답은 늘 판정 보류다(§3-21 은 저장소 명령·CI 로만 판정한다)']
    : [];
}

/**
 * §3-6 쪽이 **여전히 하한을 하나로만 세는지**(= 이 절이 필요한 이유가 그대로인지)와,
 * 그 사실을 **사각지대로 선언해 두고 있는지**. 선언이 사라지면 어디에도 적혀 있지 않게 된다.
 */
export function auditWindowSource(windowSrc: unknown): string[] {
  const s = String(windowSrc ?? '');
  const problems: string[] = [];
  if (!/nowMs\s*-\s*retention\s*\*\s*MS_HOUR/.test(s)) {
    problems.push('§3-6 의 창 하한 계산이 바뀌었다 — 하한을 두 개로 세게 되었다면 이 절(§3-21)과 함께 볼 것');
  }
  if (!/자식 브랜치는 분기 시점보다 이전으로 갈 수 없/.test(s)) {
    problems.push('§3-6 `WINDOW_LIMITS` 에서 분기 시점 사각지대 선언이 사라졌다 — 한계가 어디에도 적혀 있지 않게 된다');
  }
  return problems;
}

/** 실제 `RUNBOOK.md` 점검 — 절·명령·판정 표·유도가 남아 있는지 */
export function auditRunbookFloor(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*3-21\./m.test(s)) problems.push('RUNBOOK 에 §3-21 소절이 없다 — 판정의 근거 절이 사라졌다');
  for (const v of FLOOR_VERDICTS) {
    if (!s.includes(`\`${v}\``)) problems.push(`§3-21 판정 표에 \`${v}\` 가 없다`);
  }
  for (const m of FLOOR_MISREADS) {
    if (!s.includes(`\`${m.key}\``)) problems.push(`§3-21 이 거짓이 되는 판정 \`${m.key}\` 를 적지 않는다`);
  }
  if (!/recoveryWindowWithFloor\(/.test(s)) problems.push('§3-21 에 산출 명령이 없다 — 판정에 닿을 수단이 문서에 없다');

  const start = s.indexOf('## 3. DB 복구 절차');
  const end = s.indexOf('### 3-1.');
  const sec3 = start >= 0 && end > start ? s.slice(start, end) : '';
  if (!sec3) problems.push('§3 본문을 찾을 수 없다');
  else if (!sec3.includes('3-21')) {
    problems.push('§3 3단계가 3-21 로 유도하지 않는다 — 복구를 거친 DB 의 하한을 보라고 말하는 자리가 없어진다');
  }

  const s6 = s.indexOf('### 3-6.');
  const s7 = s.indexOf('### 3-7.');
  const sec6 = s6 >= 0 && s7 > s6 ? s.slice(s6, s7) : '';
  if (!sec6) problems.push('§3-6 절을 찾을 수 없다');
  else if (!sec6.includes('3-21')) {
    problems.push('§3-6 이 3-21 로 유도하지 않는다 — `ok`·`deadline` 을 그대로 믿는 길이 다시 열린다');
  }
  return problems;
}
