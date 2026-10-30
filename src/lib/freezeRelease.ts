/**
 * freezeRelease.ts — 절차가 **끝난 시각**은 어디에도 적히지 않는다(RUNBOOK §3-22). 2026-10-30
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3-7 은 2단계에서 차단이 **실효된** 시각을 기록 대상으로 승격시켰다 — 「해제한 뒤에는
 * 「차단이 걸려 있었다」는 사실조차 응답에 남지 않으므로 사람 기억으로 적게 된다」는 이유로,
 * 그리고 그 판정이 쓸모 있는 시점이 **차단이 걸려 있는 동안**이라는 이유로.
 *
 * **7단계(해제)에는 그 승격이 없다.** 7단계는 「`RECOVERY_WRITE_FREEZE` 를 지우고(또는 `false`)
 * 재배포한다」로 끝나고 확인은 `frozen` 이 `false` 인지뿐인데, 그 `false` 는 **평상시와 같은 값**이다.
 * 그런데 그 시각을 입력으로 쓰는 자리가 셋이다(`RELEASE_DEPENDENTS`) —
 *
 *  (1) **§6 표 `소요시간` 칸.** `incidentClosure.assessDuration` 의 끝이 이 시각이다. 그 칸은
 *      §1-2 가 **RTO 실측**으로 읽는 유일한 영구 기록인데(`recoveryObjectives` ·
 *      `ledgerPurpose.LEDGER_FIELDS.duration`), 두 끝(1단계 중단 결정 · 7단계 해제)은 **둘 다**
 *      인자다 — 표지도, 표의 칸도 없다. 즉 **약속을 지켰는지 말하는 수치의 두 끝이 기억에만 있다.**
 *  (2) **§3-9 대조 구간의 끝.** `externalReconcile` 은 `releasedAt` 을 받고 없으면
 *      `end_unrecorded` 다. 더 나쁜 것은 절차가 6-2단계를 **해제 전에** 하라고 지시한다는 점이다 —
 *      그래서 대조는 **언제나** 구간의 끝을 보지 못한 상태로 기록되고(그 모듈이 `future_end` 로
 *      적어 둔 바로 그 함정), `RECOVERY_EXTERNAL_RECONCILED_AT` 이 들어가는 순간
 *      `checks.externalState` 는 `recorded` 가 된다. 그 뒤 해제까지의 꼬리 구간에서 거절된 웹훅은
 *      **어떤 대조에도 들어가지 않는데, 그 사실을 말하는 응답이 하나도 없다.**
 *  (3) **「7단계를 수행했다」는 근거 자신.** 6-1·6-2·§3-5 보존·고지에는 전부 수행 시각 표지가
 *      있는데(§3-15·§3-14·§3-10) **해제에는 없다.** 해제를 잊으면 서비스가 읽기전용으로 남고
 *      (`checks.writeFreeze` 가 degraded 로만 말한다 — §2-2), 해제했으면 그 시각이 사라진다.
 *
 * 그리고 **하한을 알려 줄 수 있는 값은 「지워야 하는 값」이다** — 해제 - 차단실효 는 소요시간의
 * 하한이지만 그 기준점 `RECOVERY_WRITE_FREEZE_AT` 을 8단계 4번이 **지우라고 지시한다**(그 지시는
 * 옳다. §3-14). 지운 뒤에는 **평상시와 「마무리를 끝낸 뒤」가 글자 하나 다르지 않다.**
 *
 * 그래서 이 모듈은
 *   · 해제 시각을 입력으로 쓰는 자리를 **정본**으로 두고(`RELEASE_DEPENDENTS` — 그 값이 영구
 *     기록이 되는가 · 지금 어디서 오는가 · 언제 되찾을 수 없게 되는가),
 *   · 이미 들어 있는 표지만으로 해제 시각을 **구간으로 좁히고**(`bracketRelease` — 6-1·6-2 는
 *     해제 **전**, 고지는 해제 **뒤**라 두 쪽이 해제를 **괄호로 묶는다**),
 *   · 「적을 수 있는 유일한 시점」인 차단 중에 그 사실을 말하고(`frozen` · `captureDue`),
 *     표지를 지우기 전이 마지막 기회임을 말하고(`released_unrecorded` · `lastChance`),
 *   · **하한을 실측이라고 부르지 않는다**(`rtoQualified: 'floor'` — §6 표 `소요시간` 칸에
 *     하한을 적으면 §1-2 가 `met` 을 내는데, 실제 소요시간은 그보다 **길다**),
 *   · 거짓이 되는 판정 5건(`RELEASE_MISREADS`)과 사각지대(`RELEASE_BLIND_SPOTS`)를 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근(env 는 명시 인자로만). **신규 조회·쓰기·DDL 0 ·
 *   신규 런타임 체크 0 · 신규 사건 표지 0 · 신규 env 0** — 이미 있는 표지의 **시각**만 본다.
 * - **새 표지를 만들지 않는다.** 만들면 8단계 4번에서 지울 것이 하나 늘고, 하나만 남아도 다음
 *   사건이 그 시각을 「해제했다」는 근거로 물려받는다(§3-14). 달라지는 것은 **다음에 할 일**이다.
 * - **구분할 수 없는 것을 구분했다고 하지 않는다**: 표지를 전부 지운 뒤는 평상시와 같은 모습이라
 *   `not_applicable` 하나로 말하고, 어느 쪽인지는 §6 표를 읽어야 안다(런타임은 저장소를 읽지 않는다).
 * - **임의 수치 금지**: 해제 시각을 넘겨받지 못하면 지어내지 않는다 — `현재`로 대신하지도 않는다
 *   (늦게 산출할수록 커져 재현되지 않는다).
 */
import { parseInstant } from './incidentEvidence.ts';
import { ANCHOR_ENV, TIMELINE_MARKERS, readTimeline } from './incidentTimeline.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

const MS_MIN = 60_000;

/** 응답·문서에서 근거 문서를 찾을 수 있게 한다 */
export const RELEASE_RUNBOOK_REF = 'RUNBOOK §3-22·§3 7단계';

/* ───────────────── 해제 시각을 입력으로 쓰는 자리(정본) ───────────────── */

export type ReleaseDependentKey =
  | 'ledger_duration'
  | 'rto_attainment'
  | 'reconcile_window_end'
  | 'release_performed';

export interface ReleaseDependent {
  key: ReleaseDependentKey;
  /** 그 값을 쓰는 자리 */
  where: string;
  /** 무엇을 위해 쓰는가 */
  what: string;
  /** 그 결과가 **영구 기록**이 되는가 */
  durable: boolean;
  /** 지금 그 시각은 어디서 오는가 */
  nowFrom: string;
  /** 언제 되찾을 수 없게 되는가 */
  lostWhen: string;
}

/**
 * 해제 시각이 **없으면 성립하지 않는** 자리 전건. 전부 **인자**로 받는다 — 어느 쪽도
 * 표지·표 칸에서 가져오지 않는다(그래서 이 절이 있다).
 */
export const RELEASE_DEPENDENTS: readonly ReleaseDependent[] = [
  {
    key: 'ledger_duration',
    where: '§6 표 `소요시간` 칸(`incidentClosure.assessDuration` 의 `endedAt`)',
    what: '1단계 중단 결정 ~ 7단계 해제까지의 분. 사건 대응의 **유일한 영구 수치**다',
    durable: true,
    nowFrom: '사람 기억 — 표지도, 표의 칸도 없다(두 끝이 **둘 다** 인자다)',
    lostWhen: '해제한 순간. `frozen: false` 는 평상시와 같은 값이라 응답에서 되찾을 수 없다',
  },
  {
    key: 'rto_attainment',
    where: '§1-2 RTO 실측(`recoveryObjectives` — §6 표 `소요시간` 을 읽는다)',
    what: '약속한 복구시간을 지켰는지. `met`/`exceeded` 가 이 수치 하나로 갈린다',
    durable: true,
    nowFrom: '위 `ledger_duration` 그대로 — 하한을 적어도 숫자 모양이 같아 구분되지 않는다',
    lostWhen: '같다. 하한을 적으면 **지키지 못한 약속이 `met` 으로 굳는다**(되돌릴 근거가 없다)',
  },
  {
    key: 'reconcile_window_end',
    where: '§3-9 대조 구간의 끝(`externalReconcile.assessReconcileWindow` 의 `releasedAt`)',
    what: '차단 중 503 을 받은 웹훅까지 덮는 구간. 끝을 차단 시각으로 좁히면 그 몫이 빠진다',
    durable: false,
    nowFrom: '사람이 손으로 적어 넣는다 — 없으면 `end_unrecorded` 다',
    lostWhen:
      '절차가 6-2단계를 **해제 전에** 하라고 지시하므로 대조 시점에는 **아직 없다**(`future_end`) — ' +
      '해제 뒤에 다시 확정하지 않으면 꼬리 구간이 영구히 대조 밖이다',
  },
  {
    key: 'release_performed',
    where: '7단계 수행 근거(§3-14 가 다른 네 단계에 대해 만들어 둔 것)',
    what: '해제를 **했는지**. 6-1·6-2·보존·고지에는 전부 시각 표지가 있는데 해제에는 없다',
    durable: false,
    nowFrom: '없다 — `checks.writeFreeze.detail.frozen` 이 `false` 인 것은 평상시와 같다',
    lostWhen: '애초에 남지 않는다. 해제를 **잊은** 복구는 읽기전용 장애로만 드러난다(§2-2 가 적어 둔 degraded)',
  },
];

export function releaseDependentFor(key: unknown): ReleaseDependent | null {
  const k = String(key ?? '');
  return RELEASE_DEPENDENTS.find((d) => d.key === k) ?? null;
}

/* ─────────────── 표지가 해제를 괄호로 묶는다(정본) ─────────────── */

/** 해제 **전**에 적히는가 **뒤**에 적히는가. 절차가 그렇게 지시한다 */
export type ReleaseSide = 'before_release' | 'after_release';

export interface ReleaseBound {
  /** `incidentTimeline.TIMELINE_MARKERS` 의 키. 테스트가 양방향으로 대조한다 */
  key: string;
  side: ReleaseSide;
  /** 그렇게 단정할 수 있는 근거(절차의 문장) */
  why: string;
  /** §3-9 꼬리 구간의 **시작**인가(대조를 마친 시각) */
  tailStart?: true;
}

/**
 * 표지 여섯 건의 해제 기준 앞뒤. **새 표지를 만들지 않고** 해제 시각을 구간으로 좁히는 근거다.
 *
 * 앞쪽의 **가장 늦은** 시각과 뒤쪽의 **가장 이른** 시각이 해제를 괄호로 묶는다 —
 * 7단계는 「6-1단계 재적용을 마친 뒤에만, 그리고 6-2단계 대조를 마친 뒤에만」 해제하라 하고,
 * 8단계 2번 고지는 해제 **뒤**이기 때문이다.
 */
export const RELEASE_BOUNDS: readonly ReleaseBound[] = [
  {
    key: ANCHOR_ENV,
    side: 'before_release',
    why: '2단계 차단 실효 시각 — 해제는 그 차단을 푸는 일이므로 반드시 뒤다',
  },
  {
    key: 'RECOVERY_RESTORE_POINT',
    side: 'before_release',
    why: '3단계 복구 시점(T-ε). 차단보다도 앞이라 괄호를 좁히지는 못한다',
  },
  {
    key: 'RECOVERY_EVIDENCE_PRESERVED_AT',
    side: 'before_release',
    why: '§3-5 보존은 「차단을 확인한 직후」이고 3단계 전이다',
  },
  {
    key: 'RECOVERY_SECURITY_REAPPLIED_AT',
    side: 'before_release',
    why: '7단계가 「6-1단계 재적용을 마친 뒤에만」 해제하라고 지시한다 — 선행 조건이다',
  },
  {
    key: 'RECOVERY_EXTERNAL_RECONCILED_AT',
    side: 'before_release',
    why: '7단계가 「6-2단계 대조를 마친 뒤에만」 해제하라고 지시한다 — 선행 조건이다',
    tailStart: true,
  },
  {
    key: 'RECOVERY_LOSS_NOTICE_AT',
    side: 'after_release',
    why: '고지는 8단계 2번 — 7단계 해제 **뒤**다. 그래서 괄호의 **끝**이 된다',
  },
];

export function releaseBoundFor(key: unknown): ReleaseBound | null {
  const k = String(key ?? '');
  return RELEASE_BOUNDS.find((b) => b.key === k) ?? null;
}

/* ─────────────────── 거짓이 되는 판정(정본) ─────────────────── */

export interface ReleaseMisread {
  key: string;
  /** 그렇게 적었을 때 어느 판정이 무슨 말을 하게 되는가 */
  judgement: string;
  says: string;
  why: string;
}

export const RELEASE_MISREADS: readonly ReleaseMisread[] = [
  {
    key: 'floor_as_measurement',
    judgement: '§6 표 `소요시간` 에 `해제 - 차단실효` 를 적는다 → §1-2 `attainment.rto`',
    says: '`met` — 「약속한 복구시간 안에 끝냈다」',
    why:
      '그 값은 **하한**이다 — 1단계 중단 결정부터 차단까지(조사·범위 특정·승인·§3-21 하한 확인)가 ' +
      '빠져 있다. 실제 소요시간은 더 길고, 그래서 **지키지 못한 약속이 `met` 으로 굳는다**',
  },
  {
    key: 'now_as_release',
    judgement: '사후에 산출한 `현재 - 차단실효` 를 소요시간으로 적는다',
    says: '소요시간은 이만큼이다',
    why:
      '기록을 늦게 적을수록 커진다 — 재현되지 않고(§3-7 이 `lossMinutes` 를 고지 수치로 쓰지 말라고 ' +
      '적어 둔 것과 같은 결함), 교대로 붙는 사건 대응에서는 다음 사람이 적으면 몇 시간이 더해진다',
  },
  {
    key: 'freeze_at_as_release',
    judgement: '`RECOVERY_WRITE_FREEZE_AT` 을 해제 시각으로 쓴다 → §3-9 `assessReconcileWindow`',
    says: '대조 구간을 확정했다',
    why:
      '그것은 차단을 **건** 시각이다 — 차단 중에도 제공자는 웹훅을 보내고 503 을 받으므로 ' +
      '그 구간을 빼면 **재시도 만료분이 대조 대상에서 빠진다**(§3-9 가 `end_unrecorded` 로 거절하는 이유다)',
  },
  {
    key: 'saved_as_effective',
    judgement: '환경변수를 **지운(저장한)** 시각을 해제 시각으로 적는다',
    says: '이 시각에 쓰기가 다시 열렸다',
    why:
      'Vercel 환경변수는 **재배포 전까지 반영되지 않는다** — 저장과 실효 사이에는 쓰기가 아직 503 이고, ' +
      '그만큼 소요시간이 **짧게** 적힌다(§3-7 이 차단 쪽에 대해 적어 둔 것과 같은 함정이다)',
  },
  {
    key: 'reconciled_as_release',
    judgement: '`RECOVERY_EXTERNAL_RECONCILED_AT` 을 구간의 끝·소요시간의 끝으로 쓴다',
    says: '대조와 기록을 마쳤다',
    why:
      '절차가 6-2단계를 **해제 전에** 하라고 지시하므로 그 시각은 **언제나 해제보다 앞이다** — ' +
      '그 뒤 해제까지(꼬리 구간) 거절된 웹훅은 어떤 대조에도 들어가지 않는데 `checks.externalState` 는 `recorded` 다',
  },
];

/* ─────────────────────────── 사각지대 ─────────────────────────── */

export interface ReleaseBlindSpot {
  key: string;
  what: string;
  why: string;
}

export const RELEASE_BLIND_SPOTS: readonly ReleaseBlindSpot[] = [
  {
    key: 'release_is_not_observable',
    what: '해제가 **실효된** 순간을 코드가 본 적이 없다',
    why: '`frozen` 은 매 요청의 현재 값이라 바뀐 **시각**을 남기지 않는다 — 서버리스에 상태를 둘 자리가 없다',
  },
  {
    key: 'cleared_looks_like_normal',
    what: '8단계 4번을 마친 뒤는 **평상시와 구분되지 않는다**',
    why: '표지 여섯을 다 지우는 것이 옳기 때문이다(§3-14) — 그래서 판정은 `not_applicable` 하나로 말한다',
  },
  {
    key: 'bracket_needs_markers',
    what: '괄호는 **적혀 있는 표지만큼만** 좁혀진다',
    why: '6-1·6-2 를 거르고 고지를 적지 않으면 괄호가 열린 채 남는다 — 거른 단계가 많을수록 넓다',
  },
  {
    key: 'zoneless_shortens',
    what: '타임존 없이 넘긴 해제 시각은 UTC 로 읽혀 **이르게** 본다',
    why: 'KST 를 그대로 적으면 9시간 이르러 소요시간이 그만큼 짧아진다 — **약속을 지킨 쪽으로** 틀린다',
  },
  {
    key: 'partial_scope_release',
    what: '스코프를 하나만 풀면 `frozen` 이 **아직 true** 인데 해제한 줄 안다',
    why: '차단은 배포 스코프의 env 다(§3-13) — 이 판정은 **읽는 배포 자신의 env** 한 벌만 본다',
  },
  {
    key: 'start_has_no_home_either',
    what: '소요시간의 **시작**(1단계 중단 결정)도 적을 자리가 없다',
    why:
      '표지를 만들지 않았으므로 이 판정도 인자로만 받는다 — 넘겨받지 못하면 실측이 아니라 ' +
      '**하한**까지만 말한다(지어내지 않는다)',
  },
];

/** 이 판정이 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const RELEASE_LIMITS: readonly string[] = [
  '해제를 **했는지**는 말하지 않는다 — 말하는 것은 「그 시각을 적을 수 있는 상태인가」와 「넘겨받은 값이 정합인가」까지다',
  '`measured` 는 **두 끝이 서로 모순되지 않는다**는 뜻이고, 그 두 값이 실제 시각이라는 보증이 아니다(사람이 적는다)',
  '하한(`해제 - 차단실효`)을 §6 표 `소요시간` 에 적으면 §1-2 가 `met` 을 낸다 — `rtoQualified` 가 `floor` 면 **적지 않는다**',
  '괄호(`bracket`)는 표지가 적혀 있는 만큼만 좁다 — 거른 단계가 많을수록 넓고, 넓은 괄호를 「대략 맞다」로 읽지 않는다',
  '꼬리 구간(대조 ~ 해제)의 길이를 말해도 그 구간에 **몇 건의 웹훅이 거절됐는지**는 모른다(제공자 콘솔이 정본이다)',
  '읽는 배포 자신의 env 한 벌만 본다 — 다른 스코프에서 해제했는지는 보이지 않는다(§3-13)',
  '§6 표에 적혔는지는 **보지 않는다** — 런타임은 저장소 문서를 읽지 않는다(그 대조는 §1-2 저장소 명령·CI 가 한다)',
];

/* ─────────────────────── 해제 시각의 괄호 ─────────────────────── */

export const BRACKET_VERDICTS = ['bracketed', 'start_only', 'end_only', 'open', 'inverted'] as const;
export type BracketVerdict = (typeof BRACKET_VERDICTS)[number];

export interface ReleaseBracket {
  verdict: BracketVerdict;
  /** 해제가 **이 시각 뒤**다(해제 전에 적히는 표지 중 가장 늦은 것) */
  startAt: string | null;
  startKey: string | null;
  /** 해제가 **이 시각 앞**이다(해제 뒤에 적히는 표지 중 가장 이른 것) */
  endAt: string | null;
  endKey: string | null;
  /** 괄호의 폭(분). 한쪽이 없으면 null — 지어내지 않는다 */
  widthMinutes: number | null;
  /** 괄호를 좁히는 데 쓰인 표지 수 */
  used: number;
  note: string;
}

const BRACKET_NOTE: Record<BracketVerdict, string> = {
  bracketed: '적혀 있는 표지만으로 해제 시각이 두 값 **사이**임을 말할 수 있다 — 폭이 곧 모르는 만큼이다',
  start_only: '해제가 이 시각 **뒤**라는 것까지만 말할 수 있다(고지 시각이 없어 위쪽이 열려 있다)',
  end_only: '해제가 이 시각 **앞**이라는 것까지만 말할 수 있다(차단 시각이 없어 아래쪽이 열려 있다)',
  open: '괄호를 만들 표지가 없다 — 해제 시각에 대해 말할 수 있는 것이 없다',
  inverted:
    '괄호가 뒤집혔다(고지 시각이 선행 기록보다 앞이다) — 표지 중 하나가 옛 사건의 값이거나 ' +
    '타임존이 빠졌다(§3-14 `carried_over`·`out_of_order` 를 함께 본다)',
};

/**
 * 이미 들어 있는 표지만으로 해제 시각을 구간으로 좁힌다. **새 표지를 만들지 않는 대신** 이것이
 * 할 수 있는 전부다 — 폭이 곧 「모르는 만큼」이고, 거른 단계가 많을수록 넓다.
 */
export function bracketRelease(env: Record<string, string | undefined> = {}): ReleaseBracket {
  const readings = readTimeline(env);
  let startAt: string | null = null;
  let startKey: string | null = null;
  let endAt: string | null = null;
  let endKey: string | null = null;
  let used = 0;

  for (const r of readings) {
    const bound = releaseBoundFor(r.key);
    if (!bound || !r.present || r.at === null) continue;
    used += 1;
    const ms = Date.parse(r.at);
    if (bound.side === 'before_release') {
      // 가장 **늦은** 선행 기록이 아래쪽 경계다.
      if (startAt === null || ms > Date.parse(startAt)) {
        startAt = r.at;
        startKey = r.key;
      }
    } else if (endAt === null || ms < Date.parse(endAt)) {
      // 가장 **이른** 후행 기록이 위쪽 경계다.
      endAt = r.at;
      endKey = r.key;
    }
  }

  let verdict: BracketVerdict;
  let widthMinutes: number | null = null;
  if (startAt !== null && endAt !== null) {
    const w = Date.parse(endAt) - Date.parse(startAt);
    // 음수 폭을 0 으로 깎아 「거의 안다」로 만들지 않는다 — 뒤집힌 것은 표지가 어긋난 것이다.
    if (w < 0) verdict = 'inverted';
    else {
      verdict = 'bracketed';
      widthMinutes = Math.round(w / MS_MIN);
    }
  } else if (startAt !== null) verdict = 'start_only';
  else if (endAt !== null) verdict = 'end_only';
  else verdict = 'open';

  return { verdict, startAt, startKey, endAt, endKey, widthMinutes, used, note: BRACKET_NOTE[verdict] };
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export const RELEASE_VERDICTS = [
  'measured',
  'floor_only',
  'frozen',
  'released_unrecorded',
  'invalid_release',
  'invalid_record',
  'release_before_freeze',
  'future_release',
  'not_applicable',
] as const;
export type ReleaseVerdict = (typeof RELEASE_VERDICTS)[number];

/** §6 표 `소요시간` 칸에 적을 **자격**. `floor` 를 적으면 §1-2 가 거짓 `met` 을 낸다 */
export type RtoQualification = 'measurement' | 'floor' | 'none';

export interface ReleaseAssessment {
  verdict: ReleaseVerdict;
  /** 이 배포가 아직 차단 중인가 */
  frozen: boolean;
  /** 차단 실효 시각(= 하한의 기준점). 미설정·판독 실패면 null */
  anchorAt: string | null;
  /** 넘겨받은 해제 시각(ISO). 없으면 null — 지어내지 않는다 */
  releasedAt: string | null;
  /** 넘겨받은 1단계 중단 결정 시각(ISO). 쓸 수 없으면 null */
  startedAt: string | null;
  /** 넘겨받은 시작 시각을 **쓰지 않은** 이유 */
  startRejected: 'unreadable' | 'after_freeze' | null;
  /** 소요시간의 **하한**(해제 - 차단실효, 분). 산출 불가면 null */
  durationFloorMinutes: number | null;
  /** 소요시간 **실측**(해제 - 중단 결정, 분). 두 끝이 다 있을 때만 */
  durationMinutes: number | null;
  /** 차단 실효 뒤 지금까지(분) — 참고용. 소요시간으로 쓰지 않는다 */
  elapsedMinutes: number | null;
  /** §6 표 `소요시간` 칸에 적을 자격 */
  rtoQualified: RtoQualification;
  /** `assessDuration` 에 그대로 넘길 두 끝 — 수치 계산을 복제하지 않는다 */
  durationInput: { startedAt: string | null; endedAt: string | null };
  /** 지금이 해제 시각을 적을 수 있는 시점인가(= 아직 해제 전) */
  captureDue: boolean;
  /** 표지를 지우면 하한조차 산출할 수 없게 되는 상태인가 */
  lastChance: boolean;
  /** §3-9 꼬리 구간(대조 ~ 해제, 분). 산출 불가면 null */
  tailMinutes: number | null;
  /** 대조는 기록됐는데 꼬리 구간이 **아직 확정되지 않았다** */
  tailOpen: boolean;
  bracket: ReleaseBracket;
  actionable: boolean;
  action: string;
  caveats: readonly string[];
}

export const ACTION_RELEASE_FROZEN =
  '아직 차단 중이다 — **해제하는 순간**(`checks.writeFreeze.detail.frozen` 이 `false` 로 바뀐 것을 확인한 ' +
  '시각. 환경변수를 지운 시각이 아니다) 그 시각을 적어 두고, 8단계 3번에서 1단계 중단 결정 시각과 함께 ' +
  '§6 표 `소요시간` 을 산출한다. 두 값은 **비고 칸**에 함께 적는다 — 표지도 전용 칸도 없으므로 ' +
  '지금이 남길 수 있는 유일한 자리다. 해제 뒤에 §3-9 대조를 **꼬리 구간만** 한 번 더 한다';

export const ACTION_RELEASE_UNRECORDED =
  '차단은 풀렸는데 해제 시각이 어디에도 없다 — **표지를 지우기 전이 마지막 기회다.** 배포 로그· ' +
  '`/api/health` 응답 보관본·재배포 시각에서 `frozen` 이 `false` 로 바뀐 시각을 찾아 §6 표 비고에 적는다. ' +
  '찾을 수 없으면 **수치를 지어내지 말고** 아래 괄호(`bracket`)를 범위로 적고, `소요시간` 칸은 ' +
  '`[확인 필요]` 로 남긴다(하한을 적으면 §1-2 가 거짓 `met` 을 낸다)';

export const ACTION_RELEASE_MEASURED =
  '두 끝이 모두 있다 — `assessDuration({startedAt, endedAt})` 으로 §6 표 `소요시간` 을 산출하고 ' +
  '§1-2 명령으로 RTO 와 견준다. 초과분은 **깎지 않는다**';

export const ACTION_RELEASE_FLOOR_ONLY =
  '해제 시각은 있는데 **1단계 중단 결정 시각이 없다** — 산출되는 값은 소요시간의 **하한**이다. ' +
  '`소요시간` 칸에 그대로 적으면 §1-2 가 거짓 `met` 을 낼 수 있으므로, 중단 결정 시각을 찾아 ' +
  '넘기거나(감사로그·사건 채널의 첫 메시지) 칸에 **하한임을 함께 적는다**';

export const ACTION_RELEASE_INVALID_RELEASE =
  '넘겨받은 해제 시각을 읽을 수 없다 — `2026-10-30T15:40:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 ' +
  '적는다(타임존을 빼면 UTC 로 읽혀 소요시간이 9시간 짧아진다 = 약속을 지킨 쪽으로 틀린다)';

export const ACTION_RELEASE_INVALID_RECORD =
  `\`${ANCHOR_ENV}\` 값을 읽을 수 없다 — 하한의 **기준점**이 없으므로 소요시간을 하한으로도 말할 수 없다. ` +
  '타임존을 붙인 ISO 시각으로 다시 넣는다(§3-7)';

export const ACTION_RELEASE_BEFORE_FREEZE =
  '해제 시각이 차단 실효 시각보다 **앞이다** — 정상적으로는 일어나지 않는다. 두 값을 다시 확인한다 ' +
  '(타임존 누락이 제1 용의자다). 음수 구간을 0 으로 바꿔 「즉시 복구」로 적지 않는다';

export const ACTION_RELEASE_FUTURE =
  '해제 시각이 현재보다 미래다 — 오타이거나 타임존을 잘못 붙였다. 아직 해제하지 않았다면 ' +
  '**지금 확정하지 않는다**(그 뒤 거절되는 웹훅이 §3-9 대조에서 빠진다)';

export const ACTION_RELEASE_NOT_APPLICABLE =
  '평상시다 — 표지가 하나도 없다. 다만 **8단계 4번을 마친 뒤도 같은 모습**이라, 지난 사건의 소요시간이 ' +
  '§6 표에 적혔는지는 이 응답으로 알 수 없다(§1-2 저장소 명령으로 표를 본다)';

export const CAVEAT_FLOOR_IS_NOT_MEASUREMENT =
  '하한은 **실측이 아니다** — 1단계 중단 결정부터 차단까지(조사·범위 특정·§3-21 하한 확인·승인)가 빠져 있다. ' +
  '§6 표 `소요시간` 은 §1-2 가 RTO 실측으로 읽는 칸이므로 하한을 그대로 적으면 약속 초과가 `met` 으로 굳는다';

export const CAVEAT_RELEASE_HAS_NO_MARKER =
  '해제 시각에는 표지가 **없다(일부러 만들지 않았다)** — 만들면 8단계 4번에서 지울 것이 하나 늘고, ' +
  '하나만 남아도 다음 사건이 그 시각을 「해제했다」는 근거로 물려받는다(§3-14). 자리는 §6 표 비고다';

export const CAVEAT_TAIL_IS_UNRECONCILED =
  '6-2단계 대조는 절차상 **해제 전**이므로 대조 ~ 해제 구간에서 거절된 웹훅은 어떤 대조에도 들어가지 않는다 — ' +
  '해제 뒤에 그 구간만 한 번 더 대조한다(§3-9. 그 사실을 §6 표 비고에 적는다)';

export const CAVEAT_SCOPE_ONLY =
  '이 배포의 env 한 벌만 본다 — 다른 스코프의 차단이 아직 걸려 있는지는 보이지 않는다(§3-13)';

/**
 * 7단계 해제 시각을 **적을 수 있는 상태인가**, 넘겨받은 값으로 소요시간을 **실측이라 부를 수
 * 있는가**를 판정한다.
 *
 * 판정 순서가 보호 장치다 — 못 읽는 값(`invalid_*`)을 「없다」로 세지 않고, **차단 중**을
 * 측정보다 앞에 둔다(아직 끝나지 않은 절차의 끝을 확정하면 §3-9 꼬리가 빠진다). `not_applicable`
 * 은 **맨 뒤**이고 「통과」가 아니라 「말할 것이 없다」는 뜻이다.
 */
export function assessFreezeRelease(args?: {
  env?: Record<string, string | undefined>;
  /** 7단계 해제가 **실효된** 시각(사람이 넘긴다 — 표지를 만들지 않았다) */
  releasedAt?: unknown;
  /** 1단계 중단 결정 시각(사람이 넘긴다) */
  startedAt?: unknown;
  now?: Date;
}): ReleaseAssessment {
  const env = args?.env ?? {};
  const now = args?.now ?? new Date();
  const frozen = writeFreezeEnabled(env);
  const bracket = bracketRelease(env);

  const readings = readTimeline(env);
  const anchor = readings.find((r) => r.key === ANCHOR_ENV) ?? null;
  const anchorAt = anchor?.at ?? null;
  const anchorUnreadable = anchor?.unreadable ?? false;
  const tailStartKey = RELEASE_BOUNDS.find((b) => b.tailStart)?.key ?? null;
  const tailStart = readings.find((r) => r.key === tailStartKey) ?? null;
  const tailStartAt = tailStart?.at ?? null;

  const rawRelease = String(args?.releasedAt ?? '').trim();
  const releaseDate = rawRelease ? parseInstant(rawRelease) : null;
  const releasedAt = releaseDate ? releaseDate.toISOString() : null;

  const rawStart = String(args?.startedAt ?? '').trim();
  const startDate = rawStart ? parseInstant(rawStart) : null;
  let startedAt = startDate ? startDate.toISOString() : null;
  let startRejected: ReleaseAssessment['startRejected'] = null;
  if (rawStart && !startDate) startRejected = 'unreadable';
  // 중단 결정(1단계)은 차단(2단계)보다 **앞이어야** 한다 — 뒤면 그 값으로 실측을 만들지 않는다.
  if (startedAt !== null && anchorAt !== null && Date.parse(startedAt) > Date.parse(anchorAt)) {
    startRejected = 'after_freeze';
    startedAt = null;
  }

  const anchorMs = anchorAt === null ? null : Date.parse(anchorAt);
  const releaseMs = releasedAt === null ? null : Date.parse(releasedAt);
  const minutesBetween = (from: number | null, to: number | null): number | null =>
    from === null || to === null || to < from ? null : Math.round((to - from) / MS_MIN);

  const durationFloorMinutes = minutesBetween(anchorMs, releaseMs);
  const durationMinutes = startedAt === null ? null : minutesBetween(Date.parse(startedAt), releaseMs);
  const elapsedMinutes = minutesBetween(anchorMs, now.getTime());
  const tailMinutes = minutesBetween(tailStartAt === null ? null : Date.parse(tailStartAt), releaseMs);

  let verdict: ReleaseVerdict;
  if (anchorUnreadable) verdict = 'invalid_record';
  else if (rawRelease && !releaseDate) verdict = 'invalid_release';
  else if (releaseMs !== null && anchorMs !== null && releaseMs < anchorMs) verdict = 'release_before_freeze';
  else if (releaseMs !== null && releaseMs > now.getTime()) verdict = 'future_release';
  else if (frozen) verdict = 'frozen';
  else if (releaseMs !== null) verdict = durationMinutes !== null ? 'measured' : 'floor_only';
  else if (anchorMs !== null || bracket.used > 0) verdict = 'released_unrecorded';
  else verdict = 'not_applicable';

  const rtoQualified: RtoQualification =
    verdict === 'measured' ? 'measurement' : verdict === 'floor_only' ? 'floor' : 'none';

  const ACTIONS: Record<ReleaseVerdict, string> = {
    measured: ACTION_RELEASE_MEASURED,
    floor_only: ACTION_RELEASE_FLOOR_ONLY,
    frozen: ACTION_RELEASE_FROZEN,
    released_unrecorded: ACTION_RELEASE_UNRECORDED,
    invalid_release: ACTION_RELEASE_INVALID_RELEASE,
    invalid_record: ACTION_RELEASE_INVALID_RECORD,
    release_before_freeze: ACTION_RELEASE_BEFORE_FREEZE,
    future_release: ACTION_RELEASE_FUTURE,
    not_applicable: ACTION_RELEASE_NOT_APPLICABLE,
  };

  const caveats: string[] = [CAVEAT_RELEASE_HAS_NO_MARKER, CAVEAT_SCOPE_ONLY];
  if (rtoQualified !== 'measurement') caveats.unshift(CAVEAT_FLOOR_IS_NOT_MEASUREMENT);
  if (tailStartAt !== null && tailMinutes === null) caveats.push(CAVEAT_TAIL_IS_UNRECONCILED);

  return {
    verdict,
    frozen,
    anchorAt,
    releasedAt,
    startedAt,
    startRejected,
    durationFloorMinutes,
    durationMinutes,
    elapsedMinutes,
    rtoQualified,
    // 수치 계산은 §3-7 `assessDuration` 이 주인이다 — 그쪽에 그대로 넘길 두 끝만 만들어 준다.
    durationInput: { startedAt, endedAt: releasedAt },
    captureDue: verdict === 'frozen',
    lastChance: verdict === 'released_unrecorded',
    tailMinutes,
    tailOpen: tailStartAt !== null && tailMinutes === null,
    bracket,
    // 평상시·실측에는 할 일이 없다 — 상시로 할 일을 내보내면 다음 사건에서 아무도 읽지 않는다.
    actionable: verdict !== 'not_applicable' && verdict !== 'measured',
    action: ACTIONS[verdict],
    caveats,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function freezeReleaseStatus(args?: {
  env?: Record<string, string | undefined>;
  releasedAt?: unknown;
  startedAt?: unknown;
  now?: Date;
}): {
  verdict: ReleaseVerdict;
  rtoQualified: RtoQualification;
  bracket: BracketVerdict;
  dependents: number;
  limits: number;
  note: string;
} {
  const a = assessFreezeRelease(args);
  return {
    verdict: a.verdict,
    rtoQualified: a.rtoQualified,
    bracket: a.bracket.verdict,
    dependents: RELEASE_DEPENDENTS.length,
    limits: RELEASE_LIMITS.length,
    note: a.action,
  };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄 — 판정·수치만(연락처·행 수·설정값 없음) */
export function releaseLine(a: ReleaseAssessment): string {
  const parts = [`verdict=${a.verdict}`, `rto=${a.rtoQualified}`, `bracket=${a.bracket.verdict}`];
  if (a.durationMinutes !== null) parts.push(`duration_min=${a.durationMinutes}`);
  if (a.durationFloorMinutes !== null) parts.push(`floor_min=${a.durationFloorMinutes}`);
  if (a.bracket.widthMinutes !== null) parts.push(`bracket_min=${a.bracket.widthMinutes}`);
  if (a.tailMinutes !== null) parts.push(`tail_min=${a.tailMinutes}`);
  if (a.tailOpen) parts.push('tail=open');
  if (a.captureDue) parts.push('capture=due');
  if (a.lastChance) parts.push('last_chance=true');
  return `[freeze-release] ${parts.join(' ')}`;
}

/** 사람이 읽을 요약 — 한 문단 */
export function releaseText(a: ReleaseAssessment): string {
  const parts: string[] = [`해제 시각 판정 = ${a.verdict}`];
  if (a.durationMinutes !== null) parts.push(`소요시간 ${a.durationMinutes}분(실측)`);
  else if (a.durationFloorMinutes !== null) parts.push(`소요시간 하한 ${a.durationFloorMinutes}분(**실측이 아니다**)`);
  else parts.push('소요시간을 산출할 수 없다');
  if (a.bracket.verdict === 'bracketed') parts.push(`해제는 ${a.bracket.startAt} ~ ${a.bracket.endAt} 사이(폭 ${a.bracket.widthMinutes}분)`);
  else parts.push(`괄호 ${a.bracket.verdict}`);
  if (a.tailOpen) parts.push('※ 대조 ~ 해제 꼬리 구간이 확정되지 않았다');
  const text = `${parts.join('. ')}.`;
  return `${text}\n→ ${a.action}`;
}

/**
 * 공개 필터 — **시각 좌표를 담지 않는다.** 차단·해제 시각은 그 구간의 쓰기를 노리는 데 쓰일 수
 * 있는 값이라(§2-3) 무인증으로 나갈 수 있는 모양에는 넣지 않는다. 길이(분)만 담는다.
 */
export function publicRelease(a: ReleaseAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    rtoQualified: a.rtoQualified,
    captureDue: a.captureDue,
    lastChance: a.lastChance,
    bracketVerdict: a.bracket.verdict,
    bracketWidthMinutes: a.bracket.widthMinutes,
    tailOpen: a.tailOpen,
    ref: RELEASE_RUNBOOK_REF,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 사유 없는 선언을 두지 않고, 표지 목록과 **양방향**으로 맞는지 */
export function auditReleaseCanon(
  dependents: readonly ReleaseDependent[] = RELEASE_DEPENDENTS,
  bounds: readonly ReleaseBound[] = RELEASE_BOUNDS,
  misreads: readonly ReleaseMisread[] = RELEASE_MISREADS,
  blindSpots: readonly ReleaseBlindSpot[] = RELEASE_BLIND_SPOTS,
  markers: readonly { key: string }[] = TIMELINE_MARKERS,
): string[] {
  const problems: string[] = [];

  if (dependents.length === 0) problems.push('해제 시각을 쓰는 자리가 정본에서 사라졌다');
  for (const d of dependents) {
    if (!d.where.trim() || !d.what.trim() || !d.nowFrom.trim() || !d.lostWhen.trim()) {
      problems.push(`의존처 ${d.key} 에 빈 칸이 있다`);
    }
  }
  if (!dependents.some((d) => d.durable)) {
    problems.push('영구 기록이 되는 의존처가 사라졌다 — 그러면 이 절이 지키려는 것이 없다(§6 표 소요시간·§1-2 RTO 실측)');
  }

  // 표지 여섯이 **전건** 앞뒤로 분류돼 있는지. 새 표지가 생기면 분류될 때까지 CI 가 막는다.
  const boundKeys = new Set(bounds.map((b) => b.key));
  for (const m of markers) {
    if (!boundKeys.has(m.key)) problems.push(`표지 ${m.key} 가 해제 기준 앞뒤로 분류되지 않았다 — 괄호가 조용히 틀어진다`);
  }
  const markerKeys = new Set(markers.map((m) => m.key));
  for (const b of bounds) {
    if (!markerKeys.has(b.key)) problems.push(`유령 표지 ${b.key} — 표지 정본에 없는 키다`);
    if (!b.why.trim()) problems.push(`앞뒤 분류 ${b.key} 에 근거가 없다`);
  }
  if (!bounds.some((b) => b.side === 'after_release')) {
    problems.push('해제 **뒤**에 적히는 표지가 없다 — 괄호의 위쪽이 영구히 열린다');
  }
  if (bounds.filter((b) => b.tailStart).length !== 1) {
    problems.push('§3-9 꼬리 구간의 시작 표지가 정확히 하나가 아니다');
  }

  const keys = new Set<string>();
  for (const m of misreads) {
    if (!m.key.trim() || !m.judgement.trim() || !m.says.trim() || !m.why.trim()) problems.push(`거짓 판정 ${m.key} 에 빈 칸이 있다`);
    if (keys.has(m.key)) problems.push(`거짓 판정 키가 겹친다: ${m.key}`);
    keys.add(m.key);
  }
  if (!misreads.some((m) => m.key === 'floor_as_measurement')) {
    problems.push('`floor_as_measurement`(하한을 실측으로 적는다)가 목록에서 사라졌다 — 거짓 `met` 이 다시 열린다');
  }
  if (!misreads.some((m) => m.key === 'reconciled_as_release')) {
    problems.push('`reconciled_as_release`(대조 시각을 해제 시각으로 쓴다)가 목록에서 사라졌다 — 꼬리 구간이 조용히 빠진다');
  }
  for (const b of blindSpots) {
    if (!b.what.trim() || !b.why.trim()) problems.push(`사각지대 ${b.key} 에 빈 칸이 있다`);
  }
  return problems;
}

/**
 * 이 모듈이 **순수한지**와 판독을 **복제하지 않았는지**. 복제하면 갈라진 쪽이 아무 응답도
 * 바꾸지 않으므로 영구히 남는다(§3-20·§3-21 `auditSelfSource` 와 같은 규율).
 */
export function auditSelfSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다 — env 는 명시 인자로만 받는다');
  if (/from\s+['"]\.\/(db|migrate)/.test(s)) problems.push('DB 모듈을 import 한다 — 신규 조회 0 이어야 한다');
  if (/from\s+['"]next/.test(s) || /from\s+['"]node:fs['"]/.test(s)) problems.push('next·fs 를 import 한다 — 순수 모듈이 아니다');
  if (!/from\s+['"]\.\/incidentTimeline\.ts['"]/.test(s)) {
    problems.push('표지 판독(`readTimeline`)을 재사용하지 않는다 — 표지 판독 규칙이 갈라진다');
  }
  if (!/from\s+['"]\.\/incidentEvidence\.ts['"]/.test(s)) {
    problems.push('시각 판독(`parseInstant`)을 재사용하지 않는다 — 엄격 파서가 갈라진다');
  }
  if (!/from\s+['"]\.\/writeFreeze\.ts['"]/.test(s)) {
    problems.push('차단 스위치 판독(`writeFreezeEnabled`)을 재사용하지 않는다 — 느슨한 판독이 생긴다');
  }
  // 모듈 안에서 현재 시각을 집어오면 판정이 재현되지 않는다 — `now` 는 인자로만 받는다.
  if (/[Dd]ate\s*\.\s*now\s*\(/.test(s)) problems.push('현재 시각을 모듈 안에서 집어온다 — `now` 는 인자로 받는다');
  return problems;
}

/**
 * **신규 env 0 · 신규 사건 표지 0** — 이 모듈이 들고 있는 `RECOVERY_*` 키가 **이미 있는 것**뿐인지
 * 전수로 본다. 해제 시각용 키를 새로 만들면 8단계 4번에서 지울 것이 하나 늘고, **하나만 남아도**
 * 다음 사건이 그 시각을 「해제했다」는 근거로 물려받는다(§3-14).
 */
export function auditNoNewEnv(
  src: unknown,
  allowed: readonly string[] = [...TIMELINE_MARKERS.map((m) => m.key), WRITE_FREEZE_ENV],
): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다');
  if (/\benv\.[A-Z][A-Z0-9_]+/.test(s)) problems.push('env 키를 직접 읽는다 — 판독은 readTimeline·writeFreezeEnabled 를 쓴다');
  if (/\benv\[['"]/.test(s)) problems.push('env 키를 간접으로 읽는다');
  const known = new Set(allowed);
  for (const found of new Set(s.match(/RECOVERY_[A-Z0-9_]+/g) ?? [])) {
    if (!known.has(found)) {
      problems.push(`새 복구용 키 ${found} 를 들고 있다 — 표지가 늘면 8단계 4번에서 지울 것이 늘고, 하나만 남아도 다음 사건이 물려받는다(§3-14)`);
    }
  }
  return problems;
}

/**
 * **신규 런타임 체크 0** — 해제 시각은 평상시에 **없는 것이 정상**이라 체크를 만들면 전 배포가
 * 상시 `not_applicable` 만 내보낸다(§2-2). 판정은 `checks.incidentClosure` 안에서 말한다 —
 * 그 체크가 차단 시각(= 하한의 기준점)과 §6 표 기록의 주인이고 쓸모 있는 시점도 같다.
 */
export function auditNoNewHealthCheck(healthSrc: unknown): string[] {
  const s = String(healthSrc ?? '');
  return /checks\.freezeRelease/.test(s)
    ? ['`/api/health` 에 freezeRelease 체크가 생겼다 — 평상시 `not_applicable` 만 내보내는 체크가 하나 늘었다(§3-22 는 checks.incidentClosure 안에서 말한다)']
    : [];
}

/**
 * `incidentClosure.ts` 원문 점검 — 판정이 **응답에 실려 있는지**와 소요시간 계산의 주인이
 * 그대로인지. 판정만 하고 버리면 아무도 읽지 않고, 응답은 그대로 200 이라 사람 눈으로는
 * 알아챌 수 없는 회귀다.
 */
export function auditClosureWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/freezeRelease\.ts['"]/.test(s)) problems.push('freezeRelease 를 import 하지 않는다');
  if (!/assessFreezeRelease\(/.test(s)) problems.push('assessFreezeRelease() 를 호출하지 않는다');
  else if (!/releaseVerdict:\s*release\.verdict/.test(s)) {
    problems.push('판정을 detail.releaseVerdict 로 내보내지 않는다 — 판정만 하고 버린다');
  }
  if (!/releaseRtoQualified:\s*release\.rtoQualified/.test(s)) {
    problems.push('`rtoQualified` 를 응답에서 빼먹었다 — 하한을 실측으로 적는 길이 다시 열린다');
  }
  if (!/export\s+function\s+assessDuration/.test(s)) {
    problems.push('소요시간 계산(`assessDuration`)이 §3-7 쪽에서 사라졌다 — 계산의 주인이 바뀌면 두 수치가 갈라진다');
  }
  return problems;
}

/** 실제 `RUNBOOK.md` 점검 — 절·판정 표·유도·체크리스트가 남아 있는지 */
export function auditRunbookRelease(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*3-22\./m.test(s)) problems.push('RUNBOOK 에 §3-22 소절이 없다 — 판정의 근거 절이 사라졌다');
  for (const v of RELEASE_VERDICTS) {
    if (!s.includes(`\`${v}\``)) problems.push(`§3-22 판정 표에 \`${v}\` 가 없다`);
  }
  for (const m of RELEASE_MISREADS) {
    if (!s.includes(`\`${m.key}\``)) problems.push(`§3-22 가 거짓이 되는 판정 \`${m.key}\` 를 적지 않는다`);
  }
  if (!/assessFreezeRelease\(/.test(s)) problems.push('§3-22 에 산출 명령이 없다 — 판정에 닿을 수단이 문서에 없다');

  // 7단계가 「해제 시각을 적는다」로 유도하는지. 거기가 유일하게 적을 수 있는 시점이다.
  const s7 = s.indexOf('7. **쓰기 차단 해제**');
  const s8 = s.indexOf('8. **사후**');
  const step7 = s7 >= 0 && s8 > s7 ? s.slice(s7, s8) : '';
  if (!step7) problems.push('§3 7단계 본문을 찾을 수 없다');
  else if (!step7.includes('3-22')) {
    problems.push('§3 7단계가 3-22 로 유도하지 않는다 — 해제 시각을 적으라고 말하는 자리가 없어진다(해제 뒤에는 되찾을 수 없다)');
  }

  // 8단계 4번(표지 삭제)보다 **앞에** 소요시간 기록이 있는지 — 기준점을 지우면 하한조차 못 낸다.
  const s3 = s.indexOf('8. **사후**');
  const end = s.indexOf('### 3-1.');
  const step8 = s3 >= 0 && end > s3 ? s.slice(s3, end) : '';
  if (!step8) problems.push('§3 8단계 본문을 찾을 수 없다');
  else if (!step8.includes('3-22')) {
    problems.push('§3 8단계가 3-22 로 유도하지 않는다 — 표지를 지운 뒤에는 소요시간을 하한으로도 산출할 수 없다');
  }
  return problems;
}
