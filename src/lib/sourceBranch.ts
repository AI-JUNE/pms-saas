/**
 * sourceBranch.ts — 전환 뒤 남는 **원본(손상) 브랜치**의 처분(RUNBOOK §3-18·§3 5단계). 2026-10-28
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 3단계는 「Neon에서 시점 T-ε 로 *새 브랜치*를 만든다(**운영 브랜치는 그대로 둔다**)」고
 * 지시하고, 5단계는 운영 `DATABASE_URL` 을 그 새 브랜치로 **교체**한다. 그래서 전환이 끝난
 * 순간 DB 는 **두 벌**이다 — 서비스가 보는 복구 브랜치와, 아무도 보지 않는 **원본**.
 * 그런데 절차는 그 원본을 **다시 가리키지 않는다.** 8단계가 지시하는 네 가지는 전부 env 표지와
 * 6절 표에 대한 것이고, §3-17 이 처분을 정한 것은 **DB 밖으로 내보낸 사본**이다. 그 결과
 *
 *  (1) **「유실」이라 고지한 행이 아직 읽을 수 있는 곳에 있다.** 8단계 2번은 구간
 *      (`RECOVERY_RESTORE_POINT` ~ `RECOVERY_WRITE_FREEZE_AT`)을 **되돌릴 수 없는 대외 고지**로
 *      내보내는데, 그 구간에 들어온 쓰기는 **원본 브랜치의 현재 상태**다(PITR 도 필요 없다 —
 *      조회로 닿는다). 고지 전에 「꺼낼 수 있는지」를 보라고 지시하는 자리가 없어서, 꺼내면
 *      되찾을 수 있는 데이터도 **「유실」로 확정**되고 그 문장은 회수할 수 없다.
 *
 *  (2) **꺼낼 범위를 말해 주는 두 값을 8단계 4번이 지운다.** 구간의 두 끝은 §3-10 이 승격한
 *      표지 둘이고, 8단계 4번은 그것을 **여섯 키 전건**과 함께 지우라고 지시한다. 그 지시는
 *      §3-14 때문에 **옳다** — 남기면 다음 사건이 물려받는다. 그래서 지우는 것이 맞고,
 *      지운 뒤에는 **원본에서 무엇을 꺼내야 하는지 말할 수 있는 값이 없다.**
 *
 *  (3) **원본은 전 테넌트 데이터 한 벌이고, 쓰기가 가능한 상태로 남는다.** 전환은 **이 배포의
 *      연결 문자열**만 바꾼다 — 다른 스코프·다른 배포·직접 접속이 쥔 옛 문자열은 그대로
 *      동작하므로(§3-13·`FREEZE_LIMITS`), 전환 뒤 그 경로로 들어온 쓰기는 **사용자에게는 저장된
 *      것처럼 보이고 운영에는 없다.** 탈퇴·파기도 그 브랜치에는 닿지 않는다.
 *
 *  (4) **그러면서도 어떤 응답도 원본을 말하지 않는다.** 전환 뒤 `checks.dbIdentity` 는 복구
 *      브랜치를 보고 `match` 를 낸다 — 「어느 DB 를 보도록 설정됐는가」까지만 말하므로
 *      **또 한 벌이 남아 있다는 사실**은 어디에도 나오지 않는다. 리허설도 같다: 체크리스트의
 *      마지막 항목은 「리허설 브랜치 정리」인데 **어느 브랜치인지 적혀 있지 않다** — 사건에서
 *      그 문구를 그대로 읽으면 유일본을 들고 있는 쪽을 지우게 된다.
 *
 * 그래서 이 모듈은 — **브랜치를 코드가 다룰 수는 없으므로** — 표지가 아직 있는 동안
 *   · 원본에만 남는 것과 그것을 지울 때 영구히 사라지는 것을 정본으로 두고,
 *   · 고지(8단계 2번) **전에** 「꺼낼 범위를 말할 수 있는가」를 판정으로 내보내고,
 *   · 표지 삭제(8단계 4번) **전에** 좌표와 처분을 영구 기록으로 옮기라고 말한다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 조회·쓰기·DDL 0 · 신규 런타임 체크 0 ·
 *   신규 표지 0 · 신규 env 0.** 좌표는 §3-10 이 이미 승격한 두 표지를 그대로 읽는다.
 * - 같은 국면을 `checks.lossNotice` 가 이미 보고하므로 **그 자리에서** 말한다 — 고지가 그
 *   체크의 주제이고, 이 판정이 쓸모 있는 시점(고지 전·표지 삭제 전)도 같다.
 * - **`state`·`ok` 를 바꾸지 않는다.** 브랜치의 존재·처분은 코드가 확인할 수 없고, 미처분으로
 *   `ok` 를 내리면 복구일에 거짓 차단이 된다 — 달라지는 것은 **다음에 할 일**이다.
 * - **구분할 수 없는 것을 구분하지 않는다**: 제자리 복구(원본이 남지 않는다)와 브랜치 전환을
 *   가려낼 수단이 없다(§3-4 `IDENTITY_LIMITS` — 제자리 복구는 지문이 바뀌지 않는다).
 *   그래서 이 판정은 「원본이 있다」고 말하지 않고 **「있다면 그것이 유일본이다」**까지만 말한다.
 */
import { assessLossWindow, type LossWindow } from './incidentClosure.ts';
import { parseInstant } from './incidentEvidence.ts';
import { ANCHOR_ENV, assessTimeline, markerCorroboration, type CorroborationBasis } from './incidentTimeline.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const SOURCE_RUNBOOK_REF = 'RUNBOOK §3-18·§3 5단계';

/**
 * 구간의 두 끝 — **§3-10 이 이미 승격한 표지**를 그대로 읽는다. 새 표지를 만들지 않는 이유:
 * 표지가 늘면 8단계 4번에서 지울 것이 늘고, 하나만 남아도 다음 사건이 물려받는다(§3-14).
 *
 * ※ 키를 **리터럴로** 읽는다(`envRegistry.scanEnvReads` 가 상수 경유 접근을 잡지 못한다).
 *   이름이 `lib/lossNotice.ts` 의 선언과 갈리면 `auditKeyAgreement` 가 CI 로 잡는다.
 */
export const RANGE_START_ENV = 'RECOVERY_RESTORE_POINT';
export const RANGE_END_ENV = 'RECOVERY_WRITE_FREEZE_AT';
export const NOTICE_ENV = 'RECOVERY_LOSS_NOTICE_AT';

/* ──────────────────── 원본 브랜치에만 남는 것(정본) ──────────────────── */

export interface SourceHolding {
  key: string;
  /** 무엇이 거기에 있는가 */
  what: string;
  /** 다른 어디에도 없는가 — **전건 true 가 이 장치의 전제다** */
  onlyCopy: true;
  /** 브랜치가 살아 있는 동안 **조회로** 닿는가(PITR 없이) */
  readableNow: boolean;
  /** 지우면 영구히 사라지는 것 */
  lostOnDelete: string;
}

/**
 * 전환 뒤 원본 브랜치에만 남는 것. 복구 브랜치는 **T-ε 이전** 상태이고, §3-5 사본은
 * **변경 이력**이라(값 원문은 `lib/audit.ts` 의 설계상 담기지 않는다) 셋 다 대신하지 못한다.
 */
export const SOURCE_HOLDINGS: readonly SourceHolding[] = [
  {
    key: 'loss_window_rows',
    what: `유실 구간(${RANGE_START_ENV} ~ ${RANGE_END_ENV})에 들어온 쓰기 — 8단계 2번이 **「유실」이라 고지하는 바로 그 행들**`,
    onlyCopy: true,
    // 과거 시점이 아니라 **그 브랜치의 현재 상태**다 — 조회로 닿는다.
    readableNow: true,
    lostOnDelete:
      '고지한 구간의 데이터가 **실제로** 복구 불가능해진다 — 고지문의 「유실」이 그 순간 사실이 되고, 되찾을 경로는 남지 않는다',
  },
  {
    key: 'damaged_state',
    what: '손상 **그 자체**(변조·삭제된 행의 실제 값). 복구 브랜치는 T-ε 이전이고, §3-5 사본은 변경 **이력**이라 값 원문이 없다',
    onlyCopy: true,
    readableNow: true,
    lostOnDelete:
      '사후 조사에서 **무엇이 어떻게 바뀌었는지** 대조할 상대가 없어진다 — 감사 경로 밖(직접 SQL·제공자 콘솔)에서 일어난 변경은 §3-5 사본에도 흔적이 없다',
  },
  {
    key: 'straggler_writes',
    what: '전환 **뒤** 옛 연결 문자열로 들어온 쓰기(다른 스코프·다른 배포·직접 접속 — §3-13·`FREEZE_LIMITS`)',
    onlyCopy: true,
    readableNow: true,
    lostOnDelete:
      '사용자에게는 **저장된 것처럼 보였던** 작업이 사라진다 — 운영에는 애초에 없었으므로 어느 응답에도 그 차이가 나오지 않는다',
  },
];

/* ──────────────────── 드러나지 않는 이유(사각지대) ──────────────────── */

export interface SourceBlindSpot {
  key: string;
  /** 무엇이 보이지 않는가 */
  what: string;
  /** 왜 어떤 판정도 그것을 말하지 못하는가 */
  why: string;
}

export const SOURCE_BLIND_SPOTS: readonly SourceBlindSpot[] = [
  {
    key: 'branch_invisible',
    what: '원본 브랜치가 **아직 있는지** 자체',
    why: '브랜치 목록은 Neon 콘솔에 있다 — 저장소·DB·env 어디에도 그 사실이 없다. 이 판정이 보는 것은 「절차대로라면 남아 있다」까지다',
  },
  {
    key: 'path_unknown',
    what: '**제자리 복구**였는지 브랜치 전환이었는지',
    why: '제자리 복구는 원본을 남기지 않는데 엔드포인트가 그대로여서 지문이 바뀌지 않는다(§3-4 `IDENTITY_LIMITS`) — 두 경로를 가려낼 수단이 없으므로 「있다면 유일본이다」까지만 말한다',
  },
  {
    key: 'coordinates_cleared',
    what: '**무엇을 꺼내야 하는가**(구간의 두 끝)',
    why: `8단계 4번이 ${RANGE_START_ENV}·${RANGE_END_ENV} 를 지우라고 지시한다(§3-14 때문에 옳다) — 지운 뒤에는 범위를 다시 산출할 수 없고, 브랜치가 남아 있어도 꺼낼 대상을 말할 수 없다`,
  },
  {
    key: 'damage_took_the_rows',
    what: '그 구간의 행이 **원본에도 남아 있는지**',
    why: '손상이 바로 그 구간의 행을 지운 경우(대량 삭제) 원본의 현재 상태에도 없다 — 그때는 원본 브랜치를 **다시** PITR 해야 하고 그 창의 하한은 시간과 함께 전진한다(§3-6)',
  },
  {
    key: 'erasure_gap',
    what: '원본 안의 **탈퇴·파기 대상**',
    why: '서비스 DB 의 삭제는 전환으로 떨어져 나간 브랜치에 닿지 않는다 — 전 테넌트 데이터 한 벌이 그대로 남아 있고, 그 사실은 어느 응답에도 나오지 않는다(§3-17 `erasure_gap` 과 같은 구멍이지만 대상이 **DB 한 벌**이다)',
  },
  {
    key: 'rehearsal_conflated',
    what: '체크리스트의 「브랜치 정리」가 **어느 브랜치**인가',
    why: '리허설에서는 정리 대상이 리허설(복구) 브랜치이고, 사건에서는 남는 것이 **유일본을 든 원본**이다 — 같은 문구를 사건에서 그대로 읽으면 지울 수 없는 쪽을 지운다',
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const SOURCE_VERDICTS = [
  /** 평상시 — 표지가 없다(복구 중이 아니다) */
  'not_applicable',
  /** 좌표·고지 기록을 읽을 수 없다 */
  'invalid_record',
  /** 고지 기록이 **지난 사건**의 것이다(§3-14) — 이번 고지는 아직 나가지 않았다 */
  'carried_basis',
  /** 구간의 두 끝 중 하나를 몰라 **꺼낼 범위를 말할 수 없다** */
  'range_unknown',
  /** 범위는 확정됐고 고지는 아직이다 — **지금이 꺼낼지 판단할 자리다** */
  'extractable',
  /** 되돌릴 수 없는 고지가 나갔다 — 남은 일은 **원본의 처분 확정**이다 */
  'declared_lost',
] as const;
export type SourceVerdict = (typeof SOURCE_VERDICTS)[number];

export const ACTION_SOURCE_NONE =
  `평상시 — 표지가 없어 이 배포의 env 는 원본 브랜치를 말하지 않는다. 지난 사건·리허설이 남긴 ` +
  '브랜치는 6절 표 비고에 적어 둔 **처분**으로만 추적된다(§3-18)';

export const ACTION_SOURCE_INVALID =
  `구간의 두 끝(\`${RANGE_START_ENV}\`·\`${RANGE_END_ENV}\`)·고지 시각 중 읽을 수 없는 값이 있다 — ` +
  '타임존을 붙인 ISO 시각으로 다시 적는다. 못 읽는 값으로 꺼낼 범위를 추정하지 않는다';

export const ACTION_SOURCE_CARRIED =
  `\`${NOTICE_ENV}\` 가 이번 차단보다 **앞선** 값이다(§3-14) — 이번 고지는 아직 나가지 않았다. ` +
  '원본은 여전히 유실 구간의 유일본을 들고 있으므로, 값을 고친 뒤 **고지 전에** 꺼낼지 판단한다';

export const ACTION_SOURCE_RANGE_UNKNOWN =
  '유실 구간의 두 끝 중 하나가 기록되지 않아 **원본에서 무엇을 꺼내야 하는지 말할 수 없다** — ' +
  `시작은 3단계의 T-ε 을 \`${RANGE_START_ENV}\` 에, 끝은 차단이 실효된 시각을 \`${RANGE_END_ENV}\` 에 ` +
  '적는다(§3-10). 범위를 모르는 상태로 「유실」을 고지하면, 꺼낼 수 있었던 데이터까지 확정된다';

export const ACTION_SOURCE_EXTRACTABLE =
  '**고지 전이다** — 고지할 구간의 행은 원본 브랜치의 **현재 상태**로 남아 있다(조회로 닿는다). ' +
  '꺼낼지 판단하고(쓰기는 사람이 한다 — 자동화하지 않았다), 꺼내지 않기로 하면 **그 사실을** ' +
  '고지문과 6절 표 비고에 적는다. 판단을 미루면 8단계 4번이 좌표를 지워 범위를 말할 수 없게 된다';

export const ACTION_SOURCE_DECLARED =
  '되돌릴 수 없는 고지가 나갔다 — 남은 일은 원본의 **처분을 한쪽으로 확정**하는 것이다(§3-12 가 ' +
  '기준 지문에 둔 것과 같은 규율). **남긴다**(조사·유실분 추출 대비)면 6절 표 비고에 「원본 브랜치 ' +
  '보존」과 **구간의 두 끝**을 적고 보관 기한을 함께 정한다 — 전 테넌트 데이터 한 벌이고 탈퇴·파기가 ' +
  '닿지 않는다. **지운다**면 지운 사실을 적는다 — 그 순간 고지문의 「유실」이 사실이 된다. ' +
  '어느 쪽이든 **표지를 지우기 전에** 적는다';

const ACTION: Record<SourceVerdict, string> = {
  not_applicable: ACTION_SOURCE_NONE,
  invalid_record: ACTION_SOURCE_INVALID,
  carried_basis: ACTION_SOURCE_CARRIED,
  range_unknown: ACTION_SOURCE_RANGE_UNKNOWN,
  extractable: ACTION_SOURCE_EXTRACTABLE,
  declared_lost: ACTION_SOURCE_DECLARED,
};

const NOTE: Record<SourceVerdict, string> = {
  not_applicable: '표지가 없다 — 이 배포의 env 는 원본 브랜치의 국면을 말하지 않는다(`branch_invisible`)',
  invalid_record: '좌표·고지 기록 중 읽을 수 없는 값이 있다 — 「없다」로 세지 않는다',
  carried_basis: '고지 기록이 지난 사건의 표지다 — 이번 고지로 읽으면 판단할 자리를 건너뛴다',
  range_unknown: '구간이 확정되지 않아 꺼낼 범위를 말할 수 없다(`coordinates_cleared` 와 같은 결과다)',
  extractable: '고지 전이고 범위가 확정됐다 — 원본이 남아 있다면 그것이 유일본이다',
  declared_lost: '고지가 나갔다 — 원본의 처분을 확정하지 않으면 전 테넌트 데이터 한 벌이 무기한 남는다',
};

export const CAVEAT_SOURCE_EXISTENCE_UNKNOWN =
  '**원본이 있는지 코드가 확인하지 않는다** — 브랜치 목록은 Neon 콘솔에 있고, 제자리 복구였다면 애초에 남지 않는다. ' +
  '이 판정은 「있다면 그것이 유실 구간의 유일본이다」까지만 말한다';

export const CAVEAT_SOURCE_NOT_A_RECOVERY =
  '**꺼낼 수 있다 ≠ 되돌릴 수 있다** — 원본의 행을 운영에 되넣는 것은 두 DB 의 상태를 사람이 판단해 합치는 일이고, ' +
  '복구 뒤 쌓인 쓰기와 충돌한다. 코드는 추출·병합을 하지 않는다(쓰기 0)';

export const CAVEAT_SOURCE_COORDINATES_EPHEMERAL =
  `꺼낼 범위를 말해 주는 두 값(\`${RANGE_START_ENV}\`·\`${RANGE_END_ENV}\`)은 8단계 4번에서 ` +
  '**지우라고 지시된 표지**다 — 영구 기록(6절 표)으로 옮기는 것이 유일한 수단이다';

export const SOURCE_LIMITS: readonly string[] = [
  CAVEAT_SOURCE_EXISTENCE_UNKNOWN,
  CAVEAT_SOURCE_NOT_A_RECOVERY,
  CAVEAT_SOURCE_COORDINATES_EPHEMERAL,
  '처분을 **했는지**도 확인하지 않는다 — 브랜치를 지우거나 남긴 사실은 6절 표 비고에만 남고, 그 칸을 읽는 코드는 없다',
  '전환 뒤 옛 연결 문자열로 들어온 쓰기를 **세지 않는다** — 이 배포의 env 만 보므로 다른 스코프·다른 배포는 보이지 않는다(§3-13)',
  '손상이 그 구간의 행 자체를 지웠다면 원본에도 없다 — 그때는 원본을 **다시** PITR 해야 하고 그 창은 전진한다(§3-6)',
  '원본이 남아도 `/api/health` 는 **degraded 로도 바뀌지 않는다** — 새 체크를 만들지 않았다(§3-18)',
];

export interface SourceAssessment {
  verdict: SourceVerdict;
  /** §3-7 의 구간 판정을 그대로 쓴다 — 수치를 다시 만들지 않는다 */
  window: LossWindow;
  /** 꺼낼 범위를 말할 수 있는가(= 두 끝을 안다) */
  rangeKnown: boolean;
  /** 되돌릴 수 없는 고지가 이미 나갔는가 */
  claimFinal: boolean;
  /** 고지 기록이 **이번 사건**의 것이라고 말할 수 있는가(§3-14) */
  noticeBasis: CorroborationBasis;
  /** 원본에만 남는 것의 수 / 그중 조회로 닿는 것의 수 */
  holdings: number;
  readableHoldings: number;
  /** 처분·추출 판단을 **지금** 해야 하는가(표지가 지워지기 전) */
  decisionDue: boolean;
  /** 지금 할 일이 있는가 — 읽는 쪽이 조건식을 다시 짜면 판정이 두 곳에서 갈린다 */
  actionable: boolean;
  action: string;
  note: string;
  caveats: readonly string[];
}

/**
 * 원본 브랜치 국면의 판정.
 *
 * 판정 순서: **못 읽는 값** → 표지 없음(평상시) → 고지 기록의 **귀속** → 구간 확정 →
 * 고지 여부.
 *
 * 순서를 바꾸면 (가) 판독 불가한 좌표가 `range_unknown`(= 「적으면 된다」)으로 덮여 **이미
 * 적어 둔 값이 잘못 적혔다는 사실**이 사라지고, (나) 지난 사건이 남긴 고지 시각이
 * `declared_lost` 로 읽혀 **아직 나가지 않은 고지를 「나갔다」로** 보고하면서 추출 판단의
 * 자리를 건너뛴다(그 상태로 표지를 지우면 범위도 함께 사라진다).
 */
export function assessSourceBranch(input?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): SourceAssessment {
  const env = input?.env ?? {};
  const startRaw = (env.RECOVERY_RESTORE_POINT ?? '').trim();
  const endRaw = (env.RECOVERY_WRITE_FREEZE_AT ?? '').trim();
  const noticeRaw = (env.RECOVERY_LOSS_NOTICE_AT ?? '').trim();

  const window = assessLossWindow({ restorePoint: startRaw || undefined, frozenAt: endRaw || undefined, now: input?.now });
  const noticeAt = noticeRaw ? parseInstant(noticeRaw) : null;
  const noticeBasis = markerCorroboration(NOTICE_ENV, assessTimeline({ env })).basis;

  const rangeKnown = window.verdict === 'ok';
  const claimFinal = Boolean(noticeAt);
  // **들어 있는데 못 읽는 값**만 판독 실패다 — §3-7 의 `invalid_restore_point` 는 미기록과
  // 판독 불가를 한 판정으로 묶으므로(둘 다 「시작을 모른다」다) 그것으로 가르면 적지 않은
  // 좌표가 「잘못 적혔다」로 보고된다. 할 일이 다르다(적는다 / 고쳐 적는다).
  const unreadable = [
    [startRaw, parseInstant(startRaw)],
    [endRaw, parseInstant(endRaw)],
    [noticeRaw, noticeAt],
  ].some(([raw, parsed]) => Boolean(raw) && !parsed);

  let verdict: SourceVerdict;
  if (unreadable) verdict = 'invalid_record';
  else if (!startRaw && !endRaw && !noticeRaw) verdict = 'not_applicable';
  else if (noticeAt && noticeBasis === 'carried_over') verdict = 'carried_basis';
  else if (!rangeKnown) verdict = 'range_unknown';
  else if (claimFinal) verdict = 'declared_lost';
  else verdict = 'extractable';

  return {
    verdict,
    window,
    rangeKnown,
    // 지난 사건의 표지로 「고지가 나갔다」고 말하지 않는다.
    claimFinal: verdict === 'carried_basis' ? false : claimFinal,
    noticeBasis,
    holdings: SOURCE_HOLDINGS.length,
    readableHoldings: SOURCE_HOLDINGS.filter((h) => h.readableNow).length,
    decisionDue: verdict !== 'not_applicable',
    // `not_applicable` 은 평상시 상태다 — 할 일로 올리면 상시 떠 있는 문구가 되어
    // 정작 판단할 자리가 있는 국면의 할 일을 덮는다(§3-17 과 같은 규율).
    actionable: verdict !== 'not_applicable',
    action: ACTION[verdict],
    note: NOTE[verdict],
    caveats: SOURCE_LIMITS,
  };
}

/** env 스냅샷으로 판정한다(라우트·명령에서 같은 경로를 쓴다) */
export function sourceFromEnv(env: Record<string, string | undefined> = {}, now?: Date): SourceAssessment {
  return assessSourceBranch({ env, now });
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·boolean·개수만 — **시각은 담지 않는다** */
export function sourceLine(a: SourceAssessment): string {
  return [
    'recovery_source_branch',
    `source=${a.verdict}`,
    `range=${a.rangeKnown ? 'known' : 'unknown'}`,
    `notice=${a.claimFinal ? 'sent' : 'absent'}`,
    `holdings=${a.holdings}`,
  ].join(' ');
}

/** 사람이 읽는 요약(§3-18 의 1줄 명령이 출력하는 것) — **여기에만** 좌표가 나온다 */
export function sourceText(a: SourceAssessment): string {
  const lines = [
    `[${a.verdict}] 유실 구간 ${a.window.startsAt ?? '(미기록)'} ~ ${a.window.endsAt ?? '(미기록)'} · 고지 ${a.claimFinal ? '기록됨' : '미기록'}`,
    `· 원본에만 남는 것 ${a.holdings}건(조회로 닿는 것 ${a.readableHoldings}건) — 전건 **유일본**`,
    `· 드러나지 않는 것 ${SOURCE_BLIND_SPOTS.length}건`,
  ];
  for (const h of SOURCE_HOLDINGS) lines.push(`  - ${h.key}: 지우면 → ${h.lostOnDelete}`);
  lines.push(`→ ${a.action}`);
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/** 공개 응답용 필터 — **시각·좌표를 노출하지 않는다**(§2-3) */
export function publicSourceBranch(a: SourceAssessment): {
  verdict: SourceVerdict;
  rangeKnown: boolean;
  claimFinal: boolean;
  holdings: number;
  runbook: string;
} {
  return {
    verdict: a.verdict,
    rangeKnown: a.rangeKnown,
    claimFinal: a.claimFinal,
    holdings: a.holdings,
    runbook: SOURCE_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function sourceBranchStatus(
  env: Record<string, string | undefined> = {},
  now?: Date,
): {
  verdict: SourceVerdict;
  rangeKnown: boolean;
  holdings: number;
  blindSpots: number;
  limits: number;
  action: string;
} {
  const a = sourceFromEnv(env, now);
  return {
    verdict: a.verdict,
    rangeKnown: a.rangeKnown,
    holdings: SOURCE_HOLDINGS.length,
    blindSpots: SOURCE_BLIND_SPOTS.length,
    limits: SOURCE_LIMITS.length,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 유일본 선언·사각지대가 사유 없이 비어 있지 않은지 */
export function auditSourceCanon(
  holdings: readonly SourceHolding[] = SOURCE_HOLDINGS,
  spots: readonly SourceBlindSpot[] = SOURCE_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (holdings.length === 0) problems.push('원본에만 남는 것의 정본이 비었다 — 지울 때 사라지는 것을 적을 자리가 사라졌다');
  for (const h of holdings) {
    if (!h.what.trim()) problems.push(`${h.key} 에 무엇이 남는지 적혀 있지 않다`);
    if (!h.lostOnDelete.trim()) problems.push(`${h.key} 를 지울 때 사라지는 것이 적혀 있지 않다`);
    if (h.onlyCopy !== true) {
      problems.push(`${h.key} 가 유일본이 아니라고 선언돼 있다 — 다른 사본이 생겼다면 이 절이 아니라 그 사본을 가리켜야 한다`);
    }
  }
  if (!holdings.some((h) => h.key === 'loss_window_rows')) {
    problems.push('유실 구간 행이 정본에서 빠졌다 — 고지문이 「유실」이라 부르는 바로 그 대상이다');
  }
  if (spots.length === 0) problems.push('사각지대 정본이 비었다');
  for (const s of spots) {
    if (!s.what.trim() || !s.why.trim()) problems.push(`사각지대 ${s.key} 에 설명이 없다`);
  }
  return problems;
}

/**
 * 좌표 키 이름이 `lib/lossNotice.ts`·`lib/incidentClosure.ts` 의 선언과 같은지.
 * 갈리면 이 판정은 **늘 비어 있는 env** 를 읽어 평상시(`not_applicable`)만 내보내고,
 * 복구 중에도 아무 말을 하지 않는다 — 응답은 200 이라 사람 눈으로는 알아챌 수 없다.
 * 순환 import 를 만들지 않도록 값을 **받는다**.
 */
export function auditKeyAgreement(keys: { restorePoint?: unknown; freezeAt?: unknown; noticeAt?: unknown }): string[] {
  const pairs: [string, unknown, string][] = [
    ['구간의 시작', keys.restorePoint, RANGE_START_ENV],
    ['구간의 끝', keys.freezeAt, RANGE_END_ENV],
    ['고지 시각', keys.noticeAt, NOTICE_ENV],
  ];
  return pairs
    .filter(([, got, want]) => String(got ?? '') !== want)
    .map(([label, got, want]) => `${label} 키 이름이 갈렸다: ${String(got ?? '(없음)')} ≠ ${want}`);
}

/** `src/lib/lossNotice.ts` 원문 — 판정을 **응답에 실어 보내는지**까지 본다 */
export function auditNoticeWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/sourceBranch\.ts['"]/.test(s)) problems.push('lossNotice 가 sourceBranch 를 import 하지 않는다');
  if (!/sourceFromEnv\(|assessSourceBranch\(/.test(s)) problems.push('lossNotice 가 원본 브랜치 판정을 호출하지 않는다');
  if (!/sourceVerdict\s*:/.test(s)) {
    problems.push('lossNotice 가 sourceVerdict 를 detail 에 담지 않는다 — 판정만 하고 버린다');
  }
  if (!/sourceRangeKnown\s*:/.test(s)) {
    problems.push('lossNotice 가 sourceRangeKnown 을 detail 에 담지 않는다 — 꺼낼 범위를 말할 수 없는 상태가 보이지 않는다');
  }
  if (!/sourceNote\s*:/.test(s)) {
    problems.push('lossNotice 가 sourceNote 를 detail 에 담지 않는다 — 다음에 할 일을 읽을 자리가 없다');
  }
  if (/source(StartsAt|EndsAt|Window)\s*:/.test(s)) {
    problems.push('lossNotice 가 구간 **좌표**를 detail 에 담는다 — 무인증 응답에서 그 구간의 쓰기를 노리는 데 쓰인다(§2-3)');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 브랜치의 존재·처분은 코드가 확인할 수 없다 — 체크를 만들면 처분하지 않은 사건이 영구
 * degraded 가 되고(§2-2), §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/sourceBranch['"]/.test(s)) {
    problems.push('헬스 라우트가 sourceBranch 를 직접 import 한다 — 판정은 기존 체크 안에서 말한다');
  }
  if (/checks\.sourceBranch\s*=/.test(s)) {
    problems.push('checks.sourceBranch 가 새로 생겼다 — degraded 가 늘고 인용 정본이 갈라진다');
  }
  return problems;
}

/**
 * 이 모듈이 **새 표지를 만들지 않았는지**. 좌표를 새 env 로 받기 시작하면 8단계 4번에서
 * 지울 것이 늘고, 하나만 남아도 다음 사건이 그것을 물려받는다(§3-14).
 */
export function auditNoNewEnv(moduleSrc: unknown): string[] {
  const s = String(moduleSrc ?? '');
  const allowed = new Set([RANGE_START_ENV, RANGE_END_ENV, NOTICE_ENV]);
  const problems: string[] = [];
  for (const m of s.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)) {
    if (!allowed.has(m[1])) problems.push(`${m[1]} 를 새로 읽는다 — 이 절은 신규 env 0 이 전제다`);
  }
  // 접근만 잡는다 — 머리글의 「`process.env` 미접근」 같은 **서술**까지 위반으로 세면
  // 규율을 적어 둔 것이 위반이 되어, 다음 배치가 그 문장을 지우는 쪽으로 고친다.
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 직접 접근한다 — 순수 모듈 규율이 깨졌다');
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-18 과 그것을 가리키는 단계가 함께 남아 있는지. 특히
 *  · 5단계가 「원본이 남는다」를 말하지 않으면 두 벌이 된 사실이 절차에서 사라지고,
 *  · 8단계가 이 절로 유도하지 않으면 고지·표지 삭제가 판단을 앞지르며,
 *  · 체크리스트의 「브랜치 정리」가 어느 브랜치인지 말하지 않으면 사건에서 **유일본을 지운다**.
 */
export function auditRunbookSource(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-18\./m.test(s)) problems.push('§3-18(원본 브랜치의 처분) 절이 없다');
  if (!/sourceText\(|assessSourceBranch\(/.test(s)) problems.push('§3-18 에 판정 산출 명령이 없다');
  if (!/sourceVerdict/.test(s)) problems.push('문서가 sourceVerdict 를 가리키지 않는다 — 담당자가 판정을 읽을 자리가 없다');
  for (const v of SOURCE_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-18 판정 표에 ${v} 행이 없다`);
  }
  for (const spot of SOURCE_BLIND_SPOTS) {
    if (!s.includes(spot.key)) problems.push(`§3-18 에 사각지대 ${spot.key} 가 없다`);
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i5 = sec3.search(/^5\.\s/m);
  const step5 = i5 < 0 ? '' : sec3.slice(i5).split(/^6\.\s/m)[0];
  if (!step5) problems.push('§3 5단계를 찾지 못했다');
  else if (!/3-18/.test(step5)) {
    problems.push('5단계가 §3-18 로 유도하지 않는다 — 전환 뒤 DB 가 두 벌이 된다는 사실이 절차에서 사라진다');
  }
  const i8 = sec3.search(/^8\.\s/m);
  const step8 = i8 < 0 ? '' : sec3.slice(i8);
  if (!step8) problems.push('§3 8단계를 찾지 못했다');
  else if (!/3-18/.test(step8)) {
    problems.push('8단계가 §3-18 로 유도하지 않는다 — 고지·표지 삭제가 추출·처분 판단을 앞지른다');
  }

  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) problems.push('리허설 체크리스트를 찾지 못했다');
  else {
    // **항목 줄**만 본다 — 다른 항목의 본문에도 「리허설 브랜치 정리」를 인용한 줄이 있어서
    // (§3-17 항목) 첫 일치를 쓰면 엉뚱한 줄을 검사한다.
    const cleanup = s
      .slice(at)
      .split('\n')
      .filter((line) => /^-\s*\[[ xX]\].*브랜치 정리/.test(line));
    if (cleanup.length === 0) problems.push('체크리스트에 「브랜치 정리」 항목이 없다');
    for (const line of cleanup.filter((l) => !/3-18/.test(l))) {
      problems.push(
        `체크리스트의 「브랜치 정리」 항목이 §3-18 을 가리키지 않는다 — 어느 브랜치인지 적혀 있지 않으면 ` +
          `사건에서 유실 구간의 유일본을 든 쪽을 지운다: ${line.trim().slice(0, 40)}`,
      );
    }
  }
  return problems;
}
