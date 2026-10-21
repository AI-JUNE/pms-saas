/**
 * rehearsalKind.ts — 「연습」과 「사건」의 구분(RUNBOOK §6·§6-6). 2026-10-21
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6 표의 둘째 열은 **`유형(정기/사건)`** 이고 같은 값을 `RECOVERY_LAST_REHEARSAL_KIND` 에도
 * 적는다. `lib/recovery.ts` 는 그것을 표·env 양쪽에서 `normalizeKind` 로 **받아 적고 있다**
 * (`RehearsalKind = periodic | incident | unknown`). 그런데 **그 칸을 읽는 판정이 하나도
 * 없었다** — §6-4 기록 정본은 그 사실을 `judgedBy: null` 로 스스로 적어 두었다. 그래서 「절차를
 * 검증한 연습」과 「실제로 일어난 사건」이 전 판정에서 **같은 말**로 취급됐다.
 *
 *  (1) **기한이 사건으로 리셋된다.** `rehearsalFreshness` 는 일자·결과만 본다. §3 8단계가
 *      지시하는 대로 사건 복구를 기록하면 `ageDays` 가 0 이 되고 `dueDate` 가 밀려
 *      `checks.recovery` 는 `ok` 다 — **정기 리허설을 한 번도 하지 않아도** 사건이 날 때마다
 *      「검증됐다」가 유지된다. 그런데 §6 머리말은 리허설을 「운영 DB가 **아닌** 복구
 *      브랜치에서」로 정의하고, 체크리스트의 여러 항목은 「리허설이라면 ~까지가 점검 대상」
 *      (고지를 **발신하지 않고** `due` 를 보는 것 · 기준 스냅샷을 **덮지 않는** 것 ·
 *      `blockers` 가 **차 있는 것**을 확인하는 것)으로 **사건에서는 성립하지 않는 점검**이다.
 *      사건은 절차의 **사용**이고 검증이 아니다.
 *
 *  (2) **연습으로 잰 수치가 약속의 실측이 된다.** 런타임 RPO 실측은
 *      `RECOVERY_RESTORE_POINT`·`RECOVERY_WRITE_FREEZE_AT` 만 보는데(§1-2 `measuredFromEnv`),
 *      그 두 키는 **리허설 체크리스트가 채우라고 지시하는 값**이다. 그래서 리허설 중의 구간이
 *      그대로 `attainment.rpo` 가 되어 `met`(= 약속을 지켰다)이나 `exceeded` 를 내고,
 *      `exceeded` 면 종합 판정이 **`breached`**(「고지문과 §6 표 비고에 약속 대비 초과를 적으라」)
 *      까지 간다 — **고지 대상도 유실도 없는 연습**에서. 어느 쪽도 오류를 내지 않는다.
 *
 *  (3) **표 최신 행의 소요시간도 출처를 말하지 않는다.** §1-2 `rehearsalAttainment` 는
 *      2026-10-21 부터 `검증 결과` 를 게이트로 쓰지만(§6-5) **유형은 보지 않는다.** 리허설에는
 *      1단계 「중단 결정」도, 실사용자 트래픽도, 고지도 없으므로 그 소요시간은 구조적으로
 *      **하한**이다 — 그 값으로 낸 `met` 은 「약속을 지킬 수 있다」가 아니다.
 *
 *  (4) **사건 행이 미통과 단위를 「해소」한다.** §6-5 `outstandingUnits` 는 뒤 행의 범위·미통과
 *      칸만 보므로, 손상 유형이 범위를 고른 사건 행이 지난 리허설의 미통과를 해소로 지운다.
 *
 * 그래서 이 모듈은
 *   · 유형의 경계를 한 곳에 두고(`kindState` — **빈 칸·판독 불가를 「정기」로 올리지 않는다**),
 *   · 두 유형이 **무엇을 보증하고 무엇을 보증하지 않는가**를 정본으로 적고(`KIND_ROLES`),
 *   · 런타임 축(§6-1 선언)과 기록 축(표 열·env)을 **합쳐** 실측의 출처를 판정하고
 *     (`measurementOrigin` — 선언 중의 구간은 **약속 대조에서 뺀다**. §1-2 가 이 게이트를 쓴다),
 *   · 표의 이력에서 **정기 행 기준 기한**과 **해소의 귀속**을 산출하고(`intervalBasis`·
 *     `resolutionKinds` — §6-6 저장소 명령. 런타임은 문서를 읽지 않는다),
 *   · 그 상태를 `/api/health` 로 드러낸다(`rehearsalKindCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL 0, 신규 env 0**
 *   (이미 받아 적고 있는 칸을 읽는다). env 는 인자로 받는다.
 * - **임의 귀속 금지.** 유형이 없으면 「정기였을 것」으로 올리지 않고(`unknown_kind` 는
 *   **판정을 못 한 것**이다), 코드가 유형을 고르지도 않는다.
 * - **중복 보고 금지.** 미실시는 `checks.recovery`, 선언 스코프는 `checks.rehearsalScope`,
 *   통과 여부는 `checks.rehearsalOutcome` 이 말한다 — 이 체크가 말하는 것은 **유형**이다.
 * - **값을 담지 않는다** — 판정·유형·날짜·키 이름뿐이다(소요시간·구간 분·담당·비고 없음).
 */
import { freezeAtFromEnv } from './incidentClosure.ts';
import { restorePointFromEnv } from './lossNotice.ts';
import { addDays, normalizeKind, parseRehearsalDate, type RehearsalKind } from './recovery.ts';
import { LAST_REHEARSAL_ENV, parseCoverageRecord } from './rehearsalCoverage.ts';
import { type LedgerField, type LedgerRow } from './rehearsalLedger.ts';
import { parseUnpassedRecord } from './rehearsalOutcome.ts';
import { REHEARSAL_ACTIVE_ENV, declarationOf, type DeclarationState } from './rehearsalScope.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const KIND_RUNBOOK_REF = 'RUNBOOK §6 · §6-6';

/** 유형 기록 키. **신규 키가 아니다** — 2026-09-21 부터 적혀 있었고 읽는 판정이 없었다 */
export const KIND_ENV = 'RECOVERY_LAST_REHEARSAL_KIND';

/** §6 표에서 같은 값을 적는 열(§6-4 `LEDGER_FIELDS.kind`) */
export const KIND_COLUMN = '유형';

/** 실측 구간을 만드는 두 키 — **리허설에서도 채워진다**(그것이 이 모듈이 생긴 이유다) */
export const WINDOW_KEYS: readonly string[] = ['RECOVERY_RESTORE_POINT', 'RECOVERY_WRITE_FREEZE_AT'];

/* ─────────────────── 「유형」의 경계(한 곳에 둔다) ─────────────────── */

/**
 * - `regular`    : `정기` — 복구 브랜치에서 절차를 **검증한** 연습.
 * - `incident`   : `사건` — 실제로 일어난 복구. 절차의 **사용**이고 검증이 아니다.
 * - `unreadable` : 값이 있는데 둘 중 어느 쪽으로도 읽히지 않는다 — **정기로 올리지 않는다**.
 * - `absent`     : 칸이 비어 있다(= 유형을 적지 않았다).
 */
export type KindState = 'regular' | 'incident' | 'unreadable' | 'absent';

/** 판독은 `lib/recovery.ts` 의 `normalizeKind` 를 쓴다 — 같은 규칙을 두 번 적지 않는다 */
export function kindState(raw: unknown): KindState {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === null || s === undefined || s === '') return 'absent';
  const k: RehearsalKind = normalizeKind(s);
  if (k === 'periodic') return 'regular';
  if (k === 'incident') return 'incident';
  return 'unreadable';
}

/* ─────────────────── 유형이 무엇을 보증하는가(정본) ─────────────────── */

export interface KindRole {
  kind: 'regular' | 'incident';
  /** 그 기록이 보증하는 것 */
  proves: string;
  /** 그 기록이 **보증하지 않는** 것 */
  doesNotProve: string;
  /** 정기 리허설 **기한**을 리셋할 자격이 있는가 */
  resetsInterval: boolean;
  /** 소요시간·구간을 §1 약속의 실측으로 쓸 수 있는가 */
  rtoEvidence: 'measurement' | 'lower_bound';
  /** 지난 미통과 단위를 **해소**할 수 있는가(§6-5) */
  resolvesUnpassed: boolean;
}

export const KIND_ROLES: readonly KindRole[] = [
  {
    kind: 'regular',
    proves: '복구 브랜치에서 절차 단위를 **수행해 봤다**(무엇을 수행·통과했는지는 §6-2·§6-5 가 말한다)',
    doesNotProve: '사건 당일의 소요시간 — 1단계 중단 결정·실사용자 트래픽·고지가 없어 그 수치는 **하한**이다',
    resetsInterval: true,
    rtoEvidence: 'lower_bound',
    resolvesUnpassed: true,
  },
  {
    kind: 'incident',
    proves: '실제 복구의 **소요시간·유실 구간**(§1 의 RTO·RPO 를 재는 유일한 실측이다)',
    doesNotProve:
      '절차가 검증됐다는 사실 — 범위는 손상 유형이 고르고, 체크리스트의 「리허설이라면 ~까지가 점검 대상」 항목(고지 미발신·기준 스냅샷 보존·`blockers` 확인)은 사건에서 성립하지 않는다',
    resetsInterval: false,
    rtoEvidence: 'measurement',
    resolvesUnpassed: false,
  },
];

export function roleFor(kind: unknown): KindRole | null {
  return KIND_ROLES.find((r) => r.kind === kind) ?? null;
}

/* ─────────────────── 구분하지 않으면 무엇이 잘못 말하는가(정본) ─────────────────── */

export interface KindMisread {
  key: string;
  /** 잘못 말하는 판정 */
  reader: string;
  /** 그 판정이 내놓는 말 */
  says: string;
  /** 왜 그렇게 되는가 */
  why: string;
}

export const KIND_MISREADS: readonly KindMisread[] = [
  {
    key: 'interval_reset_by_incident',
    reader: 'checks.recovery.detail.rehearsal.status',
    says: '`ok` — 「다음 리허설 기한: …」',
    why: '`rehearsalFreshness` 는 일자·결과만 보고 **유형 칸을 읽지 않는다**. 사건 복구를 기록하면 기한이 리셋되어, 정기 리허설을 한 번도 하지 않아도 「검증됐다」가 유지된다',
  },
  {
    key: 'rpo_from_rehearsal',
    reader: 'checks.recoveryObjectives.detail.attainment.rpo',
    says: '`met`·`exceeded` — 그리고 `verdict: breached`',
    why: `런타임 실측은 ${WINDOW_KEYS.join('·')} 만 보는데 그 두 키는 **리허설 체크리스트가 채우라고 지시하는 값**이다 — 고지 대상도 유실도 없는 연습 구간이 약속 대비 판정이 된다`,
  },
  {
    key: 'rto_basis_unknown',
    reader: '§1-2 `rehearsalAttainment.rto`',
    says: '`met` — 「목표를 지켰다」',
    why: '2026-10-21 게이트(§6-5)는 `검증 결과` 만 본다. 표 최신 행이 연습인지 사건인지 구별이 없어, 중단 결정도 실트래픽도 없는 **하한**이 약속을 지킨 근거가 된다',
  },
  {
    key: 'resolution_by_incident',
    reader: '§6-5 `outstandingUnits.resolved`',
    says: '「해소됐다」',
    why: '해소는 뒤 행의 범위·미통과 칸만 보므로, 손상 유형이 범위를 고른 **사건 행**이 지난 리허설의 미통과를 지운다 — 사건은 통과 판정을 한 적이 없다',
  },
  {
    key: 'ledger_field_unread',
    reader: '§6-4 `LEDGER_FIELDS.kind.judgedBy`',
    says: '`null` — 「적히지만 아무도 읽지 않는다」',
    why: '집이 둘인 칸(표 열 + env)인데 읽는 판정이 없었다. 기록은 남는데 판정은 두 유형을 같은 말로 취급한다',
  },
];

/** 어긋남의 세 방향 — 어느 쪽도 오류를 내지 않는다 */
export interface KindDrift {
  key: string;
  when: string;
  effect: string;
}

export const KIND_DRIFTS: readonly KindDrift[] = [
  {
    key: 'incident_overwrites_rehearsal',
    when: '사건 복구를 끝내고 `RECOVERY_LAST_REHEARSAL*` 한 벌에 그 값을 적는다',
    effect:
      '마지막 **정기** 리허설의 일자·범위·미통과 기록이 함께 덮인다(§6-4 대조도 최신 행만 본다) — 기한은 리셋되고 재수행 대상은 조용히 짧아진다',
  },
  {
    key: 'drill_becomes_promise',
    when: '리허설이 구간 키를 채운 채 돌아간다(체크리스트가 채우라고 지시한다)',
    effect:
      '그 구간이 `attainment.rpo` 가 되어 `met`·`exceeded` 를 내고, `exceeded` 면 종합 판정이 `breached` 까지 간다 — §3-10 고지 문구 틀도 함께 만들어진다',
  },
  {
    key: 'declaration_left_on',
    when: '리허설 선언(`RECOVERY_REHEARSAL_ACTIVE`)을 켠 채 사건이 난다',
    effect:
      '사건의 실측이 `withheld`(판정 보류)로 빠진다 — 그 사실은 §6-1 이 `production_rehearsal`·선언 잔류로 말하므로 여기서 다시 세지 않는다',
  },
];

/** 보장하지 **못하는** 것 — 응답·RUNBOOK 에 함께 내보낸다 */
export const KIND_LIMITS: readonly string[] = [
  '유형은 **사람이 적는 한 칸**이다 — 사건을 `정기` 로 적으면 이 판정도 같이 틀린다(표와 env 의 대조는 §6-4 가 한다)',
  `런타임 축은 **그 배포의 선언**(${REHEARSAL_ACTIVE_ENV})뿐이다 — 선언 없이 리허설하면 그 구간은 사건 실측으로 세어진다(§6-1 이 선언 없는 활동을 말한다)`,
  '사건 복구가 절차를 **더 많이** 수행했을 수 있다 — 이 판정이 말하는 것은 「검증 자격」이고 수행량이 아니다(범위는 §6-2, 통과는 §6-5)',
  '기한을 리셋하지 않는다는 것은 **정기 리허설 주기**에 대한 말이다 — 사건 기록을 지우라는 뜻이 아니다(§6 표에는 행으로 남는다)',
  '표의 **이력**은 런타임이 보지 않는다 — 정기 행 기준 기한과 해소의 귀속은 §6-6 저장소 명령과 CI 가 본다',
  'RTO·RPO 실측의 자격은 결과(§6-5)와 유형(여기) **두 축**이고, 둘 다 통과해도 그 수치는 **이번 한 번**이다',
  '`ok` 는 「두 축이 서로 맞는다」까지다 — 그 리허설이 무엇을 수행·통과했는가는 §6-2·§6-5 가 말한다',
];

/* ─────────────────── 실측의 출처(런타임 축 + 기록 축) ─────────────────── */

export const MEASURE_ORIGINS = ['incident', 'rehearsal', 'unreadable_declaration'] as const;
export type MeasureOrigin = (typeof MEASURE_ORIGINS)[number];

export const MEASUREMENT_STATES = ['none', 'used', 'withheld'] as const;
export type MeasurementState = (typeof MEASUREMENT_STATES)[number];

export interface MeasurementOrigin {
  origin: MeasureOrigin;
  /** 이 구간을 §1 약속의 실측으로 쓸 수 있는가 */
  trusted: boolean;
  declaration: DeclarationState;
  /** 구간을 산출할 두 키가 **둘 다** 채워져 있는가(값은 보지 않는다) */
  hasWindow: boolean;
  /** 구간이 있는데 약속 대조에서 뺐는가 */
  withheld: boolean;
  measurement: MeasurementState;
  why: string;
}

/**
 * **런타임에서 알 수 있는 유일한 축은 §6-1 선언**이다(표는 읽지 않는다).
 * 선언이 켜져 있으면 그 구간은 연습값이므로 약속 대조에서 뺀다 — `met` 도 `exceeded` 도
 * 내지 않는다(둘 다 거짓이다). 선언 값을 판독할 수 없으면 **「사건이다」로 올리지 않는다**.
 */
export function measurementOrigin(args: { env: Record<string, string | undefined> }): MeasurementOrigin {
  const env = args.env;
  const declaration = declarationOf(env);
  const hasWindow = restorePointFromEnv(env).raw !== null && freezeAtFromEnv(env).raw !== null;
  const origin: MeasureOrigin =
    declaration === 'on' ? 'rehearsal' : declaration === 'malformed' ? 'unreadable_declaration' : 'incident';
  const trusted = origin === 'incident';
  const withheld = hasWindow && !trusted;
  const why =
    origin === 'rehearsal'
      ? `이 배포는 리허설 선언(${REHEARSAL_ACTIVE_ENV}) 중이다 — 구간은 연습값이고 약속 대조에 쓰지 않는다`
      : origin === 'unreadable_declaration'
        ? `리허설 선언 값을 판독할 수 없다 — 연습인지 모르는 구간을 약속 대비 판정으로 올리지 않는다(§6-1)`
        : '리허설 선언이 없다 — 구간이 있으면 사건 실측으로 본다(선언 없는 리허설은 §6-1 이 말한다)';
  return {
    origin,
    trusted,
    declaration,
    hasWindow,
    withheld,
    measurement: withheld ? 'withheld' : hasWindow ? 'used' : 'none',
    why,
  };
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export const KIND_VERDICTS = [
  'no_record',
  'unknown_kind',
  'contradicts_declaration',
  'interval_reset_by_incident',
  'rehearsal_measure',
  'ok',
] as const;

export type KindVerdict = (typeof KIND_VERDICTS)[number];

const ACTION: Record<KindVerdict, string> = {
  no_record: `리허설·사건 기록이 없어 유형을 물을 대상이 없다 — 미실시는 \`checks.recovery\` 가 \`missing\` 으로 말한다(${KIND_RUNBOOK_REF}).`,
  unknown_kind:
    `기록은 있는데 유형을 읽을 수 없다 — \`정기\`(복구 브랜치에서의 검증) 또는 \`사건\`(실제 복구)을 ` +
    `${KIND_ENV} 와 §6 표 \`${KIND_COLUMN}\` 열에 **같은 값으로** 적는다. 유형을 모르면 그 기록이 ` +
    '「절차가 검증됐다」의 근거인지 알 수 없고, 그래도 기한은 리셋된다(§6-6).',
  contradicts_declaration:
    `기록은 \`사건\` 인데 이 배포는 리허설 선언(${REHEARSAL_ACTIVE_ENV}) 중이다 — 둘 중 하나가 틀렸다. ` +
    '리허설이면 유형을 `정기` 로 고치고, 실제 사건이면 선언을 지운다(§6-1. 선언이 남아 있으면 사건의 실측이 판정 보류로 빠진다).',
  interval_reset_by_incident:
    '기록이 `사건` 이다 — 사건 복구는 절차의 **사용**이고 검증이 아닌데 리허설 기한이 그 일자로 리셋됐다. ' +
    `사건은 §6 표에 행으로 남기고 \`${LAST_REHEARSAL_ENV}\` 한 벌은 **마지막 정기 리허설**의 값으로 둔다 ` +
    '(정기 행 기준 기한은 §6-6 저장소 명령이 산출한다).',
  rehearsal_measure:
    '리허설 선언 중에 유실 구간 키가 채워져 있다 — 그 구간을 **약속 대조에서 뺐다**(`attainment.rpo` 는 ' +
    '`unjudged`). 연습값으로 `met`·`exceeded` 를 내지 않는 것이 이 게이트의 목적이고, 리허설이 끝나면 ' +
    `${WINDOW_KEYS.join('·')} 를 지운다(체크리스트 마지막 항목).`,
  ok: '유형이 적혀 있고 런타임 선언과 어긋나지 않는다 — 다음 기록에서도 표와 env 에 **같은 값**을 적는다.',
};

const VERDICT_NOTE: Record<KindVerdict, string> = {
  no_record: '평상시 상태 — 판정 보류다',
  unknown_kind: '판정을 못 한 것이고 통과가 아니다',
  contradicts_declaration: '기록 축과 런타임 축이 다른 말을 한다',
  interval_reset_by_incident: '사건이 정기 리허설의 기한을 리셋했다',
  rehearsal_measure: '연습 구간을 약속 대조에서 뺐다(게이트가 작동한 상태다)',
  ok: '두 축이 서로 맞는다',
};

export interface KindAssessment {
  verdict: KindVerdict;
  envKey: string;
  tableColumn: string;
  kind: KindState;
  lastRehearsal: string | null;
  origin: MeasurementOrigin;
  /** 이 기록이 정기 리허설 기한을 리셋할 자격이 있는가(유형을 모르면 null) */
  resetsInterval: boolean | null;
  /** 이 기록의 소요시간을 §1 실측으로 쓸 수 있는가(유형을 모르면 null) */
  measurementEligible: boolean | null;
  action: string;
  caveats: readonly string[];
}

/**
 * 판정. env 는 **인자로** 받는다.
 *
 * 판정 순서: 기록 없음(단, 선언 중 구간은 말한다) → **유형 판독 불가** → 두 축의 모순 →
 * 기한 리셋 → 연습 구간 보류 → ok.
 * 「거짓 `ok` 를 막는 것」이 기록 자격보다 뒤로 밀리지 않게 한다(§6-2·§6-5 와 같은 규율).
 */
export function assessKind(args: { env: Record<string, string | undefined>; now?: Date }): KindAssessment {
  const env = args.env;
  const lastRehearsal = parseRehearsalDate(env[LAST_REHEARSAL_ENV]);
  const kind = kindState(env[KIND_ENV]);
  const origin = measurementOrigin({ env });
  const role = kind === 'regular' || kind === 'incident' ? roleFor(kind) : null;

  const shell = {
    envKey: KIND_ENV,
    tableColumn: KIND_COLUMN,
    kind,
    lastRehearsal,
    origin,
    resetsInterval: role ? role.resetsInterval : null,
    measurementEligible: role ? role.rtoEvidence === 'measurement' : null,
    caveats: KIND_LIMITS,
  };
  const done = (verdict: KindVerdict): KindAssessment => ({ ...shell, verdict, action: ACTION[verdict] });

  // 기록이 없어도 **선언 중의 구간**은 말해야 한다(그 구간이 약속 대조에 들어가려던 값이다).
  if (!lastRehearsal) return done(origin.withheld ? 'rehearsal_measure' : 'no_record');
  if (kind === 'absent' || kind === 'unreadable') return done('unknown_kind');
  if (kind === 'incident' && origin.origin === 'rehearsal') return done('contradicts_declaration');
  if (kind === 'incident') return done('interval_reset_by_incident');
  if (origin.withheld) return done('rehearsal_measure');
  return done('ok');
}

/* ───────────── 표의 이력: 정기 행 기준 기한 (§6-6 저장소 명령) ───────────── */

export const INTERVAL_BASES = ['regular', 'incident_only', 'none', 'unknown'] as const;
export type IntervalBasis = (typeof INTERVAL_BASES)[number];

export interface IntervalReading {
  basis: IntervalBasis;
  /** 마지막 **정기** 행의 일자 */
  regularDate: string | null;
  /** 그 일자 기준 다음 기한(주기를 모르면 null — 임의 주기를 만들지 않는다) */
  dueDate: string | null;
  /** 기한을 넘겼는가(주기를 모르면 null) */
  overdue: boolean | null;
  /** 정기 행 **뒤에** 들어온 사건 행의 일자 — 신선도가 이것으로 리셋된다 */
  shadowedBy: string[];
  /** 유형을 읽을 수 없는 행의 일자 — 정기로 세지 않는다 */
  unreadableRows: string[];
  note: string;
}

/** 유형별 최신 행(미래 일자는 기록이 아니다) */
export function lastOfKind(
  rows: readonly LedgerRow[],
  kind: 'regular' | 'incident',
  now?: Date,
): LedgerRow | null {
  const today = (now ?? new Date()).toISOString().slice(0, 10);
  const past = rows.filter((r) => kindState(r.kind) === kind && r.date <= today);
  if (past.length === 0) return null;
  return past.reduce((a, b) => (a.date >= b.date ? a : b));
}

/**
 * 기한의 근거가 **정기 행**인지. 신선도(`rehearsalFreshness`)는 유형을 보지 않으므로
 * 사건 행이 기한을 리셋하는데, 그 사실은 이 산출로만 드러난다(런타임은 표를 읽지 않는다).
 */
export function intervalBasis(args: {
  rows: readonly LedgerRow[];
  intervalDays?: number | null;
  now?: Date;
}): IntervalReading {
  const now = args.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const interval = args.intervalDays ?? null;
  const past = args.rows.filter((r) => r.date <= today);
  const regular = lastOfKind(past, 'regular', now);
  const incident = lastOfKind(past, 'incident', now);
  const unreadableRows = past.filter((r) => kindState(r.kind) !== 'regular' && kindState(r.kind) !== 'incident').map((r) => r.date);

  const shadowedBy = regular
    ? past.filter((r) => kindState(r.kind) === 'incident' && r.date > regular.date).map((r) => r.date)
    : incident
      ? [incident.date]
      : [];

  const basis: IntervalBasis =
    regular !== null ? 'regular' : incident !== null ? 'incident_only' : unreadableRows.length > 0 ? 'unknown' : 'none';
  const dueDate = regular && interval ? addDays(regular.date, interval) : null;
  const note =
    basis === 'regular'
      ? shadowedBy.length > 0
        ? '정기 행 뒤에 사건 행이 있다 — 신선도는 그 사건 일자로 리셋됐고, 기한의 근거는 위 정기 일자다'
        : '기한의 근거가 정기 행이다'
      : basis === 'incident_only'
        ? '표에 사건 행만 있다 — **정기 리허설 기록이 없다**(신선도는 사건 일자로 ok 를 낼 수 있다)'
        : basis === 'unknown'
          ? '유형을 읽을 수 없는 행만 있다 — 정기로 세지 않는다(판정 보류)'
          : '표에 기록이 없다';
  return {
    basis,
    regularDate: regular?.date ?? null,
    dueDate,
    overdue: dueDate ? today > dueDate : null,
    shadowedBy,
    unreadableRows,
    note,
  };
}

/* ───────────── 표의 이력: 해소의 귀속 (§6-6 저장소 명령) ───────────── */

export interface Resolution {
  unit: string;
  /** 미통과로 적힌 행 */
  since: string;
  /** 해소로 세어진 행 */
  resolvedAt: string;
  resolvedBy: KindState;
}

export interface ResolutionReading {
  resolutions: readonly Resolution[];
  /** **사건 행**이 해소한 단위 — 사건은 통과 판정을 한 적이 없다 */
  byIncident: string[];
  /** 유형을 읽을 수 없는 행이 해소한 단위 */
  byUnknownKind: string[];
  note: string;
}

/**
 * §6-5 `outstandingUnits` 의 해소 규칙(「뒤 행의 범위에 들어 있고 미통과로 적히지 않으면 해소」)에
 * **유형을 붙인다**. 해소 판정의 정본은 §6-5 이고, 여기서는 그 해소가 **무엇이 한 것인지**만 말한다.
 */
export function resolutionKinds(rows: readonly LedgerRow[], now?: Date): ResolutionReading {
  const today = (now ?? new Date()).toISOString().slice(0, 10);
  const ordered = [...rows].filter((r) => r.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const open = new Map<string, string>();
  const resolutions: Resolution[] = [];

  for (const row of ordered) {
    const unpassed = parseUnpassedRecord(row.unpassed);
    const scope = parseCoverageRecord(row.scope);
    const listed = new Set(unpassed?.units ?? []);
    if (scope) {
      for (const unit of scope.units) {
        const since = open.get(unit);
        if (since !== undefined && !listed.has(unit)) {
          resolutions.push({ unit, since, resolvedAt: row.date, resolvedBy: kindState(row.kind) });
          open.delete(unit);
        }
      }
    }
    for (const unit of listed) open.set(unit, row.date);
  }

  const byIncident = [...new Set(resolutions.filter((r) => r.resolvedBy === 'incident').map((r) => r.unit))].sort();
  const byUnknownKind = [
    ...new Set(resolutions.filter((r) => r.resolvedBy === 'unreadable' || r.resolvedBy === 'absent').map((r) => r.unit)),
  ].sort();
  return {
    resolutions,
    byIncident,
    byUnknownKind,
    note:
      byIncident.length > 0 || byUnknownKind.length > 0
        ? '검증이 아닌 행이 미통과 단위를 해소로 지웠다 — 그 단위를 다음 **정기** 리허설 범위에 넣는다'
        : '해소는 전부 정기 행이 한 것이다(해소 판정의 정본은 §6-5 다)',
  };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/**
 * `/api/health` 체크. **required: false** — 유형이 어긋났다고 서비스를 내리면 복구가 자기 자신을 막는다.
 * 평상시(`no_record`)는 ok 이고, 리허설 중의 `rehearsal_measure` 는 **의도된 degraded** 다
 * (§6-3 관측 정본에 `degradedWhen: ['rehearsal']` 로 등록한다).
 * **값을 담지 않는다** — 판정·유형·날짜·키 이름뿐이다(소요시간·구간 분·담당·비고 없음).
 */
export function rehearsalKindCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const a = assessKind({ env: args?.env ?? process.env, now: args?.now });
  return {
    ok: a.verdict === 'ok' || a.verdict === 'no_record',
    required: false,
    detail: {
      verdict: a.verdict,
      kindEnv: a.envKey,
      tableColumn: a.tableColumn,
      kind: a.kind,
      lastRehearsal: a.lastRehearsal,
      declaration: a.origin.declaration,
      origin: a.origin.origin,
      measurement: a.origin.measurement,
      measurementTrusted: a.origin.trusted,
      windowKeys: WINDOW_KEYS,
      resetsInterval: a.resetsInterval,
      measurementEligible: a.measurementEligible,
      misreads: KIND_MISREADS.map((m) => m.key),
      drifts: KIND_DRIFTS.map((d) => d.key),
      runbook: KIND_RUNBOOK_REF,
      limits: KIND_LIMITS,
      action: a.action,
      note: VERDICT_NOTE[a.verdict],
      originNote: a.origin.why,
    },
  };
}

/** 사람이 읽는 요약(§6-6 명령·보고용). 수치를 지어내지 않는다 */
export function kindText(a: KindAssessment): string[] {
  const lines = [
    `판정: ${a.verdict} (${VERDICT_NOTE[a.verdict]})`,
    `기록=${a.lastRehearsal ?? '미실시'} · 유형=${a.kind}`,
    `실측 출처: ${a.origin.origin} (${a.origin.measurement}) — ${a.origin.why}`,
    `기한 리셋 자격: ${a.resetsInterval === null ? '판정 보류' : a.resetsInterval ? '있다' : '없다'}`,
    `약속 실측 자격: ${a.measurementEligible === null ? '판정 보류' : a.measurementEligible ? '있다' : '없다(하한이다)'}`,
    `해야 할 일: ${a.action}`,
  ];
  return lines;
}

/** 운영 로그 한 줄 — 판정·유형·상태만 담는다(구간 분·소요시간 없음) */
export function kindLogLine(a: KindAssessment): string {
  return [
    '[rehearsalKind]',
    `verdict=${a.verdict}`,
    `kind=${a.kind}`,
    `last=${a.lastRehearsal ?? '-'}`,
    `origin=${a.origin.origin}`,
    `measurement=${a.origin.measurement}`,
    `declaration=${a.origin.declaration}`,
  ].join(' ');
}

/** 표 이력 요약(§6-6 저장소 명령이 출력한다) */
export function intervalText(args: {
  rows: readonly LedgerRow[];
  intervalDays?: number | null;
  now?: Date;
}): string[] {
  const r = intervalBasis(args);
  const res = resolutionKinds(args.rows, args.now);
  const lines = [
    `기한 근거: ${r.basis} — ${r.note}`,
    `마지막 정기 리허설: ${r.regularDate ?? '-'} · 기한: ${r.dueDate ?? '주기 미설정(판정 보류)'}${r.overdue === true ? ' · **기한 초과**' : ''}`,
  ];
  if (r.shadowedBy.length > 0) lines.push(`기한을 리셋한 사건 행: ${r.shadowedBy.join(', ')}`);
  if (r.unreadableRows.length > 0) lines.push(`유형 판독 불가 행: ${r.unreadableRows.join(', ')} (정기로 세지 않는다)`);
  lines.push(`사건 행이 해소한 미통과 단위: ${res.byIncident.join(', ') || '-'}`);
  if (res.byUnknownKind.length > 0) lines.push(`유형 모를 행이 해소한 단위: ${res.byUnknownKind.join(', ')}`);
  return lines;
}

/** 배선 상태 요약(문서·보고용) */
export function rehearsalKindStatus(env: Record<string, string | undefined>): {
  verdict: KindVerdict;
  kind: KindState;
  measurement: MeasurementState;
  misreads: number;
  limits: number;
  note: string;
} {
  const a = assessKind({ env });
  return {
    verdict: a.verdict,
    kind: a.kind,
    measurement: a.origin.measurement,
    misreads: KIND_MISREADS.length,
    limits: KIND_LIMITS.length,
    note: VERDICT_NOTE[a.verdict],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** 정본 모양 — 설명 공백·중복 키·두 유형의 자격이 같아지는 것을 잡는다 */
export function auditKindShape(
  roles: readonly KindRole[] = KIND_ROLES,
  misreads: readonly KindMisread[] = KIND_MISREADS,
  drifts: readonly KindDrift[] = KIND_DRIFTS,
): string[] {
  const problems: string[] = [];
  const kinds = new Set<string>();
  for (const r of roles) {
    if (kinds.has(r.kind)) problems.push(`유형 ${r.kind} 가 정본에 두 번 있다`);
    kinds.add(r.kind);
    if (!r.proves.trim() || !r.doesNotProve.trim()) problems.push(`유형 ${r.kind} 에 보증·미보증 설명 중 빈 칸이 있다`);
  }
  for (const k of ['regular', 'incident']) {
    if (!kinds.has(k)) problems.push(`유형 ${k} 가 정본에 없다`);
  }
  const regular = roles.find((r) => r.kind === 'regular');
  const incident = roles.find((r) => r.kind === 'incident');
  if (regular && incident) {
    if (regular.resetsInterval === incident.resetsInterval) {
      problems.push('두 유형의 기한 리셋 자격이 같다 — 구분하지 않으면 사건이 정기 리허설 기한을 리셋한다');
    }
    if (regular.rtoEvidence === incident.rtoEvidence) {
      problems.push('두 유형의 실측 자격이 같다 — 연습값과 사건 실측이 같은 근거가 된다');
    }
    if (incident.resolvesUnpassed) problems.push('사건 행이 미통과를 해소할 수 있게 선언돼 있다 — 사건은 통과 판정을 하지 않는다');
  }
  const seen = new Set<string>();
  for (const m of misreads) {
    if (seen.has(m.key)) problems.push(`잘못 읽히는 판정 ${m.key} 가 정본에 두 번 있다`);
    seen.add(m.key);
    if (!m.reader.trim() || !m.says.trim() || !m.why.trim()) problems.push(`${m.key} 에 판정·그 말·이유 중 빈 칸이 있다`);
  }
  const dk = new Set<string>();
  for (const d of drifts) {
    if (dk.has(d.key)) problems.push(`어긋남 방향 ${d.key} 가 정본에 두 번 있다`);
    dk.add(d.key);
    if (!d.when.trim() || !d.effect.trim()) problems.push(`어긋남 방향 ${d.key} 에 빈 칸이 있다`);
  }
  if (KIND_LIMITS.length === 0) problems.push('보장하지 못하는 것이 하나도 적혀 있지 않다');
  return problems;
}

/**
 * §6-4 기록 정본이 이 칸을 **읽는 판정으로** 선언하는지.
 * `judgedBy: null` 로 되돌아가면 적히기만 하고 아무도 읽지 않는 칸이 된다(그 상태가 이 모듈의 출발점이다).
 */
export function auditLedgerKindJudge(fields: readonly LedgerField[]): string[] {
  const f = fields.find((x) => x.key === 'kind');
  if (!f) return ['§6-4 기록 정본에 `kind` 칸이 없다 — 표 열과 env 키의 집 선언이 빠졌다'];
  const problems: string[] = [];
  if (f.column !== KIND_COLUMN) problems.push(`칸 kind 의 표 열이 \`${KIND_COLUMN}\` 이 아니다(${f.column})`);
  if (f.envKey !== KIND_ENV) problems.push(`칸 kind 의 env 키가 ${KIND_ENV} 가 아니다(${f.envKey})`);
  if (f.home !== 'both') problems.push(`칸 kind 의 집이 둘이 아니다(${f.home})`);
  if (!f.judgedBy || !f.judgedBy.includes('rehearsalKind')) {
    problems.push('칸 kind 를 읽는 판정이 선언돼 있지 않다 — 적히지만 아무도 읽지 않는 칸으로 되돌아갔다');
  }
  return problems;
}

/**
 * **§1-2 가 이 게이트를 쓰는지**(`src/lib/recoveryObjectives.ts` 원문).
 * 쓰지 않으면 리허설 중의 구간이 다시 `attainment.rpo` 가 되어 `met`·`exceeded` 를 내는데,
 * 응답은 그대로 200 이고 수치도 그럴듯해 **사람 눈으로는 알아챌 수 없다**.
 */
export function auditObjectivesGate(objectivesSrc: unknown): string[] {
  const s = String(objectivesSrc ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/rehearsalKind\.ts['"]/.test(s)) {
    problems.push('lib/recoveryObjectives.ts 가 rehearsalKind 를 import 하지 않는다 — 실측 출처 판정이 빠졌다');
  }
  if (!/measurementOrigin\(/.test(s)) {
    problems.push('lib/recoveryObjectives.ts 가 measurementOrigin() 을 호출하지 않는다 — 연습 구간이 다시 약속 대조에 들어간다');
  }
  if (!/origin\w*\.(trusted|withheld)/.test(s)) {
    problems.push('measurementOrigin() 의 결과로 분기하지 않는다 — 판정만 하고 버리면 연습 구간이 그대로 실측이 된다');
  }
  return problems;
}

/**
 * 유형을 **위치로 읽는** 자리가 그대로인지(`src/lib/recovery.ts` 원문).
 * 표 열이 끼어들면 `유형` 칸에서 다른 열이 읽히는데(§6-4 `POSITIONAL_COLUMNS`), 그때 이 판정은
 * 조용히 `unknown_kind` 로 내려앉거나 엉뚱한 값을 유형으로 읽는다.
 */
export function auditKindSource(recoverySrc: unknown): string[] {
  const s = String(recoverySrc ?? '');
  const problems: string[] = [];
  if (!/export function normalizeKind/.test(s)) {
    problems.push('lib/recovery.ts 에 normalizeKind 가 없다 — 유형 판독 규칙의 정본이 사라졌다');
  }
  if (!/kind:\s*normalizeKind\(cells\[1\]\)/.test(s)) {
    problems.push('§6 표 파서가 `유형` 을 둘째 칸에서 읽지 않는다 — 열이 끼어들면 유형이 조용히 어긋난다(§6-4)');
  }
  if (!/kind:\s*normalizeKind\(env\.RECOVERY_LAST_REHEARSAL_KIND\)/.test(s)) {
    problems.push('env 스냅샷이 유형을 읽지 않는다 — 런타임 판정이 유형을 받을 길이 없어진다');
  }
  return problems;
}

/** §6-6·표 열·env 표·체크리스트 항목이 문서에 남아 있는지 */
export function auditRunbookKind(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-6\./m.test(s)) problems.push('§6-6 절이 사라졌다 — 연습과 사건을 구분하는 유일한 자리다');
  if (!s.includes(KIND_ENV)) problems.push(`RUNBOOK 에 ${KIND_ENV} 가 없다 — §4-7·§6 env 표에 등록할 것`);
  if (!/checks\.rehearsalKind/.test(s)) problems.push('RUNBOOK 에 checks.rehearsalKind 확인 지시가 없다');
  if (!/intervalText|intervalBasis/.test(s)) problems.push('§6-6 에 정기 행 기준 기한을 산출하는 명령이 없다');
  // env 표의 그 줄이 「선택」으로 되돌아가면(= 비워도 된다는 말) 판정은 영구히 `unknown_kind` 다
  const kindRow = s.split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.includes(KIND_ENV));
  if (kindRow && /선택/.test(kindRow)) {
    problems.push(`§6 env 표의 ${KIND_ENV} 줄이 「선택」이다 — 판정이 읽는 칸이므로 비우면 unknown_kind(판정 보류)가 된다`);
  }
  for (const m of KIND_MISREADS) {
    if (!s.includes(m.key)) problems.push(`§6-6 에 잘못 읽히는 판정 ${m.key} 가 없다`);
  }
  for (const d of KIND_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§6-6 에 어긋남 방향 ${d.key} 가 없다`);
  }
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) {
    problems.push('§6 에 리허설 체크리스트가 없다');
  } else {
    const checklist = s.slice(at);
    if (!/6-6/.test(checklist)) problems.push('리허설 체크리스트가 §6-6 을 가리키지 않는다');
    if (!/checks\.rehearsalKind/.test(checklist)) problems.push('리허설 체크리스트에 유형을 적는 항목이 없다');
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴과 **관측 판정 뒤로 밀린 경우**를 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalKind['"]/.test(s)) problems.push('rehearsalKind 를 import 하지 않는다');
  if (!/rehearsalKindCheck\(/.test(s)) problems.push('rehearsalKindCheck() 를 호출하지 않는다');
  if (!/checks\.rehearsalKind\s*=\s*rehearsalKindCheck\(/.test(s)) {
    problems.push('rehearsalKindCheck() 결과를 checks.rehearsalKind 에 담지 않는다 — 판정만 하고 버리면 응답에 나타나지 않는다');
  }
  const mine = s.indexOf('checks.rehearsalKind =');
  const observation = s.indexOf('checks.rehearsalObservation =');
  if (mine >= 0 && observation >= 0 && mine > observation) {
    problems.push('checks.rehearsalKind 이 checks.rehearsalObservation 뒤에 실린다 — 관측 판정은 뒤에 실리는 체크를 보지 못한다(§6-3)');
  }
  return problems;
}

/** 범위 판정이 이 키를 함께 읽기 시작하면 중복 보고가 된다(§6-5 와 같은 규율) */
export function auditKindSeparation(coverageSrc: unknown): string[] {
  const s = String(coverageSrc ?? '');
  return s.includes(KIND_ENV)
    ? [`lib/rehearsalCoverage.ts 가 ${KIND_ENV} 를 읽는다 — 유형 판정이 두 곳에 생겼다(중복 보고가 된다)`]
    : [];
}
