/**
 * incidentTimeline.ts — 사건 표지가 **이번 사건의 것인가**(RUNBOOK §3-14). 2026-10-25
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 절차는 복구 중에만 들어 있는 시각 기록 5개를 **단계마다 하나씩** 남긴다 —
 * 2단계 `RECOVERY_WRITE_FREEZE_AT`(차단 실효) · 3단계 `RECOVERY_RESTORE_POINT`(T-ε) ·
 * 6-1단계 `RECOVERY_SECURITY_REAPPLIED_AT` · 6-2단계 `RECOVERY_EXTERNAL_RECONCILED_AT` ·
 * 8단계 2번 `RECOVERY_LOSS_NOTICE_AT`. 그리고 7단계(차단 해제)는 그중 둘을 **선행 조건**으로
 * 걸고, 8단계 4번은 전건을 **지우라고** 지시한다.
 *
 * 그런데 그 다섯 값은 **각자 자기 모듈에서 홀로** 판정됐다. 판정 규칙은 어느 쪽이든 한 줄이다 —
 * 「차단이 걸려 있고 값이 읽히면 `recorded`」. **그 값이 언제 적힌 것인지는 보지 않는다.**
 *
 *  (1) **8단계 4번을 거른 복구가 다음 사건의 근거가 된다.** 표지를 지우지 않으면 평상시에
 *      `stale_record` 가 뜨는데(그렇게 설계해 두었다), 그 경고는 **degraded(200)** 이고
 *      §2-2 가 「상시로 읽는 쪽 셋 중 어느 쪽도 degraded 를 보지 못한다」고 적어 둔 그 신호다.
 *      더 나쁜 것은 **다음 사건의 2단계에서 차단을 켜는 순간** `stale_record` 가
 *      `recorded` 로 **뒤집힌다**는 점이다 — 하나 있던 경고가 **정작 쓸모 있어지는 순간에
 *      사라지고**, 7단계 게이트(「차단 중 미기록이면 `pending` 으로 드러난다」)는 몇 달 전
 *      시각을 보고 통과한다. 되살아난 세션·유출된 비밀번호가 **아직 통하는** 상태에서
 *      문이 열리고(§3-8), 제공자와 어긋난 플랜 위로 쓰기가 쌓이고(§3-9),
 *      고지하지 않은 복구가 `notified` 로 보여 표지 삭제 게이트(`canClearMarkers`)까지 열린다.
 *
 *  (2) **구간이 과대 표기된다.** 옛 `RECOVERY_RESTORE_POINT` 가 남아 있으면 §3-7 구간은
 *      [옛 T-ε, 이번 차단 시각] 이 되는데 그 값은 `verdict: ok` 로 나온다(끝이 시작보다
 *      뒤이기만 하면 통과한다). 그 수치가 §3-10 이 「이 절차에서 **유일하게 되돌릴 수 없는**
 *      산출물」이라고 적어 둔 **대외 고지**로 나간다.
 *
 *  (3) **한 쌍만 대조되고 있었다.** §3-10 은 고지 시각이 구간의 끝보다 앞이면
 *      `notice_before_end` 를 낸다 — 즉 이 축이 쓸모 있다는 것은 이미 한 번 확인됐는데,
 *      나머지 네 값에는 같은 대조가 없었다.
 *
 * 그래서 이 모듈은 다섯 표지를 **앵커(2단계 차단 실효 시각) 하나에 견주어** 귀속을 판정하고,
 * 「이번 사건의 기록이라고 말할 수 있는가」를 각 체크가 자기 자리에서 함께 말하게 한다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근(env 는 명시 인자·로더로만). **신규 env 0 ·
 *   신규 조회·쓰기·DDL 0 · 신규 `/api/health` 체크 0** — 이미 들어 있는 키의 **시각**만 본다.
 * - **판정 어휘를 바꾸지 않는다**: `state`(`recorded`/`pending`/…)와 각 체크의 `ok` 는 그대로다.
 *   달라지는 것은 **다음에 할 일**이다. 타임존 누락으로 잘못 적힌 값과 「하지 않았다」를
 *   코드가 구분할 수 없고(둘 다 고쳐야 한다), `ok` 를 내리면 복구일에 거짓 차단이 된다.
 * - **구분할 수 없는 것을 구분했다고 하지 않는다**: T-ε 은 앵커보다 **앞인 것이 정상**이라
 *   「이른 복구 시점」과 「옛 사건의 시점」이 같은 모습이다 — `indistinguishable` 로 내보낸다.
 * - 앵커 자신은 대조 상대가 없다. 귀속이 보장하는 것은 「구간 안이다」까지이고
 *   「실제로 수행했다」가 아니다 — `TIMELINE_LIMITS` 로 함께 내보낸다.
 */
import { parseInstant } from './incidentEvidence.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

/** 응답·문서에서 근거 문서를 찾을 수 있게 한다 */
export const TIMELINE_RUNBOOK_REF = 'RUNBOOK §3-14·§3 8단계 4번';

/**
 * 귀속의 기준점 — **2단계에서 차단이 실효된 시각**. 사건에서 가장 먼저 적히는 값이므로
 * 그 뒤에 적히는 기록은 모두 이 값 **이후**여야 한다.
 *
 * ※ 키 이름을 리터럴로 들고 있는 이유: 이 모듈을 쓰는 쪽(`postRestoreSecurity`·
 *   `externalReconcile`)이 `incidentClosure` 를 거쳐 들어오므로 거꾸로 import 하면 순환이 된다.
 *   정본과 어긋나지 않는지는 **테스트가 각 모듈의 상수와 양방향 대조**한다.
 */
export const ANCHOR_ENV = 'RECOVERY_WRITE_FREEZE_AT';

/* ─────────────────────────── 표지 정본 ─────────────────────────── */

/** 앵커와의 관계. `before_anchor` 는 **앵커보다 앞인 것이 정상**이라는 뜻이다(T-ε) */
export type MarkerRelation = 'anchor' | 'before_anchor' | 'after_anchor';

export interface TimelineMarker {
  key: string;
  /** 이 값을 적는 단계 */
  step: string;
  /** 절차상 순서. 앵커가 0 이고, 숫자가 클수록 뒤에 적힌다 */
  order: number;
  relation: MarkerRelation;
  /** 이 값을 **홀로** 읽는 모듈이 내는 판정 — 옛 값이어도 똑같이 나온다 */
  readAs: string;
  /** 옛 사건의 값이 남아 있을 때 생기는 일 */
  carryOver: string;
  /** 앵커와 대조해 **옛 값임을 말할 수 있는가**. false 는 한계이고 고장이 아니다 */
  detectable: boolean;
}

/**
 * §3 이 복구 중에만 넣으라고 지시하는 **시각 기록** 전건. 스위치(`RECOVERY_WRITE_FREEZE`·
 * `RECOVERY_REHEARSAL_ACTIVE`)는 시각이 없어 귀속을 말할 수 없으므로 여기에 넣지 않는다 —
 * `healthDisclosure.INCIDENT_MARKERS` 의 `kind: 'record'` 와 **같은 여섯 건**이고,
 * 테스트가 양방향으로 대조한다.
 *
 * ※ 2026-10-25 에 `RECOVERY_EVIDENCE_PRESERVED_AT`(§3-5 보존 수행)이 더해졌다 — 그전에는
 *   되돌릴 수 없는 두 일(대외 고지·전환으로 사라지는 감사 이력) 중 **한쪽에만** 표지가 있었다.
 */
export const TIMELINE_MARKERS: readonly TimelineMarker[] = [
  {
    key: ANCHOR_ENV,
    step: '§3 2단계(쓰기 차단)',
    order: 0,
    relation: 'anchor',
    readAs: '`checks.incidentClosure.detail.state` 가 `recorded`',
    carryOver:
      '옛 차단 시각이 **이번 유실 구간의 끝**으로 쓰인다(§3-7) — 구간이 실제보다 좁거나 음수가 되고, ' +
      '그 값이 귀속의 기준점이므로 **뒤따르는 네 판정까지 함께 틀린다**',
    detectable: false,
  },
  {
    key: 'RECOVERY_RESTORE_POINT',
    step: '§3 3단계(복구 브랜치 생성)',
    order: 1,
    relation: 'before_anchor',
    readAs: '`checks.lossNotice.detail.restorePointRecorded` 가 `true`',
    carryOver:
      '유실 구간의 **시작**이 실제보다 이르러 과대 구간이 산출되는데 §3-7 은 `ok` 를 낸다 — ' +
      '그 수치가 §3-10 의 **되돌릴 수 없는 대외 고지**로 나간다',
    detectable: false,
  },
  {
    key: 'RECOVERY_EVIDENCE_PRESERVED_AT',
    step: '§3-5(조사 근거 보존 — 2단계 차단 뒤, 3단계 전)',
    order: 2,
    relation: 'after_anchor',
    readAs: '`checks.incidentClosure.detail.evidenceState` 가 `recorded`',
    carryOver:
      '보존하지 않은 복구가 「보존했다」로 보이고, 6-1단계 2·3번이 **대상을 추릴 출처 없이** 완료로 적힌다 — ' +
      '전환 뒤에는 그 이력이 없어지므로 **되찾을 경로가 없다**(§3-15)',
    detectable: true,
  },
  {
    key: 'RECOVERY_SECURITY_REAPPLIED_AT',
    step: '§3 6-1단계 5번(보안 상태 재적용)',
    order: 3,
    relation: 'after_anchor',
    readAs: '`checks.postRestoreSecurity.detail.state` 가 `recorded`',
    carryOver:
      '7단계 해제의 선행 조건이 몇 달 전 시각으로 통과한다 — 되살아난 세션·유출된 비밀번호·' +
      '되살아난 재설정 링크가 **아직 통하는** 상태에서 사용자와 함께 들어온다(§3-8)',
    detectable: true,
  },
  {
    key: 'RECOVERY_EXTERNAL_RECONCILED_AT',
    step: '§3 6-2단계 5번(외부 상태 대조)',
    order: 4,
    relation: 'after_anchor',
    readAs: '`checks.externalState.detail.state` 가 `recorded`',
    carryOver:
      '해지한 조직의 유료 플랜이 되살아나고 결제한 조직의 좌석·기능이 잠긴 채 해제된다 — ' +
      '그 위로 쓰기가 쌓이면 **어느 것이 복구 탓인지 흐려진다**(§3-9)',
    detectable: true,
  },
  {
    key: 'RECOVERY_LOSS_NOTICE_AT',
    step: '§3 8단계 2번(유실 고지)',
    order: 5,
    relation: 'after_anchor',
    readAs: '`checks.lossNotice.detail.state` 가 `notified`',
    carryOver:
      '고지하지 않은 복구가 「고지했다」로 보이고 표지 삭제 게이트(`canClearMarkers`)가 열린다 — ' +
      '지운 뒤에는 **고지 없이 끝낸 복구와 제대로 끝낸 복구가 글자 하나 다르지 않다**(§3-10). ' +
      '다만 이 한 쌍은 §3-10 이 이미 `notice_before_end` 로 대조하고 있었다',
    detectable: true,
  },
];

export function markerOf(key: unknown): TimelineMarker | null {
  const k = String(key ?? '');
  return TIMELINE_MARKERS.find((m) => m.key === k) ?? null;
}

/** 기록 표지(앵커 제외)의 키 이름 */
export function recordKeys(): string[] {
  return TIMELINE_MARKERS.filter((m) => m.relation !== 'anchor').map((m) => m.key);
}

/* ─────────────────────── 홀로 읽을 때 거짓이 되는 판정 ─────────────────────── */

export interface TimelineMisread {
  key: string;
  /** 그 판정을 내는 자리 */
  where: string;
  /** 그 자리가 하는 말 */
  says: string;
  /** 옛 값일 때의 사실 */
  truth: string;
}

export const TIMELINE_MISREADS: readonly TimelineMisread[] = [
  {
    key: 'RECOVERY_EVIDENCE_PRESERVED_AT',
    where: '`checks.incidentClosure.detail.evidenceState`',
    says: '`recorded` — 「차단 중이고 보존을 마친 시각이 기록돼 있다」',
    truth:
      '이번 사건에서는 아무것도 내보내지 않았다. 6-1단계 2·3번이 추릴 출처가 없는데 ' +
      '`evidenceAvailable` 이 `available` 로 나온다(§3-15)',
  },
  {
    key: 'RECOVERY_SECURITY_REAPPLIED_AT',
    where: '`checks.postRestoreSecurity.detail.state`',
    says: '`recorded` — 「차단 중이고 재적용 시각이 기록돼 있다」',
    truth: '이번 사건에서는 아무것도 재적용하지 않았다. 7단계 선행 조건이 옛 시각으로 통과한다',
  },
  {
    key: 'RECOVERY_EXTERNAL_RECONCILED_AT',
    where: '`checks.externalState.detail.state`',
    says: '`recorded` — 「차단 중이고 대조 시각이 기록돼 있다」',
    truth: '이번 사건에서는 제공자 쪽과 대조하지 않았다. 어긋난 플랜이 그대로 해제된다',
  },
  {
    key: 'RECOVERY_LOSS_NOTICE_AT',
    where: '`checks.lossNotice.detail.state`',
    says: '`notified` — 「고지를 발신했다」',
    truth: '이번 구간은 고지되지 않았다 — 되돌릴 수 없는 산출물이 빠진 채 표지가 지워진다',
  },
  {
    key: 'RECOVERY_RESTORE_POINT',
    where: '`checks.lossNotice.detail.restorePointRecorded`',
    says: '`true` — 「구간의 시작을 안다」',
    truth: '옛 복구 시점이고, 그 값으로 산출한 구간은 과대 표기다(§3-7 은 `ok` 를 낸다)',
  },
  {
    key: ANCHOR_ENV,
    where: '`checks.incidentClosure.detail.state`',
    says: '평상시 `stale_record` → **차단을 켜는 순간** `recorded` 로 뒤집힌다',
    truth: '하나 있던 경고가 정작 쓸모 있어지는 순간에 사라진다 — 귀속의 기준점 자신이 옛 값이다',
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const TIMELINE_VERDICTS = [
  'absent',
  'consistent',
  'carried_over',
  'out_of_order',
  'unanchored',
  'unreadable',
] as const;
export type TimelineVerdict = (typeof TIMELINE_VERDICTS)[number];

export const ACTION_TL_ABSENT =
  `사건 표지가 하나도 들어 있지 않다 — 평상시 상태다. 복구에 들어가면 §3 2단계에서 \`${ANCHOR_ENV}\` 를 ` +
  '먼저 적고, 그 뒤의 기록은 모두 그 시각 이후여야 한다';

export const ACTION_TL_CONSISTENT =
  '들어 있는 표지가 모두 이번 차단 시각 이후다 — 귀속은 말할 수 있다. ' +
  '다만 그것이 「실제로 수행했다」는 뜻은 아니다(`limits` 참고)';

export const ACTION_TL_CARRIED_OVER =
  '차단 시각보다 **앞선** 기록이 들어 있다 — 이번 사건의 것일 수 없다. ' +
  `지난 복구에서 §3 8단계 4번(표지 삭제)을 거른 값이거나, 타임존을 붙이지 않고 적어 ` +
  '9시간 앞으로 읽히는 값이다(제1 용의자). **지우거나 다시 적은 뒤** 7단계로 간다 — ' +
  '그 값을 그대로 두면 해당 단계를 수행하지 않고도 선행 조건이 통과한다';

export const ACTION_TL_OUT_OF_ORDER =
  '표지의 시각이 절차 순서와 어긋난다 — 두 값을 다시 확인한다(타임존 누락이 제1 용의자다). ' +
  '순서가 어긋난 기록은 「하지 않았다」는 뜻이 아니라 **귀속을 말할 수 없다**는 뜻이다';

export const ACTION_TL_UNANCHORED =
  `기록 표지는 들어 있는데 \`${ANCHOR_ENV}\` 가 없다 — 어느 사건의 기록인지 말할 수 없다. ` +
  '차단 중이라면 **지금** 차단 실효 시각을 적는다(§3 2단계. 해제 뒤에는 알 수 없다). ' +
  '평상시라면 지난 복구가 표지를 덜 지운 것이다 — 남은 기록을 §6 표로 옮겨 적고 지운다(§3 8단계 4번)';

export const ACTION_TL_UNREADABLE =
  '표지 값을 읽을 수 없다 — `2026-10-25T02:10:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 다시 적는다. ' +
  '읽을 수 없는 값으로 귀속을 판정하지 않는다(「없다」로도 세지 않는다)';

export const CAVEAT_TL_ANCHOR_UNCHECKED =
  `귀속의 기준점인 \`${ANCHOR_ENV}\` 자신은 대조 상대가 없다 — 차단을 다시 걸면서 이 값을 갱신하지 않으면 ` +
  '뒤따르는 네 판정이 모두 「정합」으로 보인다';

export const CAVEAT_TL_RESTORE_POINT_BLIND =
  '복구 시점(T-ε)의 옛 값은 **구분되지 않는다** — 앵커보다 앞인 것이 정상이라 「이른 복구 시점」과 ' +
  '「옛 사건의 시점」이 같은 모습이다. 보존 창 밖인지는 §3-6 으로 따로 본다';

export const CAVEAT_TL_NOT_PERFORMANCE =
  '「정합」은 **시각이 이번 구간 안이다**까지만 말한다 — 세션을 실제로 폐기했는지·제공자와 실제로 대조했는지· ' +
  '고지를 실제로 발신했는지는 이 판정 밖이고, 그 값은 사람이 적는다';

export const CAVEAT_TL_THIS_SCOPE_ONLY =
  '이 배포의 env 한 벌만 본다 — 다른 스코프에 적힌 기록은 보이지 않는다(§3-13 과 같은 한계)';

/** 귀속이 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const TIMELINE_LIMITS: readonly string[] = [
  CAVEAT_TL_ANCHOR_UNCHECKED,
  CAVEAT_TL_RESTORE_POINT_BLIND,
  CAVEAT_TL_NOT_PERFORMANCE,
  CAVEAT_TL_THIS_SCOPE_ONLY,
  '시계가 어긋난 환경에서 적은 값은 순서가 뒤집힐 수 있다 — `out_of_order` 를 「안 했다」로 읽지 않는다',
  '복구 중 재손상으로 차단을 **두 번** 걸면 두 번째 시각이 앵커가 되어 첫 번째 사건의 기록이 `carried_over` 로 나온다 — 고장이 아니라 사실이고, 두 사건을 §6 표 한 행으로 적지 않는다',
  '`unanchored` 는 「안 했다」도 「했다」도 아니다 — **귀속을 말할 수 없다**는 뜻이다',
];

export interface MarkerReading {
  key: string;
  order: number;
  relation: MarkerRelation;
  /** 값이 들어 있는가(공백만은 미설정으로 본다) */
  present: boolean;
  /** 판독한 시각(ISO). 못 읽으면 null — 지어내지 않는다 */
  at: string | null;
  /** 들어 있는데 읽을 수 없다 */
  unreadable: boolean;
}

/** 표지 전건을 읽는다. **기본값을 만들지 않는다** — 미설정은 미설정으로 남긴다 */
export function readTimeline(env: Record<string, string | undefined> = {}): MarkerReading[] {
  return TIMELINE_MARKERS.map((m) => {
    const raw = (env[m.key] ?? '').trim();
    if (!raw) return { key: m.key, order: m.order, relation: m.relation, present: false, at: null, unreadable: false };
    const d = parseInstant(raw);
    return {
      key: m.key,
      order: m.order,
      relation: m.relation,
      present: true,
      at: d ? d.toISOString() : null,
      unreadable: !d,
    };
  });
}

export interface OrderBreak {
  /** 먼저 적혀야 하는 키 */
  earlier: string;
  /** 뒤에 적혀야 하는 키 */
  later: string;
}

export interface TimelineAssessment {
  verdict: TimelineVerdict;
  /** 이 배포가 차단 중인가(`RECOVERY_WRITE_FREEZE === 'true'`) */
  frozen: boolean;
  anchorKey: string;
  /** 앵커 시각(ISO). 미설정·판독 실패면 null */
  anchorAt: string | null;
  /** 앵커보다 **앞서** 있어 이번 사건의 것일 수 없는 기록(키 이름) */
  carried: string[];
  /** 절차 순서와 어긋난 쌍 */
  outOfOrder: OrderBreak[];
  /** 앵커가 없어 귀속을 말할 수 없는 기록(키 이름) */
  unanchoredKeys: string[];
  /** 들어 있는데 읽을 수 없는 키 */
  unreadableKeys: string[];
  /** 들어 있는 기록 표지 수(앵커 제외) */
  recordCount: number;
  /** 값이 들어 있는 키 전건(앵커 포함). 판독 가능 여부와 무관하다 */
  present: string[];
  /** 들어 있지만 앵커와 대조해도 옛 값인지 **알 수 없는** 키 */
  indistinguishable: string[];
  action: string;
  caveats: readonly string[];
}

/**
 * 표지의 귀속 판정.
 *
 * 신호는 **전건을 먼저 모으고** 그 뒤에 판정을 고른다 — 한 신호가 걸렸을 때 바로 돌려주면
 * 나머지 신호가 계산되지 않아, 같은 응답에 들어 있는 다른 표지의 귀속이 조용히 틀린다
 * (예: 한 값이 판독 불가일 때 옛 값으로 남은 다른 표지가 `anchor` 로 보고된다).
 *
 * 판정 순서: 아무것도 없으면 평상시(`absent`) → 못 읽는 값(`unreadable` — 「없다」로 세지 않는다) →
 * 앵커가 없으면 귀속을 말할 수 없다(`unanchored`. 기준점이 없으면 「앞섰다」를 셀 수 없으므로
 * `carried_over` 보다 **앞에 와야 한다**) → 앵커보다 앞선 사후 기록(`carried_over`) →
 * 기록끼리의 순서(`out_of_order`) → `consistent`.
 */
// ※ `now` 를 받지 않는다 — 미래 시각 판정은 각 표지의 주인(§3-7 `future_end` 등)이 이미 한다.
//    같은 값을 두 곳에서 판정하면 두 판정이 갈라지고, 갈라진 쪽은 아무 응답도 바꾸지 않아 영구히 남는다.
export function assessTimeline(input?: { env?: Record<string, string | undefined> }): TimelineAssessment {
  const env = input?.env ?? {};
  const readings = readTimeline(env);
  const frozen = writeFreezeEnabled(env);

  const anchor = readings.find((r) => r.key === ANCHOR_ENV) ?? null;
  const anchorAt = anchor?.at ?? null;
  const presentRecords = readings.filter((r) => r.relation !== 'anchor' && r.present);
  const unreadableKeys = readings.filter((r) => r.unreadable).map((r) => r.key);
  const indistinguishable = readings
    .filter((r) => r.present && !r.unreadable && !(markerOf(r.key)?.detectable ?? false))
    .map((r) => r.key);

  const anchorMs = anchorAt === null ? null : Date.parse(anchorAt);

  // 앵커보다 앞선 **사후** 기록 — 이번 사건의 것일 수 없다. 기준점이 없으면 셀 수 없다.
  const carried =
    anchorMs === null
      ? []
      : presentRecords
          .filter((r) => r.relation === 'after_anchor' && r.at !== null && Date.parse(r.at) < anchorMs)
          .map((r) => r.key);

  const outOfOrder: OrderBreak[] = [];
  if (anchorMs !== null) {
    // T-ε 은 앵커보다 **앞**이어야 한다(구간의 시작이다). 뒤면 §3-7 `end_before_restore` 와 같은 어긋남이다.
    for (const r of presentRecords) {
      if (r.relation === 'before_anchor' && r.at !== null && Date.parse(r.at) > anchorMs) {
        outOfOrder.push({ earlier: r.key, later: ANCHOR_ENV });
      }
    }
  }
  // 사후 기록끼리 — 절차가 정한 순서(6-1 → 6-2 → 8단계 2번)대로 적혀야 한다.
  // 옛 값(`carried`)은 여기서 빼 둔다 — 그쪽은 순서 문제가 아니라 귀속 문제이고, 한 값이 두 번 걸리면
  // 「지우거나 다시 적는다」가 「순서를 다시 확인한다」로 덮인다.
  const after = presentRecords
    .filter((r) => r.relation === 'after_anchor' && r.at !== null && !carried.includes(r.key))
    .sort((a, b) => a.order - b.order);
  for (let i = 1; i < after.length; i += 1) {
    const prev = after[i - 1];
    const cur = after[i];
    if (Date.parse(cur.at as string) < Date.parse(prev.at as string)) {
      outOfOrder.push({ earlier: prev.key, later: cur.key });
    }
  }

  const unanchoredKeys = anchorAt === null ? presentRecords.map((r) => r.key) : [];
  const base = {
    frozen,
    anchorKey: ANCHOR_ENV,
    anchorAt,
    carried,
    outOfOrder,
    unanchoredKeys,
    unreadableKeys,
    recordCount: presentRecords.length,
    present: readings.filter((r) => r.present).map((r) => r.key),
    indistinguishable,
    caveats: TIMELINE_LIMITS,
  };

  if (!anchor?.present && presentRecords.length === 0) {
    return { ...base, verdict: 'absent', action: ACTION_TL_ABSENT };
  }
  if (unreadableKeys.length > 0) return { ...base, verdict: 'unreadable', action: ACTION_TL_UNREADABLE };
  if (unanchoredKeys.length > 0) return { ...base, verdict: 'unanchored', action: ACTION_TL_UNANCHORED };
  if (carried.length > 0) return { ...base, verdict: 'carried_over', action: ACTION_TL_CARRIED_OVER };
  if (outOfOrder.length > 0) return { ...base, verdict: 'out_of_order', action: ACTION_TL_OUT_OF_ORDER };
  return { ...base, verdict: 'consistent', action: ACTION_TL_CONSISTENT };
}

/* ─────────────────── 체크가 자기 자리에서 말하는 한 칸 ─────────────────── */

export const CORROBORATION_BASES = [
  'anchor',
  'absent',
  'unreadable',
  'unanchored',
  'carried_over',
  'indistinguishable',
  'unknown_key',
] as const;
export type CorroborationBasis = (typeof CORROBORATION_BASES)[number];

export interface MarkerCorroboration {
  key: string;
  /** 「이 값이 **이번 사건**의 기록이라고 말할 수 있는가」 — 수행 여부가 아니다 */
  corroborated: boolean;
  basis: CorroborationBasis;
  note: string;
}

const BASIS_NOTE: Record<CorroborationBasis, string> = {
  anchor: `이번 차단 시각(\`${ANCHOR_ENV}\`) 이후에 적힌 값이다 — 귀속을 말할 수 있다(수행 여부는 아니다)`,
  absent: '값이 들어 있지 않다 — 평상시 상태이고, 대조할 대상이 없다',
  unreadable: '값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 적는다(「없다」로 세지 않는다)',
  unanchored: `\`${ANCHOR_ENV}\` 가 없어 어느 사건의 기록인지 말할 수 없다 — 차단 중이면 **지금** 적는다(§3 2단계)`,
  carried_over:
    '차단 시각보다 **앞선** 값이다 — 이번 사건의 것일 수 없다. 지난 복구의 표지가 남았거나 ' +
    '타임존을 붙이지 않고 적은 값이다. **지우거나 다시 적은 뒤** 7단계로 간다(§3-14)',
  indistinguishable:
    '앵커와 대조해도 옛 값인지 **알 수 없는** 키다 — 정상값도 앵커보다 앞이다(§3-14 사각지대)',
  unknown_key: '정본(§3-14)에 없는 키다 — 표지를 새로 만들었으면 정본에 함께 등록한다',
};

/**
 * 한 표지에 대한 귀속 한 칸. 각 체크가 **자기 `detail` 안에서** 이 값을 함께 말한다 —
 * 새 체크를 만들지 않는 이유는 같은 국면을 이미 그 체크들이 보고하기 때문이다.
 */
export function markerCorroboration(key: unknown, a: TimelineAssessment): MarkerCorroboration {
  const k = String(key ?? '');
  const marker = markerOf(k);
  if (!marker) return { key: k, corroborated: false, basis: 'unknown_key', note: BASIS_NOTE.unknown_key };

  // 판정 순서: **들어 있지 않은 것**이 먼저다(평상시) → 못 읽는 값 → 옛 값 → 사각지대 →
  // 기준점 없음 → 귀속. 순서를 바꾸면 「앵커를 못 읽는 동안 들어 있는 기록」이 `absent`(= 「없다」)로
  // 보고되어, 비어 있는 것과 귀속을 말할 수 없는 것이 같은 말이 된다.
  let basis: CorroborationBasis;
  if (!a.present.includes(k)) basis = 'absent';
  else if (a.unreadableKeys.includes(k)) basis = 'unreadable';
  else if (a.carried.includes(k)) basis = 'carried_over';
  else if (a.indistinguishable.includes(k)) basis = 'indistinguishable';
  else if (a.anchorAt === null) basis = 'unanchored';
  else if (marker.relation === 'after_anchor') basis = 'anchor';
  else basis = 'indistinguishable';

  return { key: k, corroborated: basis === 'anchor', basis, note: BASIS_NOTE[basis] };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·키 이름·개수만 — **시각은 담지 않는다** */
export function timelineLine(a: TimelineAssessment): string {
  const parts = [
    `timeline=${a.verdict}`,
    `anchor=${a.anchorAt ? 'set' : 'unset'}`,
    `records=${a.recordCount}`,
    `frozen=${a.frozen}`,
  ];
  if (a.carried.length > 0) parts.push(`carried=${a.carried.join(',')}`);
  if (a.outOfOrder.length > 0) parts.push(`order=${a.outOfOrder.map((o) => `${o.earlier}>${o.later}`).join(',')}`);
  if (a.unanchoredKeys.length > 0) parts.push(`unanchored=${a.unanchoredKeys.join(',')}`);
  if (a.unreadableKeys.length > 0) parts.push(`unreadable=${a.unreadableKeys.join(',')}`);
  return `[timeline] ${parts.join(' ')}`;
}

/** 사람이 읽는 요약(§3-14 의 1줄 명령이 출력하는 것) */
export function timelineText(a: TimelineAssessment): string {
  const lines = [`[${a.verdict}] 앵커 ${a.anchorKey} = ${a.anchorAt ?? '(미설정)'} · 기록 표지 ${a.recordCount}건`];
  for (const k of a.carried) lines.push(`· 옛 사건의 기록: ${k} — ${markerOf(k)?.carryOver ?? ''}`);
  for (const o of a.outOfOrder) lines.push(`· 순서 어긋남: ${o.earlier} 가 ${o.later} 보다 뒤에 적혀 있다`);
  for (const k of a.unanchoredKeys) lines.push(`· 귀속 불가: ${k}`);
  for (const k of a.unreadableKeys) lines.push(`· 판독 불가: ${k}`);
  for (const k of a.indistinguishable) lines.push(`· 구분 불가(사각지대): ${k}`);
  lines.push(`→ ${a.action}`);
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/**
 * 공개 응답용 필터. **새로 시각을 노출하지 않는다** — 각 체크가 이미 자기 시각을 담고 있고,
 * 이 판정이 더하는 것은 판정·키 이름·개수뿐이다.
 */
export function publicTimeline(a: TimelineAssessment): {
  verdict: TimelineVerdict;
  anchorRecorded: boolean;
  recordCount: number;
  carried: string[];
  outOfOrder: string[];
  unanchored: string[];
  unreadable: string[];
  indistinguishable: string[];
  runbook: string;
} {
  return {
    verdict: a.verdict,
    anchorRecorded: a.anchorAt !== null,
    recordCount: a.recordCount,
    carried: a.carried,
    outOfOrder: a.outOfOrder.map((o) => `${o.earlier}>${o.later}`),
    unanchored: a.unanchoredKeys,
    unreadable: a.unreadableKeys,
    indistinguishable: a.indistinguishable,
    runbook: TIMELINE_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function timelineStatus(env: Record<string, string | undefined> = {}): {
  verdict: TimelineVerdict;
  anchorKey: string;
  markers: number;
  misreads: number;
  limits: number;
  action: string;
} {
  const a = assessTimeline({ env });
  return {
    verdict: a.verdict,
    anchorKey: ANCHOR_ENV,
    markers: TIMELINE_MARKERS.length,
    misreads: TIMELINE_MISREADS.length,
    limits: TIMELINE_LIMITS.length,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 앵커는 하나, 순서는 유일, 사각지대 선언이 빠지지 않았는지 */
export function auditTimelineRegistry(markers: readonly TimelineMarker[] = TIMELINE_MARKERS): string[] {
  const problems: string[] = [];
  const anchors = markers.filter((m) => m.relation === 'anchor');
  if (anchors.length !== 1) problems.push(`앵커가 ${anchors.length}건이다 — 귀속의 기준점은 하나여야 한다`);
  else if (anchors[0].key !== ANCHOR_ENV) problems.push(`앵커 키가 ${ANCHOR_ENV} 가 아니다`);
  else if (anchors[0].order !== 0) problems.push('앵커의 order 가 0 이 아니다');

  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const m of markers) {
    if (keys.has(m.key)) problems.push(`키가 중복이다: ${m.key}`);
    keys.add(m.key);
    if (orders.has(m.order)) problems.push(`order 가 중복이다: ${m.order}(${m.key})`);
    orders.add(m.order);
    if (!m.step.trim()) problems.push(`${m.key} 에 단계가 적혀 있지 않다`);
    if (!m.carryOver.trim()) problems.push(`${m.key} 에 옛 값일 때 생기는 일이 적혀 있지 않다`);
    if (m.relation !== 'after_anchor' && m.detectable) {
      problems.push(`${m.key} 는 앵커와 대조해 옛 값임을 말할 수 없는데 detectable: true 로 선언돼 있다`);
    }
  }
  for (const r of TIMELINE_MISREADS) {
    if (!keys.has(r.key)) problems.push(`거짓 판정 목록에 정본 밖 키가 있다: ${r.key}`);
  }
  return problems;
}

/** `src/lib/postRestoreSecurity.ts` 원문 — 귀속을 **응답에 실어 보내는지**까지 본다 */
export function auditSecurityWiring(src: unknown): string[] {
  return auditCheckWiring(src, 'postRestoreSecurity', 'SECURITY_REAPPLIED_ENV');
}

/** `src/lib/externalReconcile.ts` 원문 — 같은 점검 */
export function auditExternalWiring(src: unknown): string[] {
  return auditCheckWiring(src, 'externalReconcile', 'EXTERNAL_RECONCILED_ENV');
}

function auditCheckWiring(src: unknown, label: string, keyConst: string): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/incidentTimeline\.ts['"]/.test(s)) problems.push(`${label} 이 incidentTimeline 을 import 하지 않는다`);
  if (!/markerCorroboration\(/.test(s)) problems.push(`${label} 이 markerCorroboration() 을 호출하지 않는다`);
  else if (!new RegExp(`markerCorroboration\\(\\s*${keyConst}`).test(s)) {
    problems.push(`${label} 이 자기 표지 키(${keyConst})로 귀속을 묻지 않는다`);
  }
  if (!/recordCorroborated\s*:/.test(s)) problems.push(`${label} 이 recordCorroborated 를 detail 에 담지 않는다 — 판정만 하고 버린다`);
  if (!/recordBasis\s*:/.test(s)) problems.push(`${label} 이 recordBasis 를 detail 에 담지 않는다`);
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지** 본다.
 * 같은 국면을 이미 `checks.postRestoreSecurity`·`checks.externalState` 가 보고하므로
 * 체크를 하나 더 만들면 degraded 가 늘고 §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/incidentTimeline['"]/.test(s)) {
    problems.push('헬스 라우트가 incidentTimeline 을 직접 import 한다 — 판정은 기존 체크 안에서 말한다');
  }
  if (/checks\.incidentTimeline\s*=/.test(s)) problems.push('checks.incidentTimeline 이 새로 생겼다 — degraded 가 늘고 인용 정본이 갈라진다');
  return problems;
}

/** `RUNBOOK.md` 원문 — §3-14 와 그것을 가리키는 단계가 함께 남아 있는지 */
export function auditRunbookTimeline(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-14\./m.test(s)) problems.push('§3-14(표지의 귀속) 절이 없다');
  if (!/assessTimeline\(|timelineText\(/.test(s)) problems.push('§3-14 에 귀속 산출 명령이 없다');
  for (const v of TIMELINE_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-14 판정 표에 ${v} 행이 없다`);
  }
  for (const m of TIMELINE_MARKERS) {
    if (!new RegExp(m.key).test(s)) problems.push(`${m.key} 가 문서에 없다 — 복구 시 조용히 유실된다`);
  }
  if (!/recordCorroborated/.test(s)) {
    problems.push('문서가 recordCorroborated 를 가리키지 않는다 — 담당자가 읽을 자리가 없으면 판정이 응답에만 남는다');
  }

  // 8단계 4번이 **전건 삭제**를 지시하지 않으면 이 판정의 기준점이 영구히 남는다.
  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
  else {
    const i8 = sec3.search(/^8\.\s/m);
    const step8 = i8 < 0 ? '' : sec3.slice(i8).split(/\n>/)[0];
    if (!step8) problems.push('§3 8단계를 찾지 못했다');
    else {
      // 「전건」만 보면 8단계 2번의 「통로는 전건 수동이다」에 걸려 지시가 사라져도 통과한다.
      if (!/전건을?\s*지운다/.test(step8)) problems.push('8단계 4번이 표지 **전건** 삭제를 지시하지 않는다');
      if (!/3-14/.test(step8)) problems.push('8단계 4번이 §3-14 로 유도하지 않는다');
      for (const m of TIMELINE_MARKERS) {
        if (!new RegExp(m.key).test(step8)) problems.push(`8단계 4번이 ${m.key} 의 처분을 다루지 않는다`);
      }
    }
  }
  return problems;
}
