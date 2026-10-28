/**
 * lossNotice.ts — RUNBOOK §3 **8단계 2번(유실 구간 고지)** 을 수행·확인 가능하게 만든다. 2026-10-19
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 의 1~8단계와 §1·§2·§4·§5·§6 은 모두 기계적으로 수행·확인할 수 있게 됐다. 그 전부가
 * 향하는 **마지막 산출물**은 하나다 — §3 말미의 「**손실 구간을 반드시 이해관계자에게
 * 고지한다**」. 이것만이 이 저장소 밖으로 나가고, 한번 나가면 **되돌릴 수 없다**. 그런데
 *
 *  (1) **구간의 시작이 어디에도 기록되지 않는다.** §3-7 의 `assessLossWindow` 는 두 끝을
 *      받는다 — 끝(`RECOVERY_WRITE_FREEZE_AT`)은 2단계에서 기록 대상으로 승격됐지만,
 *      시작인 **복구 시점(T-ε)** 은 여전히 **인자**다. 3단계는 「만든 브랜치의 **지문**을
 *      산출해 적어 둔다」까지만 지시하고 그 시점을 적으라고 하지 않는다. §3-6 이 산출해 주는
 *      값은 담당자의 콘솔에만 있고, 그 산출(1단계)과 고지(8단계)는 **조사·차단·브랜치 생성·
 *      검증·전환·재적용·대조**를 사이에 두고 몇 시간 떨어져 있다 — 사건 대응은 보통 밤이고
 *      교대로 붙는다. 그래서 `checks.incidentClosure` 가 `recorded`(= 끝은 안다)여도
 *      **구간은 산출되지 않을 수 있고**, 그 사실을 말하는 신호가 없었다.
 *
 *  (2) **고지를 했다는 근거가 어디에도 없다.** 6-1단계(보안 재적용)·6-2단계(외부 대조)는
 *      각각 `RECOVERY_SECURITY_REAPPLIED_AT`·`RECOVERY_EXTERNAL_RECONCILED_AT` 로 승격되고
 *      7단계가 그 둘을 **선행 조건으로** 걸어 두었는데, 정작 **되돌릴 수 없는 외부
 *      커뮤니케이션**인 고지에는 기록도 게이트도 없다. §6 표 비고에 들어가는 문구는
 *      `incidentRecordDraft` 가 만드는 「고지 완료 여부 **확인**」 — 즉 **사람이 확인하라는
 *      메모**이고, 그 칸을 읽는 코드는 없다(`recovery.parseRehearsalTable` 은 비고를 보지 않는다).
 *
 *  (3) **그 근거를 만들 수 있는 창을 절차가 스스로 닫는다.** 8단계 4번은 표지를 **지우라고**
 *      지시하고(옳다 — 남으면 다음 사건에서 옛 시각이 쓰인다), `checks.incidentClosure` 의
 *      `stale_record` 도 그 삭제를 재촉한다. 그러나 그 삭제에는 **2·3번이 끝났는지 보는
 *      조건이 없다.** 지운 뒤에는 두 끝이 모두 사라져 구간을 되찾을 수 없고, 「고지했는가」를
 *      **물을 대상조차** 남지 않는다 — 고지 없이 끝낸 복구와 제대로 끝낸 복구가 평상시
 *      응답에서 **글자 하나 다르지 않다**. 아무도 오류를 보지 못한다.
 *
 * 그래서 이 모듈은
 *   · 구간의 **시작**을 기록 대상으로 승격하고(`RECOVERY_RESTORE_POINT`),
 *   · 고지 **수행 시각**을 기록 대상으로 승격하고(`RECOVERY_LOSS_NOTICE_AT`),
 *   · 차단이 걸려 있는 동안 — **아직 두 끝이 남아 있는 동안** — 미기록·미고지를 드러내고,
 *   · 8단계 4번(표지 삭제)에 선행 조건을 만들고(`canClearMarkers`·`blockers`),
 *   · 기록된 고지가 **구간의 끝보다 앞이면** 그 고지가 구간을 다 담지 못했다고 말하고,
 *   · 발신 통로가 **코드에 없다**는 사실을 숨기지 않는다(`NOTICE_CHANNELS` 전건 수동).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 명시 로더에서만 읽는다.
 * - **발신하지 않는다.** 고지는 사람이 한다 — 이 모듈은 수행 여부를 **기록·판정**할 뿐이다
 *   (실발신 배선은 승인 사항이고, 잘못 보낸 고지는 되돌릴 수 없다).
 * - **임의 수치 금지**: 구간은 §3-7 의 판정을 그대로 쓴다. 확정되지 않은 구간으로 고지 문구를
 *   만들지 않고, 고지 기록이 없으면 「했을 것이다」로 올리지 않는다.
 * - **새 거짓 ok 를 만들지 않는다**: 고지 시각이 기록됐다는 것이 「알맞은 내용을 알맞은
 *   상대에게 보냈다」는 뜻이 아니다(`NOTICE_LIMITS`).
 */
import {
  CLOSURE_LIMITS,
  FREEZE_AT_ENV,
  assessLossWindow,
  freezeAtFromEnv,
  type LossWindow,
} from './incidentClosure.ts';
import { parseInstant } from './incidentEvidence.ts';
import { audienceFromEnv } from './noticeAudience.ts';
import { sourceFromEnv } from './sourceBranch.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

/** 구간의 **시작**(실제로 적용한 복구 시점 T-ε)을 적어 두는 키. 평상시 미설정이 정상이다 */
export const RESTORE_POINT_ENV = 'RECOVERY_RESTORE_POINT';

/** 유실 구간 고지를 **발신한** 시각을 적어 두는 키. 평상시 미설정이 정상이다 */
export const NOTICE_AT_ENV = 'RECOVERY_LOSS_NOTICE_AT';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const NOTICE_RUNBOOK_REF = 'RUNBOOK §3 8단계 2번·§3-10';

/** `[확인 필요]` 표기 — §6 표 비고에 지어낸 값을 넣지 않는다 */
export const UNKNOWN_CELL = '[확인 필요]';

/* ─────────────────────────── 고지 의무 정본 ─────────────────────────── */

export interface NoticeObligation {
  /** 어디가 요구하는가 */
  source: string;
  /** 무엇을 요구하는가 */
  demands: string;
  /** 되돌릴 수 있는가 */
  irreversible: boolean;
}

/**
 * 「고지」를 요구하는 자리 전수. 한 군데라도 수행 근거를 남기지 않으면 **분쟁에서 증명할 수 없다**
 * (고지했는데 기록이 없는 쪽과 고지하지 않은 쪽이 같은 모습이 된다).
 */
export const NOTICE_OBLIGATIONS: readonly NoticeObligation[] = [
  {
    source: 'RUNBOOK §3 말미',
    demands: '손실 구간을 **반드시** 이해관계자에게 고지한다 — 구간의 끝은 2단계 차단 시각이다',
    irreversible: true,
  },
  {
    source: 'RUNBOOK §3 8단계 2번',
    demands: '구간을 §3-7 로 **산출해** 고지한다(눈대중·§3-6 의 `lossMinutes` 로 적지 않는다)',
    irreversible: true,
  },
  {
    source: '이용약관 제4조(서비스의 제공 및 변경)',
    demands: '점검·장애 시 사전 또는 **사후 고지** — 사후 고지의 수행 여부는 약관 이행 사실이다',
    irreversible: true,
  },
  {
    source: 'RUNBOOK §6 표(사건 기록)',
    demands: '같은 수치를 비고에 남긴다 — 표의 비고는 **자유 서술**이고 읽는 코드가 없다',
    irreversible: false,
  },
];

/* ─────────────────────────── 발신 통로 정본 ─────────────────────────── */

export interface NoticeChannel {
  id: string;
  /** 어디로 나가는가 */
  surface: string;
  /** 코드가 발신하는가 — **전건 false 가 지금의 사실이다** */
  automated: boolean;
  /** 왜 */
  why: string;
}

/**
 * 고지가 실제로 나가는 통로. **전건 수동**이다 — 메일은 §4-8 기준 미연동이고, 서비스 안에
 * 공지를 띄우는 화면도 상태 페이지도 없다. 이 사실을 숨기지 않는 이유: 「고지하라」는 지시만
 * 있고 통로가 없으면 담당자는 **가장 가까운 수단**으로 처리하고(개인 메일·전화) 그 흔적은
 * 저장소 밖에 남는다 — 그래서 이 모듈이 받는 것은 발신이 아니라 **수행 기록**이다.
 */
export const NOTICE_CHANNELS: readonly NoticeChannel[] = [
  {
    id: 'operator_direct',
    surface: '담당자가 고객사 담당자에게 직접(메일·전화·메신저)',
    automated: false,
    why: '지금 유일하게 실제로 동작하는 통로다 — 흔적이 저장소 밖에 남으므로 수행 시각만 받아 둔다',
  },
  {
    id: 'service_notice',
    surface: '서비스 안 공지(로그인 후 화면)',
    automated: false,
    why: '공지 화면이 **없다** — 만들면 고지 대상이 「접속한 사람」으로 좁아지는 한계가 함께 생긴다',
  },
  {
    id: 'email_broadcast',
    surface: '가입 메일 주소로 일괄 발송',
    automated: false,
    why: '메일 발신이 미연동(§4-8)이고 실발신 활성화는 **승인 사항**이다 — 잘못 보낸 고지는 회수할 수 없다',
  },
  {
    id: 'status_page',
    surface: '공개 상태 페이지',
    automated: false,
    why: '없다. `/api/health` 는 상태 코드가 늘 200 이라 상태 페이지의 근거가 되지 못한다(§2-2)',
  },
];

/** 코드가 발신하는 통로 — **빈 배열이 지금의 사실이다** */
export function automatedChannels(): string[] {
  return NOTICE_CHANNELS.filter((c) => c.automated).map((c) => c.id);
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export const NOTICE_STATES = [
  /** 평상시 — 차단 OFF, 표지 없음 */
  'normal',
  /** 차단 중인데 구간의 두 끝 중 하나를 모른다 — **지금** 적지 않으면 되찾을 수 없다 */
  'basis_missing',
  /** 구간은 확정됐는데 고지 기록이 없다 */
  'due',
  /** 고지 시각이 기록돼 있다 */
  'notified',
  /** 기록된 고지가 **구간의 끝보다 앞이다** — 그 고지는 구간을 다 담지 못했다 */
  'notice_before_end',
  /** 값을 읽을 수 없다 */
  'invalid_record',
  /** 차단은 풀렸는데 기록이 남아 있다 — 8단계 4번에서 지운다 */
  'stale_record',
] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];

export const ACTION_NORMAL =
  `평상시 — 차단 OFF, 표지 없음. \`${RESTORE_POINT_ENV}\`·\`${NOTICE_AT_ENV}\` 는 복구 중에만 들어 있는 값이다`;

export const ACTION_BASIS_MISSING =
  '차단 중인데 유실 구간의 두 끝 중 하나가 **기록되지 않았다** — 시작은 3단계에서 실제로 브랜치를 만든 ' +
  `시점(T-ε)을 \`${RESTORE_POINT_ENV}\` 에, 끝은 차단이 실효된 시각을 \`${FREEZE_AT_ENV}\` 에 ` +
  '타임존을 붙인 ISO 시각으로 넣는다. **지금이 기록할 수 있는 유일한 시점이다** — 8단계 4번이 표지를 ' +
  '지우면 두 값을 되찾을 경로가 없고, 구간을 추정해 고지하지는 않는다';

export const ACTION_DUE =
  '유실 구간이 확정됐다 — `notice` 를 이해관계자에게 고지하고, **발신한 시각**을 ' +
  `\`${NOTICE_AT_ENV}\` 에 적는다(같은 수치를 §6 표 비고에도 남긴다). 코드는 발신하지 않는다 — ` +
  '통로는 전건 수동이다(`channels`)';

export const ACTION_NOTIFIED =
  '고지 시각이 기록돼 있다 — 8단계 3번(§6 표 기록)을 마친 뒤 4번에서 표지를 지운다. ' +
  '기록은 「보냈다고 적었다」는 뜻이고 내용·대상의 정확성은 검증되지 않는다(`limits`)';

export const ACTION_NOTICE_BEFORE_END =
  '기록된 고지 시각이 **유실 구간의 끝보다 앞이다** — 그 고지는 구간의 뒷부분을 담지 못했다. ' +
  '차단을 걸기 전에 보낸 장애 공지를 고지로 적었거나(그때는 구간이 확정되지 않았다), 시각을 잘못 적었다. ' +
  '구간 전체를 담은 고지를 다시 보내고 그 시각으로 고친다 — **이미 나간 고지는 회수할 수 없다**';

export const ACTION_INVALID_RECORD =
  '기록된 시각을 읽을 수 없다 — 타임존을 붙인 ISO 시각(`2026-10-19T13:40:00+09:00`)으로 다시 넣는다. ' +
  '못 읽는 값을 「기록됨」으로 올리지 않는다';

export const ACTION_STALE_RECORD =
  `차단은 OFF 인데 \`${NOTICE_AT_ENV}\`·\`${RESTORE_POINT_ENV}\` 가 남아 있다 — 사건 기록(§3 8단계 3번)을 ` +
  '마쳤으면 지운다. 남겨 두면 **다음 사건에서 옛 시각이 「고지했다」는 근거**로 쓰인다';

const ACTION: Record<NoticeState, string> = {
  normal: ACTION_NORMAL,
  basis_missing: ACTION_BASIS_MISSING,
  due: ACTION_DUE,
  notified: ACTION_NOTIFIED,
  notice_before_end: ACTION_NOTICE_BEFORE_END,
  invalid_record: ACTION_INVALID_RECORD,
  stale_record: ACTION_STALE_RECORD,
};

export const CAVEAT_RECORD_IS_A_CLAIM =
  `\`${NOTICE_AT_ENV}\` 는 「보냈다고 **적었다**」는 뜻이다 — 수신 여부·내용의 정확성·대상 범위는 ` +
  '이 값으로 알 수 없다. 발신 통로가 저장소 밖이라 코드가 대조할 근거가 없다';

export const CAVEAT_CLEARED_IS_INDISTINGUISHABLE =
  '표지를 지운 뒤에는 **고지 없이 끝낸 복구와 제대로 끝낸 복구가 구별되지 않는다** — 그래서 이 체크는 ' +
  '차단이 걸려 있는 동안(= 표지가 남아 있는 동안)에만 쓸모가 있고, 삭제 전에 `canClearMarkers` 로 막는다';

export const CAVEAT_WINDOW_IS_TIME_ONLY_HERE =
  '고지한 구간은 **시간 범위**다 — 누구의 어떤 데이터가 그 안에 있었는지는 §3-5 보존본과 대조해야 알 수 있다. ' +
  '「영향 없음」을 구간만으로 말하지 않는다';

/** 고지 기록이 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const NOTICE_LIMITS: readonly string[] = [
  CAVEAT_RECORD_IS_A_CLAIM,
  CAVEAT_CLEARED_IS_INDISTINGUISHABLE,
  '코드는 고지를 **발신하지 않는다** — 통로는 전건 수동이고(`channels`), 실발신 배선은 승인 사항이다',
  '이 배포의 env 만 본다 — 스코프를 틀려 적은 기록은 보이지 않고, 다른 배포에서 보낸 고지도 알 수 없다',
  '구간 수치는 §3-7 판정을 그대로 쓴다 — 그 한계(건수·대상 미포함·차단이 막지 못한 경로)는 `closureLimits` 가 그대로 적용된다',
  '약관 제4조의 「사후 고지」가 요구하는 **기한**은 문서에 수치가 없다 — 이 판정은 늦었는지를 말하지 않는다',
  '**대상 범위**는 이 값으로 알 수 없다 — 명단의 유일한 연락처 출처가 복구 대상 DB 안에 있어 전환과 함께 ' +
    '되돌아간다. 그 근거 상태는 `audienceVerdict`(§3-16)가 같은 자리에서 말한다',
  '「유실」이라 고지한 행이 **아직 읽을 수 있는 곳에 있을 수 있다** — 전환은 연결 문자열만 바꾸므로 원본 ' +
    '브랜치가 그대로 남고 그 구간의 행은 거기에만 있다. 그 국면은 `sourceVerdict`(§3-18)가 같은 자리에서 말한다',
];

export interface NoticeInput {
  /** 실제로 적용한 복구 시점(T-ε). 구간의 시작 */
  restorePoint?: unknown;
  /** 쓰기 차단이 **실효된** 시각. 구간의 끝 정본 */
  frozenAt?: unknown;
  /** 차단을 걸지 않았을 때의 대체 끝(5단계 전환 시각) */
  switchedAt?: unknown;
  /** 고지를 **발신한** 시각 */
  noticedAt?: unknown;
  /** 지금 쓰기 차단이 걸려 있는가 */
  frozen?: boolean;
  now?: Date;
}

export interface NoticeAssessment {
  state: NoticeState;
  /** §3-7 의 구간 판정을 그대로 담는다(수치를 다시 만들지 않는다) */
  window: LossWindow;
  /** 고지 발신 시각(ISO). 판독 실패·미기록이면 null */
  noticedAt: string | null;
  restorePointRecorded: boolean;
  freezeAtRecorded: boolean;
  /** 8단계 4번(표지 삭제)을 해도 되는가 */
  canClearMarkers: boolean;
  /** 삭제를 막는 이유. 비어 있을 때만 지운다 */
  blockers: string[];
  action: string;
  caveats: string[];
}

function presentText(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * 고지 수행 상태 판정. **구간은 §3-7 에 맡기고** 여기서는 「고지했는가 / 지울 수 있는가」만 본다.
 *
 * 판정 순서: 못 읽는 값이 먼저다(판독 실패를 「미기록」으로 섞으면 할 일이 달라진다) →
 * 구간을 다 담지 못한 고지는 **기록이 있어도 문제다**(가장 조용한 오류다) → 그다음이 차단 여부다.
 */
export function assessNotice(input?: NoticeInput): NoticeAssessment {
  const frozen = Boolean(input?.frozen);
  const window = assessLossWindow({
    restorePoint: input?.restorePoint,
    frozenAt: input?.frozenAt,
    switchedAt: input?.switchedAt,
    now: input?.now,
  });

  const rawNotice = presentText(input?.noticedAt);
  const parsedNotice = rawNotice ? parseInstant(rawNotice) : null;
  const noticedAt = parsedNotice ? parsedNotice.toISOString() : null;

  const restorePointRecorded = Boolean(presentText(input?.restorePoint));
  const freezeAtRecorded = Boolean(presentText(input?.frozenAt));

  let state: NoticeState;
  if (rawNotice && !parsedNotice) state = 'invalid_record';
  else if (parsedNotice && window.endsAt && parsedNotice.getTime() < Date.parse(window.endsAt)) {
    state = 'notice_before_end';
  } else if (parsedNotice) state = frozen ? 'notified' : 'stale_record';
  else if (frozen) state = window.verdict === 'ok' ? 'due' : 'basis_missing';
  else if (restorePointRecorded || freezeAtRecorded) state = 'due';
  else state = 'normal';

  // 표지 삭제(8단계 4번)의 선행 조건. **고지 기록이 없으면 지우지 않는다** — 지운 뒤에는
  // 구간을 되찾을 수도, 「고지했는가」를 물을 수도 없다.
  const blockers: string[] = [];
  if (state === 'normal') {
    // 지울 표지가 없다 — 막을 것도 없다.
  } else {
    if (!parsedNotice) {
      blockers.push(
        `고지 수행 기록(\`${NOTICE_AT_ENV}\`)이 없다 — 지우면 유실 구간의 두 끝과 함께 「고지했는가」를 물을 대상도 사라진다`,
      );
    }
    if (state === 'invalid_record') blockers.push(`\`${NOTICE_AT_ENV}\` 값을 읽을 수 없다 — 고친 뒤에 지운다`);
    if (state === 'notice_before_end') {
      blockers.push('기록된 고지가 유실 구간의 끝보다 앞이다 — 구간 전체를 담은 고지를 보낸 뒤에 지운다');
    }
    if (window.verdict !== 'ok') {
      blockers.push(`유실 구간이 확정되지 않았다(${window.verdict}) — 두 끝을 적어 구간을 확정한 뒤에 지운다`);
    }
  }

  const caveats = [CAVEAT_RECORD_IS_A_CLAIM, CAVEAT_CLEARED_IS_INDISTINGUISHABLE, CAVEAT_WINDOW_IS_TIME_ONLY_HERE];

  return {
    state,
    window,
    noticedAt,
    restorePointRecorded,
    freezeAtRecorded,
    canClearMarkers: blockers.length === 0,
    blockers,
    action: ACTION[state],
    caveats,
  };
}

/* ─────────────────────────── §6 표·사람용 출력 ─────────────────────────── */

/**
 * §6 표 **비고** 칸 문구. 「고지 완료 여부 확인」(= 사람에게 남긴 메모)을 **수행 기록**으로 바꾼다.
 * 확정되지 않은 구간·미기록 고지를 수치로 적지 않는다.
 */
export function recordRemark(a: NoticeAssessment): string {
  const w = a.window;
  if (w.verdict !== 'ok' || !w.startsAt || !w.endsAt) {
    return `유실 구간 미확정(${w.verdict}) · 고지 ${a.noticedAt ?? UNKNOWN_CELL} — ${UNKNOWN_CELL}`;
  }
  const sent = a.noticedAt ? `고지 ${a.noticedAt}` : `고지 ${UNKNOWN_CELL}`;
  return `유실 구간 ${w.startsAt} ~ ${w.endsAt}(${w.minutes}분) · ${sent}`;
}

/** 사람이 읽는 요약(로그·보고용). 구간 수치는 §3-7 문구를 그대로 쓴다 */
export function noticeText(a: NoticeAssessment): string {
  const lines = [`[고지] ${a.state}`, a.window.notice, a.action];
  if (a.blockers.length > 0) lines.push(`표지 삭제 보류: ${a.blockers.join(' / ')}`);
  return lines.join('\n');
}

/** 구조화 로그 한 줄. **시각·판정만** — 구간 수치·대상·담당자는 담지 않는다 */
export function noticeLogLine(a: NoticeAssessment): string {
  return [
    'recovery_loss_notice',
    `state=${a.state}`,
    `window=${a.window.verdict}`,
    `restore_point=${a.restorePointRecorded ? 'set' : 'absent'}`,
    `notified=${a.noticedAt ? 'set' : 'absent'}`,
    `clearable=${a.canClearMarkers}`,
  ].join(' ');
}

/* ─────────────────────────── env 로더 ─────────────────────────── */

/**
 * 기록된 복구 시점. `RECOVERY_RESTORE_POINT` 만 인정하고 **기본값을 만들지 않는다**.
 * 형식 밖·비실존 시각은 `at: null` — 못 읽는 값을 「기록됨」으로 올리지 않는다.
 */
export function restorePointFromEnv(env: Record<string, string | undefined> = process.env): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_RESTORE_POINT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/** 기록된 고지 발신 시각. `RECOVERY_LOSS_NOTICE_AT` 만 인정한다 */
export function noticedAtFromEnv(env: Record<string, string | undefined> = process.env): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_LOSS_NOTICE_AT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/** env 스냅샷으로 판정한다(라우트·명령에서 같은 경로를 쓴다) */
export function noticeFromEnv(env: Record<string, string | undefined> = process.env, now?: Date): NoticeAssessment {
  const rp = restorePointFromEnv(env);
  const fz = freezeAtFromEnv(env);
  const nt = noticedAtFromEnv(env);
  return assessNotice({
    restorePoint: rp.raw ?? undefined,
    frozenAt: fz.raw ?? undefined,
    noticedAt: nt.raw ?? undefined,
    frozen: writeFreezeEnabled(env),
    now,
  });
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

/**
 * 되돌릴 수 없는 외부 고지의 **수행 여부**를 공개 헬스체크에 드러낸다.
 *
 * 이 체크의 쓸모는 **시점**에 있다 — 차단이 걸려 있는 동안(= 두 끝이 아직 env 에 남아 있는 동안)
 * 미기록·미고지를 알려 준다. 8단계 4번이 표지를 지운 뒤에는 고지 없이 끝낸 복구와 제대로 끝낸
 * 복구가 **구별되지 않는다**(`CAVEAT_CLEARED_IS_INDISTINGUISHABLE`).
 *
 * `ok` 의 뜻: 「고지를 기록할 수 있는 상태인가 / 기록돼 있는가」다 — **내용·대상의 정확성은
 * 검증하지 않는다**. **required: false** 이므로 어느 경우에도 503 이 되지 않는다.
 *
 * ※ 담는 것은 **판정·키 이름·고지 시각·boolean** 뿐이다. 구간 수치(`minutes`)와 복구 시점 값은
 *   담지 않는다 — 무인증 응답이라 구간을 역산해 그 구간의 쓰기를 노리는 데 쓰인다(§2-3).
 */
export function lossNoticeCheck(args?: { env?: Record<string, string | undefined>; now?: Date }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const env = args?.env ?? process.env;
  const a = noticeFromEnv(env, args?.now);
  // 고지할 **상대**를 특정할 근거가 있는지 같은 자리에서 함께 말한다(§3-16). `ok` 는 바꾸지
  // 않는다 — 명단은 사람이 받는 것이고, 미보존으로 `ok` 를 내리면 복구일에 거짓 차단이 된다.
  // 달라지는 것은 **다음에 할 일**이다(차단 중이면 「지금 받는다」, 전환 뒤면 「닿지 않은 대상이
  // 있을 수 있다는 사실을 고지문·§6 표에 적는다」).
  const aud = audienceFromEnv(env);
  // 고지가 「유실」이라 부르는 행이 **아직 읽을 수 있는 곳에 있는지**도 같은 자리에서 말한다
  // (§3-18). 전환은 이 배포의 연결 문자열만 바꾸므로 원본 브랜치가 그대로 남고, 그 구간의
  // 행은 거기에만 있다 — 그런데 범위를 말해 주는 두 표지는 8단계 4번이 지운다. `ok` 는
  // 바꾸지 않는다: 브랜치의 존재·처분은 코드가 확인할 수 없고, 미처분으로 `ok` 를 내리면
  // 복구일에 거짓 차단이 된다. 달라지는 것은 **다음에 할 일**이다.
  const src = sourceFromEnv(env, args?.now);

  return {
    ok: a.state === 'normal' || a.state === 'notified',
    required: false,
    detail: {
      state: a.state,
      /** 명단 근거 판정(§3-16). 주소·명단·행 수는 담지 않는다 */
      audienceVerdict: aud.verdict,
      /** §3-5 보존 기록이 있는가 — **내용은 확인하지 않는다**(주장이다) */
      audienceRosterClaimed: aud.rosterClaimed,
      /** 명단을 **지금** 받을 수 있는가(차단 중 = 전환 전) */
      audiencePreservable: aud.preservable,
      /** 「전원에게 갔는가」 — 코드는 **늘 모른다**. `notified` 를 전원 고지로 읽지 않게 함께 둔다 */
      audienceCoversAll: aud.coversAll,
      audienceDrifts: aud.drifts.length,
      audienceNote: aud.action,
      /** 원본(손상) 브랜치 국면 판정(§3-18). **좌표·시각은 담지 않는다** */
      sourceVerdict: src.verdict,
      /** 원본에서 **무엇을 꺼내야 하는지** 말할 수 있는가(= 구간의 두 끝을 안다) */
      sourceRangeKnown: src.rangeKnown,
      /** 원본에만 남는 것의 수 — 전건 유일본이다(브랜치가 남아 있다면) */
      sourceHoldings: src.holdings,
      sourceNote: src.action,
      frozen: writeFreezeEnabled(env),
      /** 구간을 산출할 수 있는 상태인가 — 수치는 담지 않는다 */
      windowVerdict: a.window.verdict,
      restorePointRecorded: a.restorePointRecorded,
      freezeAtRecorded: a.freezeAtRecorded,
      notified: Boolean(a.noticedAt),
      noticedAt: a.noticedAt,
      canClearMarkers: a.canClearMarkers,
      blockers: a.blockers,
      switchKey: WRITE_FREEZE_ENV,
      restorePointKey: RESTORE_POINT_ENV,
      recordKey: NOTICE_AT_ENV,
      /** 코드가 발신하는 통로 — **빈 배열이 의도된 값**이다 */
      automatedChannels: automatedChannels(),
      obligations: NOTICE_OBLIGATIONS.length,
      runbook: NOTICE_RUNBOOK_REF,
      limits: NOTICE_LIMITS,
      closureLimits: CLOSURE_LIMITS.length,
      note: ACTION[a.state],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function lossNoticeStatus(
  env: Record<string, string | undefined> = process.env,
  now?: Date,
): {
  state: NoticeState;
  windowVerdict: LossWindow['verdict'];
  canClearMarkers: boolean;
  channels: number;
  automated: number;
  limits: number;
  note: string;
} {
  const a = noticeFromEnv(env, now);
  return {
    state: a.state,
    windowVerdict: a.window.verdict,
    canClearMarkers: a.canClearMarkers,
    channels: NOTICE_CHANNELS.length,
    automated: automatedChannels().length,
    limits: NOTICE_LIMITS.length,
    note: a.action,
  };
}

/* ─────────────────────────── 배선 정적 점검 ─────────────────────────── */

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 이 체크가 빠지면 「고지했는가」를 물을 유일한 장치가 사라지는데, 응답은 그대로 200 이라
 * 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/lossNotice['"]/.test(s)) problems.push('lossNotice 를 import 하지 않는다');
  if (!/lossNoticeCheck\(/.test(s)) problems.push('lossNoticeCheck() 를 호출하지 않는다');
  else if (!/checks\.lossNotice\s*=\s*lossNoticeCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.lossNotice 로 내보내지 않는다 — 판정만 하고 버린다');
  }
  return problems;
}

/**
 * 새 두 키가 **사건 표지**(`healthDisclosure.INCIDENT_MARKERS`)에 들어 있는지 대조한다.
 * 둘 다 사건 타임라인을 말하는 값이라, 표지에서 빠지면 복구 중에도 §2-3 의 가림이 걸리지 않고
 * 무인증 응답이 구간·고지 상태를 그대로 공표한다. 순환 import 를 만들지 않도록 목록을 **받는다**.
 */
export function auditMarkerCoverage(markers: unknown): string[] {
  const keys = Array.isArray(markers)
    ? markers.map((m) => String((m as { key?: unknown })?.key ?? m ?? ''))
    : [];
  if (keys.length === 0) return ['사건 표지 목록을 읽을 수 없다 — INCIDENT_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  return [RESTORE_POINT_ENV, NOTICE_AT_ENV]
    .filter((k) => !keys.includes(k))
    .map((k) => `${k} 가 사건 표지에 없다 — 복구 중 무인증 응답에서 가려지지 않는다(§2-3)`);
}

/**
 * 새 두 키가 **임시 키**(`envPresence.TRANSIENT_KEYS`)에 들어 있는지 대조한다.
 * 빠지면 (가) 사건 중에 뜬 §2 스냅샷이 평상시에도 이 키를 요구해 거짓 `missing` 이 되고,
 * (나) 8단계 4번의 삭제를 「설정 유실」로 보고한다.
 */
export function auditTransientCoverage(keys: unknown): string[] {
  const list = Array.isArray(keys) ? keys.map((k) => String(k)) : [];
  if (list.length === 0) return ['임시 키 목록을 읽을 수 없다 — TRANSIENT_KEYS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  return [RESTORE_POINT_ENV, NOTICE_AT_ENV]
    .filter((k) => !list.includes(k))
    .map((k) => `${k} 가 임시 키 목록에 없다 — 평상시에 거짓 missing 으로 보고된다`);
}

/**
 * `RUNBOOK.md` 원문 점검 — 절차에 고지 **기록**과 **삭제 게이트**가 없으면 이 모듈은
 * 아무도 호출하지 않는 코드가 된다. 특히
 *  · 3단계가 복구 시점을 적으라고 하지 않으면 구간의 **시작**이 영구히 사라지고,
 *  · 8단계 4번이 2·3번 완료를 선행 조건으로 걸지 않으면 삭제가 그 둘을 앞지른다.
 */
export function auditRunbookNotice(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-10\./m.test(s)) problems.push('§3-10(유실 고지 수행·기록) 절이 없다');
  if (!/lossNoticeStatus\(|assessNotice\(/.test(s)) problems.push('§3-10 에 고지 상태 산출 명령이 없다');
  for (const key of [RESTORE_POINT_ENV, NOTICE_AT_ENV]) {
    if (!new RegExp(key).test(s)) problems.push(`${key} 가 문서에 없다 — 복구 시 조용히 유실된다`);
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }

  const i3 = sec3.search(/^3\.\s/m);
  const step3 = i3 < 0 ? '' : sec3.slice(i3).split(/^4\.\s/m)[0];
  if (!step3) problems.push('§3 3단계를 찾지 못했다');
  else if (!new RegExp(RESTORE_POINT_ENV).test(step3)) {
    problems.push(`3단계가 ${RESTORE_POINT_ENV} 기록을 지시하지 않는다 — 유실 구간의 시작이 어디에도 남지 않는다`);
  }

  const i8 = sec3.search(/^8\.\s/m);
  const step8 = i8 < 0 ? '' : sec3.slice(i8);
  if (!step8) problems.push('§3 8단계를 찾지 못했다');
  else {
    if (!new RegExp(NOTICE_AT_ENV).test(step8)) {
      problems.push(`8단계가 ${NOTICE_AT_ENV} 기록을 지시하지 않는다 — 고지 수행 근거가 남지 않는다`);
    }
    if (!/3-10/.test(step8)) problems.push('8단계가 §3-10 으로 유도하지 않는다');
    if (!/canClearMarkers/.test(step8)) {
      problems.push('8단계 4번(표지 삭제)이 2·3번 완료를 선행 조건으로 걸지 않는다 — 삭제가 고지를 앞지른다');
    }
  }
  return problems;
}
